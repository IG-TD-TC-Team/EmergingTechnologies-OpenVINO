/**
 * ChunkUploadService Tests
 *
 * Covers:
 *   uploadChunk — success (2xx), 4xx non-retry, 5xx retry, network retry,
 *                 recovery on 2nd attempt, FormData shape, delete on success
 *   flushSession — empty queue, all-success, partial failure, sequential order
 */

// ─── Mock OfflineQueueDb ──────────────────────────────────────────────────────

jest.mock('../../services/audio/OfflineQueueDb', () => ({
    __esModule: true,
    default: {
        getBySession: jest.fn(),
        deleteById: jest.fn().mockResolvedValue(undefined),
    },
}));

jest.mock('react-native', () => ({
    Platform: { OS: 'web' },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import ChunkUploadService, {
    MAX_RETRIES,
    _setRetryDelayForTests,
} from '../../services/ChunkUploadService';
import OfflineQueueDb from '../../services/audio/OfflineQueueDb';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChunk(overrides = {}) {
    return {
        id: 'chunk-uuid-1',
        session_id: 'session_abc',
        recording_id: 'rec_001',
        patient_id: null,
        blob: new Blob(['audio'], { type: 'audio/webm' }),
        mime_type: 'audio/webm;codecs=opus',
        chunk_index: 0,
        size_bytes: 5,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

function mockFetch(...responses) {
    let call = 0;
    global.fetch = jest.fn(() => {
        const res = responses[Math.min(call++, responses.length - 1)];
        if (res instanceof Error) return Promise.reject(res);
        return Promise.resolve(res);
    });
}

function ok() { return { ok: true, status: 200 }; }
function status(code) { return { ok: false, status: code }; }
function networkError() { return new TypeError('Failed to fetch'); }

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    _setRetryDelayForTests(0); // no real waiting in tests
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChunkUploadService', () => {

    // ── uploadChunk ────────────────────────────────────────────────────────────

    describe('uploadChunk', () => {

        it('returns success and deletes chunk on 2xx response', async () => {
            mockFetch(ok());
            const chunk = makeChunk();
            const result = await ChunkUploadService.uploadChunk(chunk);

            expect(result.success).toBe(true);
            expect(result.chunkId).toBe(chunk.id);
            expect(OfflineQueueDb.deleteById).toHaveBeenCalledWith(chunk.id);
        });

        it('does NOT delete the chunk on failure', async () => {
            mockFetch(status(500), status(500), status(500));
            await ChunkUploadService.uploadChunk(makeChunk());
            expect(OfflineQueueDb.deleteById).not.toHaveBeenCalled();
        });

        it('returns failure on 4xx without retrying', async () => {
            mockFetch(status(422));
            await ChunkUploadService.uploadChunk(makeChunk());
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('marks 4xx as not retryable', async () => {
            mockFetch(status(400));
            const result = await ChunkUploadService.uploadChunk(makeChunk());
            expect(result.success).toBe(false);
            expect(result.retryable).toBe(false);
        });

        it('retries up to MAX_RETRIES on 5xx', async () => {
            mockFetch(status(503), status(503), status(503));
            await ChunkUploadService.uploadChunk(makeChunk());
            expect(fetch).toHaveBeenCalledTimes(MAX_RETRIES);
        });

        it('retries up to MAX_RETRIES on network error', async () => {
            mockFetch(networkError(), networkError(), networkError());
            await ChunkUploadService.uploadChunk(makeChunk());
            expect(fetch).toHaveBeenCalledTimes(MAX_RETRIES);
        });

        it('marks exhausted retries as retryable', async () => {
            mockFetch(status(500), status(500), status(500));
            const result = await ChunkUploadService.uploadChunk(makeChunk());
            expect(result.success).toBe(false);
            expect(result.retryable).toBe(true);
        });

        it('succeeds on 2nd attempt after initial 5xx', async () => {
            mockFetch(status(503), ok());
            const result = await ChunkUploadService.uploadChunk(makeChunk());
            expect(result.success).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(OfflineQueueDb.deleteById).toHaveBeenCalled();
        });

        it('succeeds on final attempt', async () => {
            mockFetch(status(500), status(500), ok());
            const result = await ChunkUploadService.uploadChunk(makeChunk());
            expect(result.success).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(3);
        });

        it('sends POST to the transcription endpoint', async () => {
            mockFetch(ok());
            await ChunkUploadService.uploadChunk(makeChunk());
            expect(fetch).toHaveBeenCalledWith(
                '/api/transcribe/chunk',
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('includes required FormData fields', async () => {
            let capturedBody;
            global.fetch = jest.fn((url, opts) => {
                capturedBody = opts.body;
                return Promise.resolve(ok());
            });

            const chunk = makeChunk({ session_id: 's1', recording_id: 'r1', chunk_index: 3 });
            await ChunkUploadService.uploadChunk(chunk);

            expect(capturedBody.get('session_id')).toBe('s1');
            expect(capturedBody.get('recording_id')).toBe('r1');
            expect(capturedBody.get('chunk_index')).toBe('3');
            expect(capturedBody.get('mime_type')).toBe('audio/webm;codecs=opus');
            expect(capturedBody.get('audio')).toBeInstanceOf(Blob);
        });

        it('includes patient_id when set', async () => {
            let capturedBody;
            global.fetch = jest.fn((_, opts) => { capturedBody = opts.body; return Promise.resolve(ok()); });

            await ChunkUploadService.uploadChunk(makeChunk({ patient_id: 'patient_bed5' }));
            expect(capturedBody.get('patient_id')).toBe('patient_bed5');
        });

        it('omits patient_id when null', async () => {
            let capturedBody;
            global.fetch = jest.fn((_, opts) => { capturedBody = opts.body; return Promise.resolve(ok()); });

            await ChunkUploadService.uploadChunk(makeChunk({ patient_id: null }));
            expect(capturedBody.get('patient_id')).toBeNull();
        });
    });

    // ── flushSession ──────────────────────────────────────────────────────────

    describe('flushSession', () => {
        it('returns zeros immediately when there are no pending chunks', async () => {
            OfflineQueueDb.getBySession.mockResolvedValue([]);
            global.fetch = jest.fn();
            const result = await ChunkUploadService.flushSession('session_xyz');
            expect(result).toEqual({ uploaded: 0, failed: 0, failedChunks: [] });
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('uploads all chunks and returns correct counts', async () => {
            OfflineQueueDb.getBySession.mockResolvedValue([
                makeChunk({ id: 'c1', chunk_index: 0 }),
                makeChunk({ id: 'c2', chunk_index: 1 }),
                makeChunk({ id: 'c3', chunk_index: 2 }),
            ]);
            mockFetch(ok(), ok(), ok());

            const result = await ChunkUploadService.flushSession('session_abc');
            expect(result.uploaded).toBe(3);
            expect(result.failed).toBe(0);
            expect(result.failedChunks).toHaveLength(0);
        });

        it('reports partial failure correctly', async () => {
            OfflineQueueDb.getBySession.mockResolvedValue([
                makeChunk({ id: 'c1', chunk_index: 0 }),
                makeChunk({ id: 'c2', chunk_index: 1 }),
            ]);
            // First succeeds, second fails all retries
            mockFetch(ok(), status(500), status(500), status(500));

            const result = await ChunkUploadService.flushSession('session_abc');
            expect(result.uploaded).toBe(1);
            expect(result.failed).toBe(1);
            expect(result.failedChunks).toHaveLength(1);
        });

        it('continues uploading after a failed chunk', async () => {
            OfflineQueueDb.getBySession.mockResolvedValue([
                makeChunk({ id: 'c1', chunk_index: 0 }),
                makeChunk({ id: 'c2', chunk_index: 1 }),
                makeChunk({ id: 'c3', chunk_index: 2 }),
            ]);
            // Middle chunk fails all retries
            mockFetch(ok(), status(500), status(500), status(500), ok());

            const result = await ChunkUploadService.flushSession('session_abc');
            expect(result.uploaded).toBe(2);
            expect(result.failed).toBe(1);
        });

        it('uploads in chunk_index order (sequential)', async () => {
            const order = [];
            OfflineQueueDb.getBySession.mockResolvedValue([
                makeChunk({ id: 'c0', chunk_index: 0 }),
                makeChunk({ id: 'c1', chunk_index: 1 }),
            ]);
            global.fetch = jest.fn((_, opts) => {
                order.push(opts.body.get('chunk_index'));
                return Promise.resolve(ok());
            });

            await ChunkUploadService.flushSession('session_abc');
            expect(order).toEqual(['0', '1']);
        });

        it('deletes each successfully uploaded chunk', async () => {
            OfflineQueueDb.getBySession.mockResolvedValue([
                makeChunk({ id: 'c1', chunk_index: 0 }),
                makeChunk({ id: 'c2', chunk_index: 1 }),
            ]);
            mockFetch(ok(), ok());

            await ChunkUploadService.flushSession('session_abc');
            expect(OfflineQueueDb.deleteById).toHaveBeenCalledWith('c1');
            expect(OfflineQueueDb.deleteById).toHaveBeenCalledWith('c2');
        });

        it('does not delete failed chunks', async () => {
            OfflineQueueDb.getBySession.mockResolvedValue([
                makeChunk({ id: 'fail_chunk', chunk_index: 0 }),
            ]);
            mockFetch(status(500), status(500), status(500));

            await ChunkUploadService.flushSession('session_abc');
            expect(OfflineQueueDb.deleteById).not.toHaveBeenCalled();
        });
    });
});
