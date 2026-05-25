/**
 * DexieQueueRepository — Web (IndexedDB) backend for IOfflineQueueRepository.
 *
 * Uses a dedicated Dexie database ('sofia_queue') that is completely separate
 * from the main 'sofia_db' used by DexieAdapter.  Isolation means queue
 * migrations never block the main schema and shift-end purges can target
 * just this DB.
 *
 * Schema (version 1):
 *   offline_queue — id (PK), session_id, status, timestamp
 *   Compound index [status+timestamp] makes FIFO dequeue a single indexed scan.
 *
 * getStorageSizeBytes() returns navigator.storage.estimate().usage, which
 * covers the whole IndexedDB origin.  It is an over-estimate but safe for the
 * ">80% full" warning.
 */

import Dexie, { Table } from 'dexie';
import { OfflineQueueEntry } from '../../types/offlineQueue';
import { IOfflineQueueRepository } from './IOfflineQueueRepository';

interface QueueDatabase extends Dexie {
  offline_queue: Table<OfflineQueueEntry>;
}

class _QueueDb extends Dexie {
  offline_queue!: Table<OfflineQueueEntry>;

  constructor() {
    super('sofia_queue');
    this.version(1).stores({
      // id is the primary key.
      // [status+timestamp] compound index enables the FIFO getPending() query.
      offline_queue: 'id, session_id, status, timestamp, [status+timestamp]',
    });
  }
}

export class DexieQueueRepository implements IOfflineQueueRepository {
  private readonly db: _QueueDb;

  constructor() {
    this.db = new _QueueDb();
  }

  // ─── Write ───────────────────────────────────────────────────────────────

  async enqueue(entry: OfflineQueueEntry): Promise<void> {
    // put() upserts — safe to call if a retry re-enqueues an existing id.
    await this.db.offline_queue.put(entry);
  }

  async markSent(id: string): Promise<void> {
    await this.db.offline_queue.update(id, { status: 'sent' });
  }

  async markFailed(id: string): Promise<void> {
    await this.db.offline_queue.update(id, { status: 'failed' });
  }

  async deleteEntry(id: string): Promise<void> {
    await this.db.offline_queue.delete(id);
  }

  async clearBySession(sessionId: string): Promise<void> {
    await this.db.offline_queue.where('session_id').equals(sessionId).delete();
  }

  // ─── Read ────────────────────────────────────────────────────────────────

  /**
   * FIFO dequeue: fetch the single oldest 'pending' entry.
   * Uses the [status+timestamp] compound index — no full-table scan.
   */
  async dequeue(): Promise<OfflineQueueEntry | null> {
    // Dexie compound key range: [status, minTimestamp] → [status, maxTimestamp]
    const entry = await this.db.offline_queue
      .where('[status+timestamp]')
      .between(['pending', Dexie.minKey], ['pending', Dexie.maxKey], true, true)
      .first();

    return entry ?? null;
  }

  async getPending(): Promise<OfflineQueueEntry[]> {
    return this.db.offline_queue
      .where('[status+timestamp]')
      .between(['pending', Dexie.minKey], ['pending', Dexie.maxKey], true, true)
      .toArray();
  }

  async getAll(): Promise<OfflineQueueEntry[]> {
    return this.db.offline_queue.toArray();
  }

  // ─── Storage estimate ────────────────────────────────────────────────────

  async getStorageSizeBytes(): Promise<number> {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      return estimate.usage ?? 0;
    }
    // Fallback: rough count-based estimate (1 MB per pending chunk ≈ 1 min M4A)
    const pending = await this.getPending();
    return pending.length * 1_000_000;
  }
}
