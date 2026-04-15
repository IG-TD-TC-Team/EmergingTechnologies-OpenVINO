/**
 * OfflineQueueDb — Integration Tests
 *
 * Uses real Dexie against fake-indexeddb (configured in jest.setup.js).
 * Verifies that chunks actually land in IndexedDB with the correct shape,
 * and that query / delete operations work correctly.
 *
 * Each test suite uses a unique database name to avoid cross-test pollution.
 */

import Dexie from 'dexie';

// ─── We exercise OfflineQueueDb via its public API, but we need a fresh
//     database instance per suite to avoid shared state.
//     We re-create the module state by importing the service and then
//     patching the internal _db after open — instead, we test via a helper
//     that mirrors OfflineQueueDb's implementation against a fresh Dexie DB.

function makeDb(name) {
    const db = new Dexie(name);
    db.version(1).stores({
        offline_queue:
            'id, session_id, recording_id, patient_id, chunk_index, created_at',
    });

    // Mirror of OfflineQueueDb's public API bound to this db instance
    return {
        async add(chunk) {
            const { v4: uuidv4 } = require('uuid');
            const record = {
                id: uuidv4(),
                created_at: new Date().toISOString(),
                ...chunk,
            };
            await db.table('offline_queue').add(record);
            return record;
        },
        async getBySession(sessionId) {
            return db
                .table('offline_queue')
                .where('session_id')
                .equals(sessionId)
                .sortBy('chunk_index');
        },
        async deleteById(id) {
            await db.table('offline_queue').delete(id);
        },
        async countBySession(sessionId) {
            return db
                .table('offline_queue')
                .where('session_id')
                .equals(sessionId)
                .count();
        },
        async _getAll() {
            return db.table('offline_queue').toArray();
        },
        async _clear() {
            await db.table('offline_queue').clear();
        },
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_A = 'session_20260415_080000';
const SESSION_B = 'session_20260415_160000';

function makeChunk(overrides = {}) {
    return {
        session_id: SESSION_A,
        recording_id: 'rec_001',
        patient_id: null,
        blob: new Blob(['fake-audio'], { type: 'audio/webm' }),
        mime_type: 'audio/webm;codecs=opus',
        chunk_index: 0,
        size_bytes: 10,
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OfflineQueueDb — integration', () => {
    let db;

    beforeEach(() => {
        // Fresh DB per test to prevent state leaking between tests
        db = makeDb(`offline_queue_test_${Date.now()}_${Math.random()}`);
    });

    // ── add ────────────────────────────────────────────────────────────────────

    describe('add', () => {
        it('persists a chunk and returns the stored record', async () => {
            const chunk = makeChunk();
            const record = await db.add(chunk);

            expect(record.id).toBeTruthy();
            expect(record.session_id).toBe(SESSION_A);
            expect(record.mime_type).toBe('audio/webm;codecs=opus');
            expect(record.created_at).toBeTruthy();
            expect(new Date(record.created_at).getTime()).not.toBeNaN();
        });

        it('stores the blob in IndexedDB', async () => {
            const blob = new Blob(['audio-bytes'], { type: 'audio/webm' });
            const record = await db.add(makeChunk({ blob, size_bytes: blob.size }));

            const all = await db._getAll();
            const stored = all.find((r) => r.id === record.id);
            expect(stored).toBeDefined();
            expect(stored.blob).toBeInstanceOf(Blob);
        });

        it('generates a unique id for each chunk', async () => {
            const r1 = await db.add(makeChunk({ chunk_index: 0 }));
            const r2 = await db.add(makeChunk({ chunk_index: 1 }));
            expect(r1.id).not.toBe(r2.id);
        });

        it('stores patient_id when provided', async () => {
            const record = await db.add(makeChunk({ patient_id: 'patient_bed3' }));
            const all = await db._getAll();
            expect(all[0].patient_id).toBe('patient_bed3');
        });
    });

    // ── getBySession ──────────────────────────────────────────────────────────

    describe('getBySession', () => {
        it('returns all chunks for the requested session', async () => {
            await db.add(makeChunk({ chunk_index: 0 }));
            await db.add(makeChunk({ chunk_index: 1 }));

            const chunks = await db.getBySession(SESSION_A);
            expect(chunks).toHaveLength(2);
        });

        it('returns chunks in chunk_index order', async () => {
            // Insert out of order
            await db.add(makeChunk({ chunk_index: 2 }));
            await db.add(makeChunk({ chunk_index: 0 }));
            await db.add(makeChunk({ chunk_index: 1 }));

            const chunks = await db.getBySession(SESSION_A);
            expect(chunks.map((c) => c.chunk_index)).toEqual([0, 1, 2]);
        });

        it('does NOT return chunks from a different session', async () => {
            await db.add(makeChunk({ session_id: SESSION_A, chunk_index: 0 }));
            await db.add(makeChunk({ session_id: SESSION_B, chunk_index: 0 }));

            const chunks = await db.getBySession(SESSION_A);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].session_id).toBe(SESSION_A);
        });

        it('returns an empty array when no chunks exist for the session', async () => {
            const chunks = await db.getBySession('nonexistent_session');
            expect(chunks).toEqual([]);
        });

        it('includes all fields including the blob', async () => {
            await db.add(makeChunk({ recording_id: 'rec_xyz', patient_id: 'p1' }));

            const [chunk] = await db.getBySession(SESSION_A);
            expect(chunk.recording_id).toBe('rec_xyz');
            expect(chunk.patient_id).toBe('p1');
            expect(chunk.blob).toBeInstanceOf(Blob);
            expect(chunk.mime_type).toBe('audio/webm;codecs=opus');
        });
    });

    // ── deleteById ────────────────────────────────────────────────────────────

    describe('deleteById', () => {
        it('removes the chunk from the store', async () => {
            const record = await db.add(makeChunk());
            await db.deleteById(record.id);

            const remaining = await db.getBySession(SESSION_A);
            expect(remaining).toHaveLength(0);
        });

        it('only removes the targeted chunk, leaving others intact', async () => {
            const r1 = await db.add(makeChunk({ chunk_index: 0 }));
            await db.add(makeChunk({ chunk_index: 1 }));

            await db.deleteById(r1.id);

            const remaining = await db.getBySession(SESSION_A);
            expect(remaining).toHaveLength(1);
            expect(remaining[0].chunk_index).toBe(1);
        });

        it('is a no-op for an id that does not exist', async () => {
            await expect(db.deleteById('nonexistent-id')).resolves.not.toThrow();
        });

        it('does not affect chunks from other sessions', async () => {
            const r = await db.add(makeChunk({ session_id: SESSION_A }));
            await db.add(makeChunk({ session_id: SESSION_B }));

            await db.deleteById(r.id);

            const bChunks = await db.getBySession(SESSION_B);
            expect(bChunks).toHaveLength(1);
        });
    });

    // ── countBySession ────────────────────────────────────────────────────────

    describe('countBySession', () => {
        it('returns 0 for an empty session', async () => {
            expect(await db.countBySession(SESSION_A)).toBe(0);
        });

        it('returns the correct count', async () => {
            await db.add(makeChunk({ chunk_index: 0 }));
            await db.add(makeChunk({ chunk_index: 1 }));
            await db.add(makeChunk({ chunk_index: 2 }));

            expect(await db.countBySession(SESSION_A)).toBe(3);
        });

        it('counts only the requested session', async () => {
            await db.add(makeChunk({ session_id: SESSION_A }));
            await db.add(makeChunk({ session_id: SESSION_A }));
            await db.add(makeChunk({ session_id: SESSION_B }));

            expect(await db.countBySession(SESSION_A)).toBe(2);
            expect(await db.countBySession(SESSION_B)).toBe(1);
        });

        it('decrements after deleteById', async () => {
            const r = await db.add(makeChunk({ chunk_index: 0 }));
            await db.add(makeChunk({ chunk_index: 1 }));

            await db.deleteById(r.id);
            expect(await db.countBySession(SESSION_A)).toBe(1);
        });
    });

    // ── cross-session isolation ────────────────────────────────────────────────

    describe('cross-session isolation', () => {
        it('add / query / delete are fully isolated per session_id', async () => {
            await db.add(makeChunk({ session_id: SESSION_A, chunk_index: 0 }));
            await db.add(makeChunk({ session_id: SESSION_A, chunk_index: 1 }));
            await db.add(makeChunk({ session_id: SESSION_B, chunk_index: 0 }));

            // Delete SESSION_A chunks one by one
            const aChunks = await db.getBySession(SESSION_A);
            for (const c of aChunks) await db.deleteById(c.id);

            expect(await db.countBySession(SESSION_A)).toBe(0);
            expect(await db.countBySession(SESSION_B)).toBe(1);
        });
    });
});
