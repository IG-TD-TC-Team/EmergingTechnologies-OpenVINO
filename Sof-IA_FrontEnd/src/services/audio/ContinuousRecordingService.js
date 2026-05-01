/**
 * ContinuousRecordingService
 *
 * Core orchestrator for continuous background audio recording.
 * Manages the 30-second chunk loop, persists recording state across
 * app restarts, and coordinates strategy + upload + offline queue.
 *
 * State is broadcast to subscribers via a simple listener pattern.
 * DashboardPresenter subscribes in mount() and unsubscribes in unmount().
 *
 * Recording state is also persisted to AsyncStorage so the UI can
 * restore within 200ms if the app is killed and reopened mid-shift.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { capabilities } from '../../config/capabilities';
import { getStorage } from '../../repositories';
import AudioSourceResolver from './AudioSourceResolver';
import ExpoAvRecordingStrategy from './ExpoAvRecordingStrategy';
import WebMediaRecordingStrategy from './WebMediaRecordingStrategy';
import ChunkUploadService from './ChunkUploadService';
import OfflineQueueService from './OfflineQueueService';
import OfflineQueueManager from '../queue/OfflineQueueManager';
import NetworkMonitor from '../network/NetworkMonitor';
import { registerBackgroundQueueSync } from '../../tasks/backgroundQueueSync';
import StorageKeys from '../../constants/storageKeys';

const CHUNK_DURATION_MS = 30_000;
const ASYNC_STATE_KEY = StorageKeys.RECORDING_SESSION_STATE;

const ContinuousRecordingService = {
  // ─── Internal state ───────────────────────────────────────────────────────
  _isRecording: false,
  _sessionId: null,
  _patientId: null,
  _chunkIndex: 0,
  _chunkTimer: null,
  _strategy: null,
  _listeners: [],
  _gapEvents: [],   // { type: 'start'|'stop', timestamp } — audit trail

  // ─── Subscriber API ───────────────────────────────────────────────────────

  /**
   * Subscribe to state changes.
   * Callback receives { isRecording, connectionStatus }.
   * Returns an unsubscribe function.
   */
  subscribe(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((l) => l !== fn); };
  },

  _emit(isRecording, connectionStatus = 'online') {
    this._listeners.forEach((fn) => fn({ isRecording, connectionStatus }));
  },

  // ─── Initialization ───────────────────────────────────────────────────────

  /**
   * Called from DashboardPresenter.mount().
   * Restores recording state from AsyncStorage if the app was killed mid-recording.
   */
  async initialize() {
    try {
      const raw = await AsyncStorage.getItem(ASYNC_STATE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.isRecording && saved.sessionId) {
          console.log('[ContinuousRecording] Restoring recording state for session:', saved.sessionId);
          // Emit immediately for <200ms UI restore
          this._isRecording = true;
          this._sessionId = saved.sessionId;
          this._patientId = saved.patientId ?? null;
          this._chunkIndex = saved.chunkIndex ?? 0;
          this._emit(true, 'online');
          // Resume the chunk loop
          await this._startChunkLoop();
        }
      }

      // Wire the upload function for OfflineQueueManager.retryPending().
      // Uses the same ChunkUploadService path as live recording so retry
      // behaviour is identical to first-attempt behaviour.
      OfflineQueueManager.configure({
        uploadFn: async (chunkRef, sessionId) => {
          try {
            const storage = await getStorage();
            const recording = await storage.read('audio_recordings', chunkRef);
            if (!recording) {
              return { success: false, error: `Recording not found: ${chunkRef}` };
            }
            return ChunkUploadService.upload({
              recordingId: recording.id,
              filePath: recording.file_path,
              sessionId,
              mimeType: recording.format_mime_type,
              patientId: recording.patient_id ?? null,
              timestampStart: recording.started_at
                ? new Date(recording.started_at).getTime()
                : Date.now(),
            });
          } catch (err) {
            return { success: false, error: err?.message ?? 'Upload failed' };
          }
        },
      });

      // Start NetworkMonitor — drives retryPending() on reconnect and
      // exposes useNetworkStatus() to components.
      await NetworkMonitor.start();

      // Register background task so the OS can drain the queue while the app
      // is backgrounded (Android only; no-op on web or without the package).
      await registerBackgroundQueueSync();

      // Legacy connectivity broadcast (keeps DashboardPresenter's connectionStatus
      // state in sync until it migrates to useNetworkStatus()).
      const unsubOffline = OfflineQueueService.subscribe((status) => {
        this._emit(this._isRecording, status);
      });
      this._unsubOffline = unsubOffline;
      await OfflineQueueService.startListening();
    } catch (err) {
      console.warn('[ContinuousRecording] initialize error:', err);
    }
  },

  // ─── Toggle ───────────────────────────────────────────────────────────────

  /**
   * Toggle recording ON or OFF.
   * Called from DashboardPresenter.onMicPress().
   */
  async toggleRecording(sessionId, patientId = null) {
    if (this._isRecording) {
      await this._stopRecording();
    } else {
      await this._startRecording(sessionId, patientId);
    }
  },

  // ─── Start ────────────────────────────────────────────────────────────────

  async _startRecording(sessionId, patientId = null) {
    try {
      this._sessionId = sessionId;
      this._patientId = patientId;
      this._chunkIndex = 0;
      this._gapEvents = [{ type: 'start', timestamp: new Date().toISOString() }];

      this._strategy = capabilities.isWeb
        ? WebMediaRecordingStrategy
        : ExpoAvRecordingStrategy;

      // Resolve active audio source for web (deviceId for getUserMedia)
      const strategy = await AudioSourceResolver.resolve();
      const deviceId = capabilities.isWeb ? await this._resolveWebDeviceId() : null;
      await this._strategy.prepare(sessionId, deviceId);

      this._isRecording = true;
      await this._persistState();
      this._emit(true, 'online');

      await this._startChunkLoop();
    } catch (err) {
      console.error('[ContinuousRecording] Failed to start:', err);
      this._isRecording = false;
      this._emit(false, 'online');
      throw err;
    }
  },

  // ─── Stop ─────────────────────────────────────────────────────────────────

  async _stopRecording() {
    this._isRecording = false;
    this._gapEvents.push({ type: 'stop', timestamp: new Date().toISOString() });

    this._clearChunkTimer();

    // Stop the current in-progress chunk if any
    if (this._strategy?.isActive()) {
      try {
        const result = await this._strategy.stopChunk();
        if (result.uri) {
          await this._processChunk(result);
        }
      } catch (err) {
        console.warn('[ContinuousRecording] Error stopping final chunk:', err);
      }
    }

    await this._strategy?.teardown();
    this._strategy = null;

    await this._clearPersistedState();
    this._emit(false, 'online');
    console.log('[ContinuousRecording] Recording stopped');
  },

  // ─── Chunk loop ───────────────────────────────────────────────────────────

  async _startChunkLoop() {
    await this._recordOneChunk();
  },

  async _recordOneChunk() {
    if (!this._isRecording) return;

    try {
      await this._strategy.startChunk();
    } catch (err) {
      console.error('[ContinuousRecording] startChunk failed:', err);
      this._isRecording = false;
      this._emit(false, 'online');
      return;
    }

    // Schedule stop after CHUNK_DURATION_MS
    this._chunkTimer = setTimeout(async () => {
      if (!this._isRecording) return;

      const gapStart = Date.now();
      let result;
      try {
        result = await this._strategy.stopChunk();
      } catch (err) {
        console.error('[ContinuousRecording] stopChunk failed:', err);
        this._isRecording = false;
        this._emit(false, 'online');
        return;
      }

      const gapMs = Date.now() - gapStart;
      if (gapMs > 50) {
        // Log the stop/start gap as an audit event
        this._gapEvents.push({
          type: 'gap',
          timestamp: new Date().toISOString(),
          durationMs: gapMs,
        });
      }

      await this._processChunk(result);
      this._chunkIndex += 1;

      // Immediately start next chunk
      this._recordOneChunk();
    }, CHUNK_DURATION_MS);
  },

  _clearChunkTimer() {
    if (this._chunkTimer) {
      clearTimeout(this._chunkTimer);
      this._chunkTimer = null;
    }
  },

  // ─── Chunk processing ─────────────────────────────────────────────────────

  async _processChunk({ uri, durationMs, fileSizeBytes }) {
    if (!uri) return;

    const storage = await getStorage();
    const now = new Date().toISOString();
    const isWeb = capabilities.isWeb;
    const mimeType = isWeb ? 'audio/webm' : 'audio/mp4';

    // Create AudioRecording record
    const recording = await storage.create('audio_recordings', {
      session_id: this._sessionId,
      patient_id: this._patientId,
      status: 'stopped',
      audio_source: isWeb ? 'device_mic' : 'device_mic',
      file_path: uri,
      filename: uri.split('/').pop() ?? `chunk_${this._chunkIndex}`,
      file_size_bytes: fileSizeBytes ?? 0,
      duration_seconds: durationMs ? durationMs / 1000 : null,
      format_mime_type: mimeType,
      format_codec: isWeb ? 'opus' : 'aac',
      format_sample_rate: 48000,
      format_channels: 1,
      format_bit_depth: null,
      format_bitrate: 128000,
      started_at: new Date(Date.now() - (durationMs ?? 0)).toISOString(),
      stopped_at: now,
      transcription_id: null,
      uploaded: 0,
      uploaded_at: null,
      quality_score: null,
      noise_level_db: null,
      tags: JSON.stringify([]),
      notes: null,
      error_message: null,
      // Audio data expires with the shift (14h from now)
      expires_at: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
    });

    // Upload immediately — TranscriptionService queues to OfflineQueueManager on failure
    await ChunkUploadService.upload({
      recordingId: recording.id,
      filePath: uri,
      sessionId: this._sessionId,
      mimeType,
      patientId: this._patientId,
    });
  },

  // ─── AsyncStorage persistence ─────────────────────────────────────────────

  async _persistState() {
    try {
      await AsyncStorage.setItem(
        ASYNC_STATE_KEY,
        JSON.stringify({
          isRecording: true,
          sessionId: this._sessionId,
          patientId: this._patientId,
          chunkIndex: this._chunkIndex,
          startedAt: new Date().toISOString(),
        })
      );
    } catch (_) {}
  },

  async _clearPersistedState() {
    try {
      await AsyncStorage.removeItem(ASYNC_STATE_KEY);
    } catch (_) {}
  },

  // ─── Web helper ───────────────────────────────────────────────────────────

  async _resolveWebDeviceId() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      // Prefer USB-C: device labels often contain 'USB' or 'Rode'
      const usb = audioInputs.find(
        (d) => d.label.toLowerCase().includes('usb') || d.label.toLowerCase().includes('rode')
      );
      return usb ? usb.deviceId : null;
    } catch (_) {
      return null;
    }
  },

  // ─── Getters ──────────────────────────────────────────────────────────────

  isRecording() {
    return this._isRecording;
  },

  getSessionId() {
    return this._sessionId;
  },

  getGapEvents() {
    return [...this._gapEvents];
  },
};

export default ContinuousRecordingService;