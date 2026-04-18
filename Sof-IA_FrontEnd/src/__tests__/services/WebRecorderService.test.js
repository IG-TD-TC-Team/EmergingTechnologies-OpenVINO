/**
 * WebRecorderService Tests
 *
 * Verifies MediaRecorder integration:
 *   - isSupported()  codec / API detection
 *   - start()        getUserMedia, MediaRecorder creation, timeslice
 *   - ondataavailable → _saveChunk → offline_queue persistence
 *   - stop()         recorder halt, track release
 *   - isRecording()  state transitions
 *
 * OfflineQueueDb is mocked — chunk storage in real IndexedDB is covered
 * by offline-queue.integration.test.js.
 */

// ─── Mock OfflineQueueDb ──────────────────────────────────────────────────────

jest.mock('../../services/audio/OfflineQueueDb', () => ({
    __esModule: true,
    default: { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../../services/audio/ServiceWorkerManager', () => ({
    __esModule: true,
    default: { register: jest.fn(), requestSync: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('react-native', () => ({
    Platform: { OS: 'web' },
}));

// ─── MediaRecorder mock ───────────────────────────────────────────────────────

class MockMediaRecorder {
    constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        MockMediaRecorder.lastInstance = this;
    }
    start(timeslice) {
        this.state = 'recording';
        this._timeslice = timeslice;
    }
    stop() {
        this.state = 'stopped';
        // flush final chunk (simulates MediaRecorder behaviour)
        if (this.ondataavailable) {
            this.ondataavailable({ data: new Blob(['final'], { type: 'audio/webm' }) });
        }
    }
    emitChunk(blob) {
        if (this.ondataavailable) this.ondataavailable({ data: blob });
    }
}
MockMediaRecorder.isTypeSupported = jest.fn(() => true);
MockMediaRecorder.lastInstance = null;

// ─── navigator mock ───────────────────────────────────────────────────────────

function makeStream(trackCount = 1) {
    const tracks = Array.from({ length: trackCount }, () => ({ stop: jest.fn() }));
    return { getTracks: () => tracks };
}

function setGetUserMedia(stream) {
    global.navigator = {
        mediaDevices: { getUserMedia: jest.fn().mockResolvedValue(stream) },
    };
}

// ─── Subjects (re-imported fresh each test so state doesn't leak) ─────────────

let WebRecorderService;
let OfflineQueueDb;
let MIME_TYPE;

beforeEach(() => {
    jest.resetModules();
    MockMediaRecorder.lastInstance = null;
    global.MediaRecorder = MockMediaRecorder;
    setGetUserMedia(makeStream());

    // Import in dependency order so both point to the same module instance
    OfflineQueueDb = require('../../services/audio/OfflineQueueDb').default;
    const mod = require('../../services/audio/WebRecorderService');
    WebRecorderService = mod.default;
    MIME_TYPE = mod.MIME_TYPE;

    OfflineQueueDb.add.mockClear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WebRecorderService', () => {

    // ── isSupported ────────────────────────────────────────────────────────────

    describe('isSupported', () => {
        it('returns true when MediaRecorder exists and supports the codec', () => {
            MockMediaRecorder.isTypeSupported.mockReturnValue(true);
            expect(WebRecorderService.isSupported()).toBe(true);
        });

        it('returns false when MediaRecorder is absent', () => {
            delete global.MediaRecorder;
            expect(WebRecorderService.isSupported()).toBe(false);
        });

        it('returns false when the codec is not supported', () => {
            MockMediaRecorder.isTypeSupported.mockReturnValue(false);
            expect(WebRecorderService.isSupported()).toBe(false);
        });

        it('uses audio/webm;codecs=opus as the MIME type', () => {
            expect(MIME_TYPE).toBe('audio/webm;codecs=opus');
        });
    });

    // ── isRecording ────────────────────────────────────────────────────────────

    describe('isRecording', () => {
        it('returns false before start', () => {
            expect(WebRecorderService.isRecording()).toBe(false);
        });

        it('returns true after start', async () => {
            await WebRecorderService.start('session_1');
            expect(WebRecorderService.isRecording()).toBe(true);
        });

        it('returns false after stop', async () => {
            await WebRecorderService.start('session_1');
            WebRecorderService.stop();
            expect(WebRecorderService.isRecording()).toBe(false);
        });
    });

    // ── start ──────────────────────────────────────────────────────────────────

    describe('start', () => {
        it('calls getUserMedia with audio:true', async () => {
            await WebRecorderService.start('session_abc');
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
        });

        it('creates a MediaRecorder with the correct MIME type', async () => {
            await WebRecorderService.start('session_abc');
            expect(MockMediaRecorder.lastInstance.options.mimeType).toBe(MIME_TYPE);
        });

        it('starts with a 30-second timeslice', async () => {
            await WebRecorderService.start('session_abc');
            expect(MockMediaRecorder.lastInstance._timeslice).toBe(30_000);
        });

        it('stores the sessionId and optional patientId', async () => {
            await WebRecorderService.start('session_abc', 'patient_xyz');
            expect(WebRecorderService._sessionId).toBe('session_abc');
            expect(WebRecorderService._patientId).toBe('patient_xyz');
        });

        it('assigns a unique recordingId on each start', async () => {
            await WebRecorderService.start('session_1');
            const id1 = WebRecorderService._recordingId;
            WebRecorderService.stop();

            jest.resetModules();
            global.MediaRecorder = MockMediaRecorder;
            setGetUserMedia(makeStream());
            OfflineQueueDb = require('../../services/audio/OfflineQueueDb').default;
            WebRecorderService = require('../../services/audio/WebRecorderService').default;

            await WebRecorderService.start('session_2');
            expect(WebRecorderService._recordingId).not.toBe(id1);
        });

        it('is idempotent — second call while recording is a no-op', async () => {
            await WebRecorderService.start('session_1');
            await WebRecorderService.start('session_1');
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
        });
    });

    // ── stop ───────────────────────────────────────────────────────────────────

    describe('stop', () => {
        it('stops the MediaRecorder', async () => {
            await WebRecorderService.start('session_1');
            const recorder = MockMediaRecorder.lastInstance;
            WebRecorderService.stop();
            expect(recorder.state).toBe('stopped');
        });

        it('stops all stream tracks to release the mic', async () => {
            const stream = makeStream(2);
            setGetUserMedia(stream);
            await WebRecorderService.start('session_1');
            WebRecorderService.stop();
            stream.getTracks().forEach((t) => expect(t.stop).toHaveBeenCalled());
        });

        it('is safe to call when not recording', () => {
            expect(() => WebRecorderService.stop()).not.toThrow();
        });

        it('clears _recorder and _stream references', async () => {
            await WebRecorderService.start('session_1');
            WebRecorderService.stop();
            expect(WebRecorderService._recorder).toBeNull();
            expect(WebRecorderService._stream).toBeNull();
        });
    });

    // ── ondataavailable → _saveChunk ───────────────────────────────────────────

    describe('chunk persistence', () => {
        it('saves a non-empty chunk to OfflineQueueDb', async () => {
            await WebRecorderService.start('session_1', 'patient_a');
            const blob = new Blob(['audio-data'], { type: 'audio/webm' });
            MockMediaRecorder.lastInstance.emitChunk(blob);

            await Promise.resolve();
            expect(OfflineQueueDb.add).toHaveBeenCalledWith(
                expect.objectContaining({
                    session_id: 'session_1',
                    patient_id: 'patient_a',
                    blob,
                    mime_type: MIME_TYPE,
                    chunk_index: 0,
                    size_bytes: blob.size,
                })
            );
        });

        it('increments chunk_index for successive chunks', async () => {
            await WebRecorderService.start('session_1');
            const recorder = MockMediaRecorder.lastInstance;
            recorder.emitChunk(new Blob(['c1']));
            recorder.emitChunk(new Blob(['c2']));
            recorder.emitChunk(new Blob(['c3']));

            await Promise.resolve();
            const indices = OfflineQueueDb.add.mock.calls.map((c) => c[0].chunk_index);
            expect(indices).toEqual([0, 1, 2]);
        });

        it('all chunks from the same recording share a recording_id', async () => {
            await WebRecorderService.start('session_1');
            const recorder = MockMediaRecorder.lastInstance;
            recorder.emitChunk(new Blob(['a']));
            recorder.emitChunk(new Blob(['b']));

            await Promise.resolve();
            const ids = OfflineQueueDb.add.mock.calls.map((c) => c[0].recording_id);
            expect(ids[0]).toBe(ids[1]);
        });

        it('skips empty blobs (size === 0)', async () => {
            await WebRecorderService.start('session_1');
            MockMediaRecorder.lastInstance.emitChunk(new Blob([]));

            await Promise.resolve();
            expect(OfflineQueueDb.add).not.toHaveBeenCalled();
        });

        it('final partial chunk is saved when stop() is called', async () => {
            await WebRecorderService.start('session_1');
            WebRecorderService.stop(); // MockMediaRecorder.stop() emits one final chunk

            await Promise.resolve();
            expect(OfflineQueueDb.add).toHaveBeenCalledTimes(1);
        });
    });
});
