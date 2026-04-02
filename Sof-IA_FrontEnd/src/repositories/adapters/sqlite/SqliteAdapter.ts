/**
 * SqliteAdapter - Android/iOS implementation of IRepository
 *
 * Uses expo-sqlite for local storage on native platforms.
 * Features:
 * - WAL (Write-Ahead Logging) mode for concurrent reads
 * - Prepared statements for SQL injection prevention
 * - Transaction support for atomic operations
 * - Automatic migration system
 * - Foreign key constraints for data integrity
 */

import * as SQLite from 'expo-sqlite';
import { v4 as uuidv4 } from 'uuid';
import { IRepository, WhereClause } from '../../interfaces/IRepository';
import { initializeDatabase } from './migrations';
import { capabilities } from '../../../config/capabilities';

export class SqliteAdapter implements IRepository {
  private db: SQLite.SQLiteDatabase;
  private initialized: boolean = false;

  constructor(databaseName: string = 'sofia.db') {
    // Defensive check: Only instantiate on native platforms
    if (!capabilities.isNative) {
      throw new Error(
        '[SqliteAdapter] Cannot initialize SQLite on web platform. ' +
        'This adapter is only supported on Android/iOS. ' +
        'Use DexieAdapter for web instead.'
      );
    }

    try {
      this.db = SQLite.openDatabaseSync(databaseName);
    } catch (error) {
      throw new Error(
        `[SqliteAdapter] Failed to open database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Initialize database (run migrations, enable WAL mode)
   * Call this once when app starts
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await initializeDatabase(this.db);
    this.initialized = true;
  }

  /**
   * Ensure database is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Create a new record in the specified store
   */
  async create<T>(store: string, data: T): Promise<T> {
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

    const { columns, placeholders, values } = this.buildInsertQuery(record);

    const query = `INSERT INTO ${store} (${columns}) VALUES (${placeholders})`;

    await this.db.runAsync(query, values);

    return record as T;
  }

  /**
   * Read a single record by ID
   */
  async read<T>(store: string, id: string): Promise<T | null> {
    await this.ensureInitialized();

    const query = `SELECT * FROM ${store} WHERE id = ? LIMIT 1`;
    const result = await this.db.getFirstAsync<any>(query, [id]);

    if (!result) {
      return null;
    }

    return this.deserializeRecord(result) as T;
  }

  /**
   * Update an existing record with partial data
   */
  async update<T>(store: string, id: string, data: Partial<T>): Promise<T> {
    await this.ensureInitialized();

    const { setClause, values } = this.buildUpdateQuery(data);
    const query = `UPDATE ${store} SET ${setClause} WHERE id = ?`;

    await this.db.runAsync(query, [...values, id]);

    // Fetch and return updated record
    const updated = await this.read<T>(store, id);
    if (!updated) {
      throw new Error(`Record ${id} not found in ${store} after update`);
    }

    return updated;
  }

  /**
   * Delete a single record by ID
   */
  async delete(store: string, id: string): Promise<void> {
    await this.ensureInitialized();

    const query = `DELETE FROM ${store} WHERE id = ?`;
    await this.db.runAsync(query, [id]);
  }

  /**
   * Query all records associated with a specific session
   */
  async queryBySession<T>(store: string, sessionId: string): Promise<T[]> {
    await this.ensureInitialized();

    const query = `SELECT * FROM ${store} WHERE session_id = ? ORDER BY created_at DESC`;
    const results = await this.db.getAllAsync<any>(query, [sessionId]);

    return results.map((r) => this.deserializeRecord(r)) as T[];
  }

  /**
   * Delete multiple records matching a where clause
   */
  async bulkDelete(store: string, where: WhereClause): Promise<number> {
    await this.ensureInitialized();

    const { whereClause, values } = this.buildWhereClause(where);
    const query = `DELETE FROM ${store} WHERE ${whereClause}`;

    const result = await this.db.runAsync(query, values);
    return result.changes;
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
    ];

    for (const store of stores) {
      const result = await this.db.runAsync(
        `DELETE FROM ${store} WHERE expires_at < ?`,
        [now]
      );
      totalDeleted += result.changes;
    }

    // Vacuum to reclaim space (optional, can be heavy)
    // await this.db.execAsync('VACUUM;');

    return totalDeleted;
  }

  /**
   * Execute raw SQL query (for advanced use cases)
   */
  async executeRaw(query: string, params: any[] = []): Promise<any[]> {
    await this.ensureInitialized();
    return this.db.getAllAsync(query, params);
  }

  /**
   * Execute raw SQL command (INSERT, UPDATE, DELETE)
   */
  async executeCommand(query: string, params: any[] = []): Promise<number> {
    await this.ensureInitialized();
    const result = await this.db.runAsync(query, params);
    return result.changes;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    // expo-sqlite manages connections automatically
    // This is here for interface compatibility
    console.log('[SQLite] Database connection closed');
  }

  // ========================================
  // Private helper methods
  // ========================================

  /**
   * Build INSERT query components
   */
  private buildInsertQuery(record: any): {
    columns: string;
    placeholders: string;
    values: any[];
  } {
    const entries = Object.entries(record);
    const columns = entries.map(([key]) => this.toSnakeCase(key)).join(', ');
    const placeholders = entries.map(() => '?').join(', ');
    const values = entries.map(([, value]) => this.serializeValue(value));

    return { columns, placeholders, values };
  }

  /**
   * Build UPDATE query components
   */
  private buildUpdateQuery(data: any): {
    setClause: string;
    values: any[];
  } {
    const entries = Object.entries(data);
    const setClause = entries.map(([key]) => `${this.toSnakeCase(key)} = ?`).join(', ');
    const values = entries.map(([, value]) => this.serializeValue(value));

    return { setClause, values };
  }

  /**
   * Build WHERE clause from WhereClause type
   */
  private buildWhereClause(where: WhereClause): {
    whereClause: string;
    values: any[];
  } {
    // Simple object-based where clause
    if (!('field' in where)) {
      const entries = Object.entries(where);
      const whereClause = entries.map(([key]) => `${this.toSnakeCase(key)} = ?`).join(' AND ');
      const values = entries.map(([, value]) => this.serializeValue(value));
      return { whereClause, values };
    }

    // Operator-based where clause
    const { field, operator, value } = where;
    const snakeField = this.toSnakeCase(field);

    let whereClause: string;
    let values: any[];

    switch (operator) {
      case 'in':
        const inValues = Array.isArray(value) ? value : [value];
        whereClause = `${snakeField} IN (${inValues.map(() => '?').join(', ')})`;
        values = inValues.map((v) => this.serializeValue(v));
        break;
      case 'like':
        whereClause = `${snakeField} LIKE ?`;
        values = [this.serializeValue(value)];
        break;
      default:
        whereClause = `${snakeField} ${operator} ?`;
        values = [this.serializeValue(value)];
    }

    return { whereClause, values };
  }

  /**
   * Serialize value for SQL storage
   */
  private serializeValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }

    // Boolean to integer (SQLite doesn't have boolean type)
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }

    // Arrays and objects to JSON
    if (Array.isArray(value) || typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  }

  /**
   * Deserialize record from SQLite row
   */
  private deserializeRecord(row: any): any {
    const record: any = {};

    for (const [key, value] of Object.entries(row)) {
      const camelKey = this.toCamelCase(key);

      // Boolean from integer
      if (typeof value === 'number' && (value === 0 || value === 1)) {
        // Check if this is likely a boolean field
        if (
          key.startsWith('is_') ||
          key === 'synced' ||
          key === 'uploaded' ||
          key === 'reviewed' ||
          key === 'edited' ||
          key === 'extracted'
        ) {
          record[camelKey] = value === 1;
          continue;
        }
      }

      // Try to parse JSON for specific fields
      if (
        typeof value === 'string' &&
        (key === 'tags' || key === 'word_timestamps' || key.startsWith('soap_') || key.startsWith('vitals_'))
      ) {
        try {
          record[camelKey] = JSON.parse(value);
          continue;
        } catch {
          // Not JSON, keep as string
        }
      }

      record[camelKey] = value;
    }

    // Handle nested objects (SOAP, vitals, format)
    this.deserializeNestedObjects(record);

    return record;
  }

  /**
   * Deserialize nested objects (SOAP, vitals, format)
   */
  private deserializeNestedObjects(record: any): void {
    // SOAP note fields
    if (
      record.soapSubjective !== undefined ||
      record.soapObjective !== undefined ||
      record.soapAssessment !== undefined ||
      record.soapPlan !== undefined
    ) {
      record.soap = {
        subjective: record.soapSubjective,
        objective: record.soapObjective,
        assessment: record.soapAssessment,
        plan: record.soapPlan,
      };
      delete record.soapSubjective;
      delete record.soapObjective;
      delete record.soapAssessment;
      delete record.soapPlan;
    }

    // Vitals fields
    if (
      record.vitalsBloodPressure !== undefined ||
      record.vitalsHeartRate !== undefined
    ) {
      record.vitals = {
        blood_pressure: record.vitalsBloodPressure,
        heart_rate: record.vitalsHeartRate,
        respiratory_rate: record.vitalsRespiratoryRate,
        temperature: record.vitalsTemperature,
        spo2: record.vitalsSpo2,
        pain_level: record.vitalsPainLevel,
        blood_glucose: record.vitalsBloodGlucose,
      };
      delete record.vitalsBloodPressure;
      delete record.vitalsHeartRate;
      delete record.vitalsRespiratoryRate;
      delete record.vitalsTemperature;
      delete record.vitalsSpo2;
      delete record.vitalsPainLevel;
      delete record.vitalsBloodGlucose;
    }

    // Audio format fields
    if (record.formatMimeType !== undefined) {
      record.format = {
        mime_type: record.formatMimeType,
        codec: record.formatCodec,
        sample_rate: record.formatSampleRate,
        channels: record.formatChannels,
        bit_depth: record.formatBitDepth,
        bitrate: record.formatBitrate,
      };
      delete record.formatMimeType;
      delete record.formatCodec;
      delete record.formatSampleRate;
      delete record.formatChannels;
      delete record.formatBitDepth;
      delete record.formatBitrate;
    }
  }

  /**
   * Convert camelCase to snake_case
   */
  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  /**
   * Convert snake_case to camelCase
   */
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }
}
