/**
 * DexieAdapter - Web implementation of IRepository
 *
 * Uses Dexie.js wrapper around IndexedDB for browser storage.
 * Features:
 * - Compound indexes for efficient querying
 * - Automatic schema versioning
 * - Transaction support
 * - Type-safe database access
 * - Promise-based API
 */

import Dexie, { Table } from 'dexie';
import { v4 as uuidv4 } from 'uuid';
import { IRepository, WhereClause } from '../../interfaces/IRepository';

/**
 * Database schema interface
 * Dexie uses this for type-safe table access
 */
interface SofiaDatabase extends Dexie {
  sessions: Table<any>;
  patients: Table<any>;
  audio_recordings: Table<any>;
  transcriptions: Table<any>;
  clinical_notes: Table<any>;
  recording_queue: Table<any>;
  audio_blobs: Table<any>;
  transcription_segments: Table<any>;
  // Card stores (US22)
  medications: Table<any>;
  vital_signs: Table<any>;
  allergies: Table<any>;
  safety_info: Table<any>;
}

export class DexieAdapter implements IRepository {
  private db: SofiaDatabase;
  private initialized: boolean = false;

  constructor(databaseName: string = 'sofia_db') {
    this.db = new Dexie(databaseName) as SofiaDatabase;
    this.defineSchema();
  }

  /**
   * Define database schema with compound indexes
   */
  private defineSchema(): void {
    this.db.version(1).stores({
      sessions: 'id, session_id, status, expires_at, [session_id+status], [status+expires_at]',
      patients:
        'id, session_id, status, last_interaction_at, expires_at, [session_id+status], [session_id+last_interaction_at]',
      audio_recordings:
        'id, session_id, patient_id, status, expires_at, [session_id+status], [patient_id+status], [session_id+patient_id]',
      transcriptions:
        'id, session_id, audio_recording_id, patient_id, status, expires_at, [session_id+status], [patient_id+status], [audio_recording_id+status]',
      clinical_notes:
        'id, session_id, patient_id, transcription_id, note_type, reviewed, expires_at, [session_id+patient_id], [patient_id+note_type], [patient_id+reviewed]',
    });

    // Version 2: adds offline upload queue and raw audio blob store
    this.db.version(2).stores({
      sessions: 'id, session_id, status, expires_at, [session_id+status], [status+expires_at]',
      patients:
        'id, session_id, status, last_interaction_at, expires_at, [session_id+status], [session_id+last_interaction_at]',
      audio_recordings:
        'id, session_id, patient_id, status, expires_at, [session_id+status], [patient_id+status], [session_id+patient_id]',
      transcriptions:
        'id, session_id, audio_recording_id, patient_id, status, expires_at, [session_id+status], [patient_id+status], [audio_recording_id+status]',
      clinical_notes:
        'id, session_id, patient_id, transcription_id, note_type, reviewed, expires_at, [session_id+patient_id], [patient_id+note_type], [patient_id+reviewed]',
      recording_queue: 'id, session_id, status, chunk_ref',
      audio_blobs: 'id, session_id, created_at',
    });

    // Version 3: index expires_at on recording_queue and audio_blobs so purgeExpired() can use them
    this.db.version(3).stores({
      recording_queue: 'id, session_id, status, chunk_ref, expires_at',
      audio_blobs: 'id, session_id, created_at, expires_at',
    });

    // Version 4: transcription segments from the voice pipeline (US6)
    this.db.version(4).stores({
      transcription_segments: 'id, session_id, audio_recording_id, bed_id, expires_at',
    });

    // Version 5: dedicated card stores (US22)
    // Compound index [session_id+bed_id] enables queryBySessionAndBed() in O(log n).
    this.db.version(5).stores({
      medications:  'id, session_id, bed_id, expires_at, [session_id+bed_id]',
      vital_signs:  'id, session_id, bed_id, expires_at, [session_id+bed_id]',
      allergies:    'id, session_id, bed_id, expires_at, [session_id+bed_id]',
      safety_info:  'id, session_id, bed_id, expires_at, [session_id+bed_id]',
    });
  }

  /**
   * Initialize database (open connection)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.db.open();
    this.initialized = true;
    console.log('[Dexie] Database initialized');
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get table by store name
   */
  private getTable(store: string): Table {
    const tableMap: { [key: string]: Table } = {
      sessions: this.db.sessions,
      patients: this.db.patients,
      audio_recordings: this.db.audio_recordings,
      transcriptions: this.db.transcriptions,
      clinical_notes: this.db.clinical_notes,
      recording_queue: this.db.recording_queue,
      audio_blobs: this.db.audio_blobs,
      transcription_segments: this.db.transcription_segments,
      // Card stores (US22)
      medications: this.db.medications,
      vital_signs: this.db.vital_signs,
      allergies: this.db.allergies,
      safety_info: this.db.safety_info,
    };

    const table = tableMap[store];
    if (!table) {
      throw new Error(`Unknown store: ${store}`);
    }

    return table;
  }

  /**
   * Create a new record in the specified store
   */
  async create<T>(store: string, data: Partial<T>): Promise<T> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const id = uuidv4();

    // Calculate default expiration (30 days from now)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const record: any = {
      id,
      created_at: now,
      expires_at: expiresAt,
      ...data,
    };

    const table = this.getTable(store);
    await table.add(record);

    return record as T;
  }

  /**
   * Read a single record by ID
   */
  async read<T>(store: string, id: string): Promise<T | null> {
    await this.ensureInitialized();

    const table = this.getTable(store);
    const record = await table.get(id);

    return record ? (record as T) : null;
  }

  /**
   * Update an existing record with partial data
   */
  async update<T>(store: string, id: string, data: Partial<T>): Promise<T> {
    await this.ensureInitialized();

    const table = this.getTable(store);

    // Update the record
    await table.update(id, data);

    // Fetch and return updated record
    const updated = await table.get(id);
    if (!updated) {
      throw new Error(`Record ${id} not found in ${store} after update`);
    }

    return updated as T;
  }

  /**
   * Delete a single record by ID
   */
  async delete(store: string, id: string): Promise<void> {
    await this.ensureInitialized();

    const table = this.getTable(store);
    await table.delete(id);
  }

  /**
   * Query all records associated with a specific session
   */
  async findByField<T>(store: string, field: string, value: any): Promise<T[]> {
    await this.ensureInitialized();

    const table = this.getTable(store);
    const results = await table.where(field).equals(value).toArray();

    return results as T[];
  }

  async queryBySession<T>(store: string, sessionId: string): Promise<T[]> {
    await this.ensureInitialized();

    const table = this.getTable(store);

    const results = await table
      .where('session_id')
      .equals(sessionId)
      .reverse()
      .sortBy('created_at');

    return results as T[];
  }

  async queryBySessionAndBed<T>(store: string, sessionId: string, bedId: string): Promise<T[]> {
    await this.ensureInitialized();

    const table = this.getTable(store);
    // Uses the compound index [session_id+bed_id] defined in version 5 schema.
    const results = await table
      .where('[session_id+bed_id]')
      .equals([sessionId, bedId])
      .reverse()
      .sortBy('created_at');

    return results as T[];
  }

  async findByField<T>(store: string, field: string, value: any): Promise<T[]> {
    await this.ensureInitialized();

    const table = this.getTable(store);
    return (await table.where(field).equals(value).toArray()) as T[];
  }

  /**
   * Delete multiple records matching a where clause
   */
  async bulkDelete(store: string, where: WhereClause): Promise<number> {
    await this.ensureInitialized();

    const table = this.getTable(store);

    // Simple object-based where clause
    if (!('field' in where)) {
      const entries = Object.entries(where);

      // Build filter function
      const filterFn = (record: any) => {
        return entries.every(([key, value]) => record[key] === value);
      };

      // Find matching records
      const matching = await table.filter(filterFn).toArray();

      // Delete by IDs
      const ids = matching.map((r) => r.id);
      await table.bulkDelete(ids);

      return ids.length;
    }

    // Operator-based where clause
    const { field, operator, value } = where;

    let collection: Dexie.Collection;

    switch (operator) {
      case '=':
        collection = table.where(field).equals(value);
        break;
      case '!=':
        collection = table.where(field).notEqual(value);
        break;
      case '>':
        collection = table.where(field).above(value);
        break;
      case '<':
        collection = table.where(field).below(value);
        break;
      case '>=':
        collection = table.where(field).aboveOrEqual(value);
        break;
      case '<=':
        collection = table.where(field).belowOrEqual(value);
        break;
      case 'in':
        const inValues = Array.isArray(value) ? value : [value];
        collection = table.where(field).anyOf(inValues);
        break;
      case 'like':
        // Dexie doesn't support LIKE directly, use startsWith or filter
        const pattern = String(value).replace(/%/g, '');
        collection = table.where(field).startsWith(pattern);
        break;
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }

    const count = await collection.count();
    await collection.delete();

    return count;
  }

  /**
   * Purge all expired records across all stores
   */
  async purgeExpired(): Promise<number> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    let totalDeleted = 0;

    const stores = [
      'sessions',
      'patients',
      'audio_recordings',
      'transcriptions',
      'clinical_notes',
      'recording_queue',
      'audio_blobs',
      'transcription_segments',
      // Card stores (US22)
      'medications',
      'vital_signs',
      'allergies',
      'safety_info',
    ];

    for (const storeName of stores) {
      const table = this.getTable(storeName);
      const count = await table.where('expires_at').below(now).count();
      await table.where('expires_at').below(now).delete();
      totalDeleted += count;
    }

    return totalDeleted;
  }

  /**
   * Execute raw query (for advanced use cases)
   * Limited support in IndexedDB/Dexie compared to SQL
   */
  async executeRaw(_query: string, _params: any[] = []): Promise<any[]> {
    await this.ensureInitialized();

    // IndexedDB doesn't support raw SQL queries
    // This method is here for interface compatibility
    // Users should use specific methods instead
    throw new Error('Raw queries not supported in DexieAdapter. Use specific query methods.');
  }

  /**
   * Get all records from a store (for advanced queries)
   */
  async getAll<T>(store: string): Promise<T[]> {
    await this.ensureInitialized();

    const table = this.getTable(store);
    return (await table.toArray()) as T[];
  }

  /**
   * Query with complex filters
   */
  async query<T>(
    store: string,
    filter: (record: any) => boolean
  ): Promise<T[]> {
    await this.ensureInitialized();

    const table = this.getTable(store);
    return (await table.filter(filter).toArray()) as T[];
  }

  /**
   * Count records matching a condition
   */
  async count(store: string, where?: WhereClause): Promise<number> {
    await this.ensureInitialized();

    const table = this.getTable(store);

    if (!where) {
      return await table.count();
    }

    // Simple object-based where clause
    if (!('field' in where)) {
      const entries = Object.entries(where);
      const filterFn = (record: any) => {
        return entries.every(([key, value]) => record[key] === value);
      };
      return await table.filter(filterFn).count();
    }

    // Operator-based where clause
    const { field, operator, value } = where;

    switch (operator) {
      case '=':
        return await table.where(field).equals(value).count();
      case '!=':
        return await table.where(field).notEqual(value).count();
      case '>':
        return await table.where(field).above(value).count();
      case '<':
        return await table.where(field).below(value).count();
      case '>=':
        return await table.where(field).aboveOrEqual(value).count();
      case '<=':
        return await table.where(field).belowOrEqual(value).count();
      case 'in':
        const inValues = Array.isArray(value) ? value : [value];
        return await table.where(field).anyOf(inValues).count();
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }
  }

  /**
   * Clear all data from a store
   */
  async clear(store: string): Promise<void> {
    await this.ensureInitialized();

    const table = this.getTable(store);
    await table.clear();
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.initialized) {
      this.db.close();
      this.initialized = false;
      console.log('[Dexie] Database closed');
    }
  }

  /**
   * Delete entire database (for testing/reset)
   */
  async deleteDatabase(): Promise<void> {
    await this.db.delete();
    this.initialized = false;
    console.log('[Dexie] Database deleted');
  }
}
