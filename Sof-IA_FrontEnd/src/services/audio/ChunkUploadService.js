/**
 * ChunkUploadService
 *
 * Thin delegation layer — forwards audio chunks to TranscriptionService,
 * which handles the API call, segment persistence, and raw audio cleanup.
 *
 * Keeping this file allows ContinuousRecordingService and OfflineQueueService
 * to remain unchanged.
 *
 * File path conventions:
 *   Android  — file:///...DocumentDirectory/recordings/chunk_<id>.m4a
 *   Web      — indexeddb://audio-blobs/<uuid>  (Blob stored in Dexie)
 */

import TranscriptionService from '../TranscriptionService';

const ChunkUploadService = {
  /**
   * @param {object} params
   * @param {string} params.recordingId  — AudioRecording.id in DB
   * @param {string} params.filePath     — uri returned by strategy.stopChunk()
   * @param {string} params.sessionId
   * @param {string} params.mimeType     — 'audio/mp4' | 'audio/webm'
   * @param {number} [params.timestampStart] — recording start in ms (defaults to now)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async upload({ recordingId, filePath, sessionId, mimeType, timestampStart }) {
    return TranscriptionService.processChunk({
      recordingId,
      filePath,
      sessionId,
      mimeType,
      timestampStart: timestampStart ?? Date.now(),
    });
  },
};

export default ChunkUploadService;