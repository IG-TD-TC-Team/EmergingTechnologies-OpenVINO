/**
 * TranscriptionService
 *
 * Sends audio chunks to POST /api/voice/transcribe-and-structure, persists
 * the response as a transcription_segment, and cleans up the raw audio.
 *
 * On API failure the chunk is handed to OfflineQueueService for retry.
 *
 * TTL for stored segments = session.started_at + 14 hours (not the default 30 days).
 */

import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import { getStorage } from '../repositories';
import { capabilities } from '../config/capabilities';
import SessionService from './SessionService';
import OfflineQueueService from './audio/OfflineQueueService';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.sofia-health.example/v1';
const ENDPOINT = `${API_BASE_URL}/api/voice/transcribe-and-structure`;
console.log('[TranscriptionService] API endpoint:', ENDPOINT);

const TranscriptionService = {

  /**
   * Process one audio chunk end-to-end:
   * upload → persist segment → delete raw audio.
   * On any API failure the chunk is queued for retry.
   *
   * @param {object} params
   * @param {string} params.recordingId    — AudioRecording.id in DB
   * @param {string} params.filePath       — indexeddb://audio-blobs/<uuid> (web)
   *                                         or file:///... (Android)
   * @param {string} params.sessionId      — session_id string
   * @param {string} params.mimeType       — 'audio/webm' | 'audio/mp4'
   * @param {number} params.timestampStart — recording start time in ms
   */
  async processChunk({ recordingId, filePath, sessionId, mimeType, patientId = null, timestampStart }) {
    try {
      const session = await SessionService.getActiveShift();
      const nurseId = session?.nurse_name ?? 'unknown';

      const formData = await this._buildFormData(filePath, mimeType);
      formData.append('session_id', sessionId);
      formData.append('timestamp_start', String(timestampStart));
      formData.append('nurse_id', nurseId);

      const response = await fetch(ENDPOINT, { method: 'POST', body: formData });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data = await response.json();

      await this._persistSegment(data, recordingId, sessionId, session, patientId);
      await this._markRecordingTranscribed(recordingId);
      await this._deleteRawAudio(filePath);

      console.log('[TranscriptionService] Chunk processed — recording:', recordingId);
      return { success: true };
    } catch (error) {
      console.warn('[TranscriptionService] Chunk failed, queuing for retry:', error.message);
      await OfflineQueueService.enqueue(recordingId, sessionId);
      return { success: false, error: error.message };
    }
  },

  // ─── Private helpers ───────────────────────────────────────────────────────

  async _buildFormData(filePath, mimeType) {
    const formData = new FormData();

    if (capabilities.isWeb) {
      const blob = await this._readBlobFromDexie(filePath);
      formData.append('audio', blob, 'chunk.webm');
    } else {
      const filename = filePath.split('/').pop();
      formData.append('audio', {
        uri: filePath,
        name: filename,
        type: mimeType ?? 'audio/mp4',
      });
    }

    return formData;
  },

  async _readBlobFromDexie(filePath) {
    // filePath format: indexeddb://audio-blobs/<uuid>
    const blobId = filePath.replace('indexeddb://audio-blobs/', '');
    const storage = await getStorage();
    const record = await storage.read('audio_blobs', blobId);
    if (!record) throw new Error(`Blob not found in IndexedDB: ${blobId}`);
    return record.blob;
  },

  async _persistSegment(apiResponse, recordingId, sessionId, session, patientId = null) {
    const storage = await getStorage();

    // TTL = session start + 14h (not the default 30-day fallback in DexieAdapter.create)
    const startedAt = session?.started_at ?? new Date().toISOString();
    const expiresAt = new Date(
      new Date(startedAt).getTime() + 14 * 60 * 60 * 1000
    ).toISOString();

    await storage.create('transcription_segments', {
      id: uuidv4(),
      session_id: sessionId,
      audio_recording_id: recordingId,
      transcript: apiResponse.transcript ?? '',
      structured_json: apiResponse.structured
        ? JSON.stringify(apiResponse.structured)
        : null,
      language: apiResponse.language ?? 'fr',
      confidence: apiResponse.confidence ?? null,
      ts_start: apiResponse.timestamp_start ?? null,
      ts_end: apiResponse.timestamp_end ?? null,
      bed_id: patientId,
      expires_at: expiresAt,
    });
  },

  async _markRecordingTranscribed(recordingId) {
    const storage = await getStorage();
    await storage.update('audio_recordings', recordingId, {
      status: 'transcribed',
      uploaded: 1,
      uploaded_at: new Date().toISOString(),
    });
  },

  async _deleteRawAudio(filePath) {
    try {
      if (capabilities.isWeb) {
        const blobId = filePath.replace('indexeddb://audio-blobs/', '');
        const storage = await getStorage();
        await storage.delete('audio_blobs', blobId);
      } else {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      }
    } catch (err) {
      // Non-fatal — raw audio cleanup failure should not fail the transcription
      console.warn('[TranscriptionService] Failed to delete raw audio:', err.message);
    }
  },
};

export default TranscriptionService;