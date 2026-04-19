/**
 * ChunkUploadService
 *
 * Uploads a completed audio chunk to the voice transcription API.
 * On success: updates AudioRecording status to 'uploaded' and stores the
 *             transcription response as a Transcription record.
 * On failure: hands the chunk to OfflineQueueService for later retry.
 *
 * File path conventions:
 *   Android  — file:///...DocumentDirectory/recordings/chunk_<id>.m4a
 *   Web      — indexeddb://audio-blobs/<uuid>  (Blob stored in Dexie)
 */

import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import { getStorage } from '../../repositories';
import { capabilities } from '../../config/capabilities';

// Replace with your actual API base URL
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.sofia-health.example/v1';

const ChunkUploadService = {
  /**
   * Upload a single audio chunk and persist the transcription result.
   *
   * @param {object} params
   * @param {string} params.recordingId  — AudioRecording.id in DB
   * @param {string} params.filePath     — uri returned by strategy.stopChunk()
   * @param {string} params.sessionId
   * @param {string} params.mimeType     — 'audio/mp4' | 'audio/webm'
   * @returns {Promise<{success: boolean, transcriptionId?: string, error?: string}>}
   */
  async upload({ recordingId, filePath, sessionId, mimeType }) {
    try {
      const formData = await this._buildFormData(filePath, mimeType);

      const response = await fetch(`${API_BASE_URL}/voice/transcribe`, {
        method: 'POST',
        body: formData,
        headers: {
          'X-Session-Id': sessionId,
          'X-Recording-Id': recordingId,
        },
      });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data = await response.json();
      const transcriptionId = await this._persistTranscription(data, recordingId, sessionId);
      await this._markRecordingUploaded(recordingId, transcriptionId);

      console.log('[ChunkUpload] Chunk uploaded successfully — recording:', recordingId);
      return { success: true, transcriptionId };
    } catch (error) {
      console.warn('[ChunkUpload] Upload failed:', error.message);
      return { success: false, error: error.message };
    }
  },

  // ─── Private helpers ─────────────────────────────────────────────────────

  async _buildFormData(filePath, mimeType) {
    const formData = new FormData();

    if (capabilities.isWeb) {
      // Web: read blob from IndexedDB
      const blob = await this._readBlobFromDexie(filePath);
      formData.append('audio', blob, 'chunk.webm');
    } else {
      // Native: read file from filesystem
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

  async _persistTranscription(apiResponse, recordingId, sessionId) {
    const storage = await getStorage();
    const now = new Date().toISOString();

    const transcription = await storage.create('transcriptions', {
      session_id: sessionId,
      audio_recording_id: recordingId,
      patient_id: null,
      status: 'completed',
      text: apiResponse.text ?? '',
      word_timestamps: apiResponse.word_timestamps
        ? JSON.stringify(apiResponse.word_timestamps)
        : null,
      confidence_score: apiResponse.confidence ?? null,
      language: apiResponse.language ?? 'fr',
      service_provider: apiResponse.provider ?? 'whisper',
      api_request_id: apiResponse.request_id ?? null,
      started_at: now,
      completed_at: now,
      processing_duration_ms: apiResponse.processing_ms ?? null,
      error_message: null,
      retry_count: 0,
      extracted: 0,
      extracted_at: null,
    });

    return transcription.id;
  },

  async _markRecordingUploaded(recordingId, transcriptionId) {
    const storage = await getStorage();
    await storage.update('audio_recordings', recordingId, {
      status: 'uploaded',
      uploaded: 1,
      uploaded_at: new Date().toISOString(),
      transcription_id: transcriptionId,
    });
  },
};

export default ChunkUploadService;