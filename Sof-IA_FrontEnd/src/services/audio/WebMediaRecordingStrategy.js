/**
 * WebMediaRecordingStrategy
 *
 * Web/Chrome recording strategy using the MediaRecorder API.
 * Records in WebM/Opus format. Each chunk Blob is persisted to
 * IndexedDB (Dexie `audio_blobs` table) so it survives page reloads.
 *
 * file_path convention: `indexeddb://audio-blobs/<uuid>`
 * ChunkUploadService reads the blob from Dexie using this key.
 *
 * Interface (shared with ExpoAvRecordingStrategy):
 *   prepare(sessionId, deviceId?)  — getUserMedia, store stream
 *   startChunk()                   — begin MediaRecorder
 *   stopChunk()                    → { uri, durationMs, fileSizeBytes }
 *   teardown()                     — stop tracks, release stream
 */

import { v4 as uuidv4 } from 'uuid';
import { getStorage } from '../../repositories';

const MIME_TYPE = 'audio/webm;codecs=opus';

const WebMediaRecordingStrategy = {
  _stream: null,
  _mediaRecorder: null,
  _chunks: [],
  _chunkStartTime: null,
  _sessionId: null,

  /**
   * Acquire the microphone stream.
   * Prefers the USB-C mic if deviceId is provided (from AudioSourceResolver).
   */
  async prepare(sessionId, deviceId = null) {
    this._sessionId = sessionId;

    const constraints = {
      audio: deviceId
        ? { deviceId: { exact: deviceId }, sampleRate: 16000, channelCount: 1 }
        : { sampleRate: 16000, channelCount: 1 },
    };

    this._stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('[WebMedia] Strategy prepared for session:', sessionId);
  },

  /**
   * Begin recording a new chunk.
   * Creates a fresh MediaRecorder instance on the existing stream.
   */
  async startChunk() {
    if (!this._stream) {
      throw new Error('[WebMedia] prepare() must be called before startChunk()');
    }

    this._chunks = [];
    this._chunkStartTime = Date.now();

    const mimeType = MediaRecorder.isTypeSupported(MIME_TYPE) ? MIME_TYPE : 'audio/webm';
    this._mediaRecorder = new MediaRecorder(this._stream, { mimeType });

    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };

    this._mediaRecorder.start();
    console.log('[WebMedia] Chunk started');
  },

  /**
   * Stop the current chunk, persist the Blob to IndexedDB, and return the file reference.
   */
  async stopChunk() {
    if (!this._mediaRecorder) {
      throw new Error('[WebMedia] stopChunk called with no active recorder');
    }

    const durationMs = Date.now() - (this._chunkStartTime ?? Date.now());

    // Stop the recorder and wait for the final dataavailable event
    await new Promise((resolve, reject) => {
      this._mediaRecorder.onstop = resolve;
      this._mediaRecorder.onerror = (e) => reject(e.error);
      this._mediaRecorder.stop();
    });

    const mimeType = this._mediaRecorder.mimeType || MIME_TYPE;
    const blob = new Blob(this._chunks, { type: mimeType });
    const blobId = uuidv4();

    // Persist blob to IndexedDB under audio_blobs table
    const storage = await getStorage();
    await storage.create('audio_blobs', {
      id: blobId,
      session_id: this._sessionId,
      blob,
      mime_type: mimeType,
      size_bytes: blob.size,
      created_at: new Date().toISOString(),
      // Short TTL: 14h (shift max) — purgeExpired handles cleanup
      expires_at: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
    });

    const uri = `indexeddb://audio-blobs/${blobId}`;
    console.log('[WebMedia] Chunk stopped — uri:', uri, 'size:', blob.size);

    this._chunks = [];
    this._mediaRecorder = null;
    this._chunkStartTime = null;

    return { uri, durationMs, fileSizeBytes: blob.size };
  },

  /**
   * Stop the microphone stream and release all resources.
   */
  async teardown() {
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      try { this._mediaRecorder.stop(); } catch (_) {}
    }

    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }

    this._mediaRecorder = null;
    this._chunks = [];
    this._sessionId = null;
    console.log('[WebMedia] Strategy torn down');
  },

  isActive() {
    return this._mediaRecorder !== null && this._mediaRecorder.state === 'recording';
  },
};

export default WebMediaRecordingStrategy;