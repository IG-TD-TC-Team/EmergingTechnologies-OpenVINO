/**
 * Centralized AsyncStorage key registry.
 *
 * MIGRATION NOTE:
 * SessionService now uses IRepository (SQLite/IndexedDB) for session data.
 * These keys are only for UI preferences and device identification.
 *
 * When a backend API is introduced, replace the values here with
 * the corresponding API field names or remove them entirely if the
 * data moves server-side. All consumers (SessionService, etc.) will
 * update automatically — no need to hunt through individual files.
 */
const StorageKeys = {
  NURSE_NAME: 'nurse_name',                       // UI preference - nurse name auto-fill
  DEVICE_ID: 'device_id',                         // Persistent device identifier for audit trail
  AUDIO_DEVICE: 'audio_device',                   // User preference - audio device selection
  RECORDING_SESSION_STATE: 'recording_session_state', // Active recording state — restored on app relaunch
  // ACTIVE_SHIFT removed - now stored in sessions table via IRepository
};

export default StorageKeys;
