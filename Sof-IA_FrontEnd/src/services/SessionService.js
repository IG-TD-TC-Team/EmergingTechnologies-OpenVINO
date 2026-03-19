import AsyncStorage from '@react-native-async-storage/async-storage';
import StorageKeys from '../constants/storageKeys';

/**
 * SessionService
 * Single source of truth for session and nurse identity management.
 *
 * MIGRATION NOTE:
 * This is the ONLY file that needs to change when a backend API is introduced.
 * Replace AsyncStorage calls with API calls (e.g. POST /sessions, GET /session/me).
 * Presenters and Screens remain untouched.
 *
 * Future shape:
 *   getNurseName()      → GET /auth/me → response.nurse_name
 *   saveNurseName()     → PATCH /auth/profile { nurse_name }
 *   getActiveShift()    → GET /sessions/active → session object or null
 *   startShift()        → POST /sessions { nurse_name, started_at }
 *   endShift()          → DELETE /sessions/:id (after sync)
 */
class SessionService {
  // --- Nurse identity ---

  async getNurseName() {
    return await AsyncStorage.getItem(StorageKeys.NURSE_NAME);
  }

  async saveNurseName(name) {
    await AsyncStorage.setItem(StorageKeys.NURSE_NAME, name.trim());
  }

  // --- Shift / session ---

  async getActiveShift() {
    const raw = await AsyncStorage.getItem(StorageKeys.ACTIVE_SHIFT);
    return raw ? JSON.parse(raw) : null;
  }

  async startShift(nurseName) {
    const session = {
      nurse_name: nurseName,
      started_at: new Date().toISOString(),
    };
    await AsyncStorage.setItem(StorageKeys.ACTIVE_SHIFT, JSON.stringify(session));
    return session;
  }

  async endShift() {
    await AsyncStorage.removeItem(StorageKeys.ACTIVE_SHIFT);
  }

  async hasActiveShift() {
    const shift = await this.getActiveShift();
    return shift !== null;
  }
}

// Singleton — one instance shared across all Presenters
export default new SessionService();
