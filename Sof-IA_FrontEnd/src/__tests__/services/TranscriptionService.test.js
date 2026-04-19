/**
 * TranscriptionService — Unit Tests
 *
 * Covers:
 *   processChunk success → segment persisted, recording marked, raw audio deleted
 *   processChunk failure → enqueued in OfflineQueueService, no segment written
 *   TTL calculation      → expires_at = session.started_at + 14h
 *   Platform paths       → web (IndexedDB delete) and native (FileSystem.deleteAsync)
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockStorage = {
    create: jest.fn().mockResolvedValue({ id: 'seg-uuid-1' }),
    read:   jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../repositories', () => ({
    getStorage: jest.fn().mockResolvedValue(mockStorage),
}));

const mockSession = {
    session_id: 'session_20260419_080000',
    nurse_name: 'Marie Dupont',
    started_at: '2026-04-19T08:00:00.000Z',
};

jest.mock('../../services/SessionService', () => ({
    __esModule: true,
    default: { getActiveShift: jest.fn() },
}));

jest.mock('../../services/audio/OfflineQueueService', () => ({
    __esModule: true,
    default: { enqueue: jest.fn().mockResolvedValue(undefined) },
}));

const mockDeleteAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-file-system', () => ({
    deleteAsync: mockDeleteAsync,
}));

// Capabilities — toggled per describe block
const mockCapabilities = { isWeb: true };
jest.mock('../../config/capabilities', () => ({
    capabilities: mockCapabilities,
}));

jest.mock('uuid', () => ({ v4: () => 'seg-uuid-1' }));

// ─── Imports ──────────────────────────────────────────────────────────────────

import TranscriptionService from '../../services/TranscriptionService';
import SessionService       from '../../services/SessionService';
import OfflineQueueService  from '../../services/audio/OfflineQueueService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API_RESPONSE = {
    transcript:      'Patient Alice en chambre 3.',
    structured:      { patient_name: 'Alice', room: '3', vitals: null, medications: null, actions: null, activity_type: 'assessment' },
    language:        'fr',
    confidence:      0.92,
    timestamp_start: 1713513600000,
    timestamp_end:   1713513615000,
};

function mockFetchOk() {
    global.fetch = jest.fn().mockResolvedValue({
        ok:   true,
        status: 200,
        json: jest.fn().mockResolvedValue(API_RESPONSE),
    });
}

function mockFetchFail(status = 500) {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status });
}

function mockFetchThrow(msg = 'Network error') {
    global.fetch = jest.fn().mockRejectedValue(new TypeError(msg));
}

const WEB_CHUNK = {
    recordingId:     'rec-001',
    filePath:        'indexeddb://audio-blobs/blob-uuid-1',
    sessionId:       'session_20260419_080000',
    mimeType:        'audio/webm',
    timestampStart:  1713513600000,
};

const NATIVE_CHUNK = {
    ...WEB_CHUNK,
    filePath: 'file:///data/user/0/com.sofia/files/chunk_rec-001.m4a',
    mimeType: 'audio/mp4',
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    mockCapabilities.isWeb = true;
    SessionService.getActiveShift.mockResolvedValue(mockSession);
    mockStorage.read.mockResolvedValue({ id: 'blob-uuid-1', blob: new Blob(['audio']) });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TranscriptionService', () => {

    // ── processChunk — success (web) ──────────────────────────────────────────

    describe('processChunk — success (web)', () => {

        it('returns { success: true }', async () => {
            mockFetchOk();
            const result = await TranscriptionService.processChunk(WEB_CHUNK);
            expect(result.success).toBe(true);
        });

        it('POSTs to /api/voice/transcribe-and-structure', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(WEB_CHUNK);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/voice/transcribe-and-structure'),
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('includes session_id, timestamp_start, and nurse_id in FormData', async () => {
            let capturedBody;
            global.fetch = jest.fn((_, opts) => {
                capturedBody = opts.body;
                return Promise.resolve({ ok: true, status: 200, json: jest.fn().mockResolvedValue(API_RESPONSE) });
            });

            await TranscriptionService.processChunk(WEB_CHUNK);

            expect(capturedBody.get('session_id')).toBe(WEB_CHUNK.sessionId);
            expect(capturedBody.get('timestamp_start')).toBe(String(WEB_CHUNK.timestampStart));
            expect(capturedBody.get('nurse_id')).toBe(mockSession.nurse_name);
            expect(capturedBody.get('audio')).toBeInstanceOf(Blob);
        });

        it('persists a transcription_segment with the API response data', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(WEB_CHUNK);

            expect(mockStorage.create).toHaveBeenCalledWith(
                'transcription_segments',
                expect.objectContaining({
                    session_id:          WEB_CHUNK.sessionId,
                    audio_recording_id:  WEB_CHUNK.recordingId,
                    transcript:          API_RESPONSE.transcript,
                    language:            API_RESPONSE.language,
                    confidence:          API_RESPONSE.confidence,
                    ts_start:            API_RESPONSE.timestamp_start,
                    ts_end:              API_RESPONSE.timestamp_end,
                })
            );
        });

        it('stores structured_json as a JSON string', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(WEB_CHUNK);

            const call = mockStorage.create.mock.calls[0];
            const segment = call[1];
            expect(typeof segment.structured_json).toBe('string');
            expect(JSON.parse(segment.structured_json)).toEqual(API_RESPONSE.structured);
        });

        it('sets expires_at = session.started_at + 14h', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(WEB_CHUNK);

            const expectedExpiry = new Date(
                new Date(mockSession.started_at).getTime() + 14 * 60 * 60 * 1000
            ).toISOString();

            const segment = mockStorage.create.mock.calls[0][1];
            expect(segment.expires_at).toBe(expectedExpiry);
        });

        it('marks the audio_recording status as transcribed', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(WEB_CHUNK);

            expect(mockStorage.update).toHaveBeenCalledWith(
                'audio_recordings',
                WEB_CHUNK.recordingId,
                expect.objectContaining({ status: 'transcribed', uploaded: 1 })
            );
        });

        it('deletes the blob from audio_blobs on web', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(WEB_CHUNK);

            expect(mockStorage.delete).toHaveBeenCalledWith(
                'audio_blobs',
                'blob-uuid-1'
            );
        });

        it('does NOT enqueue to OfflineQueueService on success', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(WEB_CHUNK);
            expect(OfflineQueueService.enqueue).not.toHaveBeenCalled();
        });
    });

    // ── processChunk — success (native) ──────────────────────────────────────

    describe('processChunk — success (native)', () => {

        beforeEach(() => { mockCapabilities.isWeb = false; });

        it('calls FileSystem.deleteAsync on native', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(NATIVE_CHUNK);
            expect(mockDeleteAsync).toHaveBeenCalledWith(NATIVE_CHUNK.filePath, { idempotent: true });
        });

        it('does NOT call storage.delete on native', async () => {
            mockFetchOk();
            await TranscriptionService.processChunk(NATIVE_CHUNK);
            expect(mockStorage.delete).not.toHaveBeenCalled();
        });
    });

    // ── processChunk — failure path ───────────────────────────────────────────

    describe('processChunk — failure path', () => {

        it('enqueues the recording in OfflineQueueService on API error status', async () => {
            mockFetchFail(500);
            await TranscriptionService.processChunk(WEB_CHUNK);

            expect(OfflineQueueService.enqueue).toHaveBeenCalledWith(
                WEB_CHUNK.recordingId,
                WEB_CHUNK.sessionId
            );
        });

        it('enqueues on network error (fetch throws)', async () => {
            mockFetchThrow('Failed to fetch');
            await TranscriptionService.processChunk(WEB_CHUNK);

            expect(OfflineQueueService.enqueue).toHaveBeenCalledWith(
                WEB_CHUNK.recordingId,
                WEB_CHUNK.sessionId
            );
        });

        it('returns { success: false } on failure', async () => {
            mockFetchFail(503);
            const result = await TranscriptionService.processChunk(WEB_CHUNK);
            expect(result.success).toBe(false);
            expect(result.error).toBeTruthy();
        });

        it('does NOT persist a segment on failure', async () => {
            mockFetchFail(500);
            await TranscriptionService.processChunk(WEB_CHUNK);
            expect(mockStorage.create).not.toHaveBeenCalled();
        });

        it('does NOT mark the recording as transcribed on failure', async () => {
            mockFetchFail(500);
            await TranscriptionService.processChunk(WEB_CHUNK);
            expect(mockStorage.update).not.toHaveBeenCalled();
        });

        it('does NOT delete raw audio on failure', async () => {
            mockFetchFail(500);
            await TranscriptionService.processChunk(WEB_CHUNK);
            expect(mockStorage.delete).not.toHaveBeenCalled();
            expect(mockDeleteAsync).not.toHaveBeenCalled();
        });
    });

    // ── nurse_id fallback ─────────────────────────────────────────────────────

    describe('nurse_id fallback', () => {

        it('uses "unknown" as nurse_id when no active session', async () => {
            SessionService.getActiveShift.mockResolvedValue(null);
            let capturedBody;
            global.fetch = jest.fn((_, opts) => {
                capturedBody = opts.body;
                return Promise.resolve({ ok: true, status: 200, json: jest.fn().mockResolvedValue(API_RESPONSE) });
            });

            await TranscriptionService.processChunk(WEB_CHUNK);
            expect(capturedBody.get('nurse_id')).toBe('unknown');
        });
    });
});