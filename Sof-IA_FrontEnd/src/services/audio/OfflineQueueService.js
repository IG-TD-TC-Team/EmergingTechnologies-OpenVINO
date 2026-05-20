/**
 * OfflineQueueService
 *
 * Persists failed-upload chunks and retries them when connectivity is restored.
 *
 * Queue record shape (recording_queue table):
 *   id, session_id, chunk_ref (AudioRecording.id), retry_count, status, last_attempt_at
 *
 * Retry strategy: exponential back-off — 5s, 10s, 20s, 40s, cap 60s.
 * Connectivity detection: navigator.onLine (Web) / NetInfo (native) via listeners.
 */

import { Platform } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { getStorage } from '../../repositories';
// TranscriptionService is required lazily in _retryItem to break the circular
// dependency: TranscriptionService → OfflineQueueService → TranscriptionService

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60000;

const OfflineQueueService = {
  _listeners: [],       // connection-status subscribers
  _draining: false,
  _netInfoSub: null,
  _onlineListener: null,

  // ─── Connection status ────────────────────────────────────────────────────

  /**
   * Subscribe to connection status changes.
   * Callback receives 'online' | 'offline-buffering'.
   */
  subscribe(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((l) => l !== fn); };
  },

  _emit(status) {
    this._listeners.forEach((fn) => fn(status));
  },

  /**
   * Start listening to network state changes.
   * Called once from ContinuousRecordingService when recording begins.
   */
  async startListening() {
    if (Platform.OS === 'web') {
      this._onlineListener = () => {
        this._emit('online');
        this.drainQueue();
      };
      const offlineListener = () => this._emit('offline-buffering');
      window.addEventListener('online', this._onlineListener);
      window.addEventListener('offline', offlineListener);
    } else {
      // Native: use @react-native-community/netinfo if available
      try {
        const NetInfo = require('@react-native-community/netinfo').default;
        this._netInfoSub = NetInfo.addEventListener((state) => {
          if (state.isConnected) {
            this._emit('online');
            this.drainQueue();
          } else {
            this._emit('offline-buffering');
          }
        });
      } catch (_) {
        console.warn('[OfflineQueue] NetInfo not available — skipping native connectivity listener');
      }
    }
  },

  stopListening() {
    if (this._onlineListener) {
      window.removeEventListener('online', this._onlineListener);
      this._onlineListener = null;
    }
    if (this._netInfoSub) {
      this._netInfoSub();
      this._netInfoSub = null;
    }
  },

  // ─── Queue management ─────────────────────────────────────────────────────

  /**
   * Add a failed chunk to the retry queue.
   *
   * @param {string} chunkRef   — AudioRecording.id
   * @param {string} sessionId
   */
  async enqueue(chunkRef, sessionId) {
    const storage = await getStorage();
    await storage.create('recording_queue', {
      session_id: sessionId,
      chunk_ref: chunkRef,
      retry_count: 0,
      status: 'pending',
      last_attempt_at: null,
      expires_at: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
    });
    console.log('[OfflineQueue] Chunk enqueued:', chunkRef);
    this._emit('offline-buffering');
  },

  /**
   * Drain all pending/retrying queue entries.
   * Called on app foreground or connectivity restore.
   */
  async drainQueue() {
    if (this._draining) return;
    this._draining = true;

    try {
      const storage = await getStorage();
      const [pendingItems, retryingItems] = await Promise.all([
        storage.findByField('recording_queue', 'status', 'pending'),
        storage.findByField('recording_queue', 'status', 'retrying'),
      ]);
      const pending = [...pendingItems, ...retryingItems];

      if (pending.length === 0) {
        this._draining = false;
        return;
      }

      console.log('[OfflineQueue] Draining', pending.length, 'queued chunk(s)');

      for (const item of pending) {
        await this._retryItem(item, storage);
      }

      // Check if any remain
      const [remainPending, remainRetrying] = await Promise.all([
        storage.findByField('recording_queue', 'status', 'pending'),
        storage.findByField('recording_queue', 'status', 'retrying'),
      ]);
      if (remainPending.length === 0 && remainRetrying.length === 0) this._emit('online');
    } catch (err) {
      console.error('[OfflineQueue] Drain error:', err);
    } finally {
      this._draining = false;
    }
  },

  async _retryItem(item, storage) {
    if (item.retry_count >= MAX_RETRIES) {
      await storage.update('recording_queue', item.id, { status: 'failed' });
      console.warn('[OfflineQueue] Max retries reached for chunk:', item.chunk_ref);
      return;
    }

    // Exponential back-off wait
    const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, item.retry_count), MAX_BACKOFF_MS);
    await new Promise((r) => setTimeout(r, backoff));

    await storage.update('recording_queue', item.id, {
      status: 'retrying',
      retry_count: item.retry_count + 1,
      last_attempt_at: new Date().toISOString(),
    });

    // Read the AudioRecording to get file path
    const recording = await storage.read('audio_recordings', item.chunk_ref);
    if (!recording) {
      await storage.update('recording_queue', item.id, { status: 'failed' });
      return;
    }

    const TranscriptionService = require('../TranscriptionService').default;
    const result = await TranscriptionService.processChunk({
      recordingId: recording.id,
      filePath: recording.file_path,
      sessionId: recording.session_id,
      mimeType: recording.format_mime_type,
      patientId: recording.patient_id ?? null,
      timestampStart: recording.started_at ? new Date(recording.started_at).getTime() : Date.now(),
    });

    if (result.success) {
      await storage.update('recording_queue', item.id, { status: 'uploaded' });
      console.log('[OfflineQueue] Retry succeeded for chunk:', item.chunk_ref);
    } else {
      await storage.update('recording_queue', item.id, { status: 'pending' });
    }
  },
};

export default OfflineQueueService;