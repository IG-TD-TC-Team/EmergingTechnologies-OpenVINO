/**
 * Centralized AsyncStorage key registry.
 *
 * MIGRATION NOTE:
 * When a backend API is introduced, replace the values here with
 * the corresponding API field names or remove them entirely if the
 * data moves server-side. All consumers (SessionService, etc.) will
 * update automatically — no need to hunt through individual files.
 */
const StorageKeys = {
  NURSE_NAME: 'nurse_name',       // future: sent as nurse_name in API auth payload
  ACTIVE_SHIFT: 'active_shift',   // future: replaced by server-issued session token
  AUDIO_DEVICE: 'audio_device',   // future: user preference, may stay local
};

export default StorageKeys;
