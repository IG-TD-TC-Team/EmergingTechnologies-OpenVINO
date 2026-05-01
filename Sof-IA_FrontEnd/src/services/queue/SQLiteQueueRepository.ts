/**
 * SQLiteQueueRepository — Android backend for IOfflineQueueRepository.
 *
 * Uses expo-sqlite (synchronous API, WAL mode) with its own database file
 * 'sofia_queue.db', separate from the main 'sofia.db'.
 *
 * The table is created in initialize() via CREATE TABLE IF NOT EXISTS, so no
 * changes to the shared migrations.ts are needed.
 *
 * FIFO order is enforced by ORDER BY timestamp ASC on every read query.
 *
 * getStorageSizeBytes() uses expo-file-system to stat the database file.
 * Falls back to a count-based estimate if the file cannot be read.
 */

import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import { OfflineQueueEntry } from '../../types/offlineQueue';
import { IOfflineQueueRepository } from './IOfflineQueueRepository';

const DB_NAME = 'sofia_queue.db';

/** Average compressed audio chunk size in bytes used for the count fallback. */
const AVG_CHUNK_BYTES = 1_000_000; // ~1 MB ≈ 1 min M4A

export class SQLiteQueueRepository implements IOfflineQueueRepository {
  private db!: SQLite.SQLiteDatabase;
  private initialized = false;

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.db = SQLite.openDatabaseSync(DB_NAME);

    // Enable WAL mode for concurrent reads during background retry loops.
    this.db.execSync('PRAGMA journal_mode = WAL;');

    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS offline_queue (
        id          TEXT PRIMARY KEY NOT NULL,
        chunk_ref   TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'failed'))
          DEFAULT 'pending'
      );

      -- FIFO reads: fastest path is (status, timestamp).
      CREATE INDEX IF NOT EXISTS idx_oq_status_ts
        ON offline_queue (status, timestamp ASC);

      -- Shift-end cleanup: delete all entries for a session in one sweep.
      CREATE INDEX IF NOT EXISTS idx_oq_session
        ON offline_queue (session_id);
    `);

    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  // ─── Write ───────────────────────────────────────────────────────────────

  async enqueue(entry: OfflineQueueEntry): Promise<void> {
    await this.ensureInitialized();
    this.db.runSync(
      `INSERT OR REPLACE INTO offline_queue
         (id, chunk_ref, session_id, timestamp, retry_count, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.chunk_ref,
        entry.session_id,
        entry.timestamp,
        entry.retry_count,
        entry.status,
      ]
    );
  }

  async markSent(id: string): Promise<void> {
    await this.ensureInitialized();
    this.db.runSync(
      `UPDATE offline_queue SET status = 'sent' WHERE id = ?`,
      [id]
    );
  }

  async markFailed(id: string): Promise<void> {
    await this.ensureInitialized();
    this.db.runSync(
      `UPDATE offline_queue SET status = 'failed' WHERE id = ?`,
      [id]
    );
  }

  async deleteEntry(id: string): Promise<void> {
    await this.ensureInitialized();
    this.db.runSync(`DELETE FROM offline_queue WHERE id = ?`, [id]);
  }

  // ─── Read ────────────────────────────────────────────────────────────────

  /**
   * FIFO dequeue: return the single oldest 'pending' entry without deleting it.
   * The caller must call markSent(id) or markFailed(id) once it processes the chunk.
   */
  async dequeue(): Promise<OfflineQueueEntry | null> {
    await this.ensureInitialized();
    const row = this.db.getFirstSync<OfflineQueueEntry>(
      `SELECT * FROM offline_queue
       WHERE status = 'pending'
       ORDER BY timestamp ASC
       LIMIT 1`
    );
    return row ?? null;
  }

  async getPending(): Promise<OfflineQueueEntry[]> {
    await this.ensureInitialized();
    return this.db.getAllSync<OfflineQueueEntry>(
      `SELECT * FROM offline_queue
       WHERE status = 'pending'
       ORDER BY timestamp ASC`
    );
  }

  async getAll(): Promise<OfflineQueueEntry[]> {
    await this.ensureInitialized();
    return this.db.getAllSync<OfflineQueueEntry>(
      `SELECT * FROM offline_queue ORDER BY timestamp ASC`
    );
  }

  // ─── Storage estimate ────────────────────────────────────────────────────

  async getStorageSizeBytes(): Promise<number> {
    await this.ensureInitialized();
    try {
      const dbPath = `${FileSystem.documentDirectory}SQLite/${DB_NAME}`;
      const info = await FileSystem.getInfoAsync(dbPath);
      if (info.exists && 'size' in info) {
        return info.size as number;
      }
    } catch {
      // FileSystem unavailable (e.g., test environment) — fall through.
    }
    // Fallback: count-based estimate.
    const pending = await this.getPending();
    return pending.length * AVG_CHUNK_BYTES;
  }
}
