/**
 * ShiftCleanupService
 *
 * Purges all audio data for a session when the shift ends.
 * Per spec: "End of shift: all local audio chunks permanently deleted (zero retention)."
 *
 * Steps:
 *   1. Load all AudioRecording rows for the session
 *   2. Delete physical files (Android: expo-file-system, Web: Dexie audio_blobs)
 *   3. Bulk-delete AudioRecording + recording_queue rows for the session
 */

import { Platform } from 'react-native';
import { getStorage } from '../../repositories';

const ShiftCleanupService = {
  /**
   * Purge all audio data for the given session.
   * Safe to call if no recordings exist.
   *
   * @param {string} sessionId
   */
  async purgeSessionAudio(sessionId) {
    if (!sessionId) return;

    try {
      const storage = await getStorage();

      // 1. Get all audio recording rows for the session
      const recordings = await storage.queryBySession('audio_recordings', sessionId);
      console.log(`[ShiftCleanup] Purging ${recordings.length} recording(s) for session:`, sessionId);

      // 2. Delete physical files
      for (const recording of recordings) {
        await this._deleteFile(recording.file_path, storage);
      }

      // 3. Bulk-delete DB rows
      await storage.bulkDelete('audio_recordings', { session_id: sessionId });
      await storage.bulkDelete('recording_queue', { session_id: sessionId });

      console.log('[ShiftCleanup] Audio purge complete for session:', sessionId);
    } catch (err) {
      console.error('[ShiftCleanup] Purge failed:', err);
      // Non-critical for shift-end flow — log and continue
    }
  },

  async _deleteFile(filePath, storage) {
    if (!filePath) return;

    if (filePath.startsWith('indexeddb://audio-blobs/')) {
      // Web: delete from Dexie audio_blobs table
      const blobId = filePath.replace('indexeddb://audio-blobs/', '');
      try {
        await storage.delete('audio_blobs', blobId);
      } catch (_) {}
    } else if (Platform.OS !== 'web') {
      // Native: delete from filesystem
      try {
        const FileSystem = require('expo-file-system');
        const info = await FileSystem.getInfoAsync(filePath);
        if (info.exists) {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        }
      } catch (_) {}
    }
  },
};

export default ShiftCleanupService;