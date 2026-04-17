/**
 * SessionService - Session and Shift Management
 *
 * Single source of truth for nurse shift lifecycle using the unified storage interface.
 * This service uses IRepository (SQLite/IndexedDB) instead of AsyncStorage for
 * proper data persistence, querying, and TTL cleanup.
 *
 * MIGRATION from AsyncStorage:
 * - Session data now stored in 'sessions' table (proper database)
 * - Nurse name cached in AsyncStorage for UI convenience (non-critical preference)
 * - All shift data has TTL and proper foreign key relationships
 *
 * Future Backend Integration:
 * Replace repository calls with API calls when backend is ready:
 *   getNurseName()      → GET /auth/me → response.nurse_name
 *   getActiveShift()    → GET /sessions/active → session object
 *   startShift()        → POST /sessions { nurse_name, started_at }
 *   endShift()          → PATCH /sessions/:id { status: 'ended' }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { getStorage } from '../repositories';
import { Session, SessionStatus } from '../models';
import StorageKeys from '../constants/storageKeys';
import { capabilities } from '../config/capabilities';

class SessionService {
  // Cache for active session to reduce database queries
  private activeSessionCache: Session | null = null;

  // ==========================================
  // Nurse Identity (UI Preference - kept in AsyncStorage)
  // ==========================================

  /**
   * Get the nurse's saved name from AsyncStorage.
   * This is a UI convenience feature, not critical data.
   *
   * @returns Nurse name or null if never saved
   */
  async getNurseName(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(StorageKeys.NURSE_NAME);
    } catch (error) {
      console.error('[SessionService] Failed to get nurse name:', error);
      return null;
    }
  }

  /**
   * Save the nurse's name to AsyncStorage for future sessions.
   * This is just a UI convenience to pre-fill the name field.
   *
   * @param name - Nurse's display name
   */
  async saveNurseName(name: string): Promise<void> {
    try {
      await AsyncStorage.setItem(StorageKeys.NURSE_NAME, name.trim());
    } catch (error) {
      console.error('[SessionService] Failed to save nurse name:', error);
      // Non-critical failure, continue
    }
  }

  // ==========================================
  // Shift Management (Critical Data - uses IRepository)
  // ==========================================

  /**
   * Get the current active shift from the database.
   * Uses cache to reduce database queries.
   *
   * @returns Active session or null if no shift is active
   */
  async getActiveShift(): Promise<Session | null> {
    try {
      // Return cached session if available
      if (this.activeSessionCache) {
        return this.activeSessionCache;
      }

      // Query database for active session
      const storage = await getStorage();
      const activeSessions = await storage.findByField<Session>(
        'sessions',
        'status',
        SessionStatus.ACTIVE
      );

      // Should only be one active session per device
      const activeSession = activeSessions[0] || null;

      // Cache the result
      this.activeSessionCache = activeSession;

      return activeSession;
    } catch (error) {
      console.error('[SessionService] Failed to get active shift:', error);
      return null;
    }
  }

  /**
   * Start a new shift for the nurse.
   * Creates a session record in the database with proper metadata.
   *
   * @param nurseName - Name of the nurse starting the shift
   * @returns The created session object
   */
  async startShift(nurseName: string): Promise<Session> {
    try {
      const storage = await getStorage();

      // Get device info for audit trail
      const deviceId = await this.getDeviceId();
      const appVersion = this.getAppVersion();

      // Create session data
      const sessionData: Partial<Session> = {
        session_id: this.generateSessionId(),
        nurse_name: nurseName.trim(),
        started_at: new Date().toISOString(),
        ended_at: null,
        status: SessionStatus.ACTIVE,
        device_id: deviceId,
        app_version: appVersion,
        patient_count: 0,
        total_recording_duration: 0,
        synced: false,
        last_synced_at: null,
      };

      // Create session in database
      const session = await storage.create<Session>('sessions', sessionData);

      console.log('[SessionService] Shift started:', session.id);

      // Cache the new active session
      this.activeSessionCache = session;

      return session;
    } catch (error) {
      console.error('[SessionService] Failed to start shift:', error);
      throw new Error('Failed to start shift. Please try again.');
    }
  }

  /**
   * End the current active shift.
   * Updates the session status to 'ended' and clears cache.
   *
   * @returns The updated session or null if no active shift
   */
  async endShift(): Promise<Session | null> {
    try {
      const activeSession = await this.getActiveShift();

      if (!activeSession) {
        console.warn('[SessionService] No active shift to end');
        return null;
      }

      const storage = await getStorage();

      // Update session status
      const updatedSession = await storage.update<Session>(
        'sessions',
        activeSession.id,
        {
          ended_at: new Date().toISOString(),
          status: SessionStatus.ENDED,
        }
      );

      console.log('[SessionService] Shift ended:', updatedSession.id);

      // Clear cache
      this.activeSessionCache = null;

      return updatedSession;
    } catch (error) {
      console.error('[SessionService] Failed to end shift:', error);
      throw new Error('Failed to end shift. Please try again.');
    }
  }

  /**
   * Check if there's an active shift.
   * Uses cache for performance.
   *
   * @returns True if a shift is active, false otherwise
   */
  async hasActiveShift(): Promise<boolean> {
    const activeSession = await this.getActiveShift();
    return activeSession !== null;
  }

  /**
   * Get the current active session ID.
   * Useful for associating data (patients, recordings) with the current shift.
   *
   * @returns Session ID or null if no active shift
   */
  async getActiveSessionId(): Promise<string | null> {
    const activeSession = await this.getActiveShift();
    return activeSession?.session_id || null;
  }

  /**
   * Increment the patient count for the current active shift.
   * Called when a new patient is created during the shift.
   */
  async incrementPatientCount(): Promise<void> {
    try {
      const activeSession = await this.getActiveShift();

      if (!activeSession) {
        console.warn('[SessionService] No active shift to update patient count');
        return;
      }

      const storage = await getStorage();

      await storage.update<Session>('sessions', activeSession.id, {
        patient_count: activeSession.patient_count + 1,
      });

      // Update cache
      if (this.activeSessionCache) {
        this.activeSessionCache.patient_count += 1;
      }
    } catch (error) {
      console.error('[SessionService] Failed to increment patient count:', error);
      // Non-critical failure, continue
    }
  }

  /**
   * Add recording duration to the current active shift's total.
   * Called when an audio recording is completed.
   *
   * @param durationSeconds - Duration of the recording in seconds
   */
  async addRecordingDuration(durationSeconds: number): Promise<void> {
    try {
      const activeSession = await this.getActiveShift();

      if (!activeSession) {
        console.warn('[SessionService] No active shift to update recording duration');
        return;
      }

      const storage = await getStorage();

      await storage.update<Session>('sessions', activeSession.id, {
        total_recording_duration: activeSession.total_recording_duration + durationSeconds,
      });

      // Update cache
      if (this.activeSessionCache) {
        this.activeSessionCache.total_recording_duration += durationSeconds;
      }
    } catch (error) {
      console.error('[SessionService] Failed to add recording duration:', error);
      // Non-critical failure, continue
    }
  }

  /**
   * Persist whether recording was active for the given session.
   * Stored in AsyncStorage so the state survives an app close/reopen.
   *
   * @param sessionId  The session the recording belongs to.
   * @param active     true = recording running, false = stopped.
   */
  async setRecordingActive(sessionId: string, active: boolean): Promise<void> {
    try {
      const key = StorageKeys.RECORDING_ACTIVE_PREFIX + sessionId;
      if (active) {
        await AsyncStorage.setItem(key, 'true');
      } else {
        await AsyncStorage.removeItem(key);
      }
    } catch (error) {
      console.error('[SessionService] Failed to persist recording state:', error);
    }
  }

  /**
   * Read back whether recording was active for the given session.
   *
   * @param sessionId  The session to query.
   * @returns true if recording was active when the app last closed.
   */
  async getRecordingActive(sessionId: string): Promise<boolean> {
    try {
      const key = StorageKeys.RECORDING_ACTIVE_PREFIX + sessionId;
      const value = await AsyncStorage.getItem(key);
      return value === 'true';
    } catch (error) {
      console.error('[SessionService] Failed to read recording state:', error);
      return false;
    }
  }

  /**
   * Clear the active session cache.
   * Useful when you know the session state has changed externally.
   */
  clearCache(): void {
    this.activeSessionCache = null;
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Generate a unique session ID.
   * Format: "session_YYYYMMDD_HHMMSS"
   *
   * @returns Formatted session ID
   */
  private generateSessionId(): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
    return `session_${dateStr}_${timeStr}`;
  }

  /**
   * Get a unique device identifier.
   * Format depends on platform (Android, iOS, Web).
   *
   * @returns Device ID string
   */
  private async getDeviceId(): Promise<string> {
    try {
      // Try to get a persistent device ID
      let deviceId = await AsyncStorage.getItem(StorageKeys.DEVICE_ID);

      if (!deviceId) {
        // Generate new device ID
        const platform = capabilities.platform;
        const uniqueId = uuidv4().substring(0, 8);
        deviceId = `${platform}_${uniqueId}`;

        // Save for future use
        await AsyncStorage.setItem(StorageKeys.DEVICE_ID, deviceId);
      }

      return deviceId;
    } catch (error) {
      console.error('[SessionService] Failed to get device ID:', error);
      // Fallback to platform + random ID
      return `${capabilities.platform}_${uuidv4().substring(0, 8)}`;
    }
  }

  /**
   * Get the current app version.
   * Returns package.json version or "unknown".
   *
   * @returns App version string
   */
  private getAppVersion(): string {
    try {
      // Try to get from package.json (would need to be imported)
      // For now, return a default version
      // In production, you could use expo-constants:
      // import Constants from 'expo-constants';
      // return Constants.expoConfig?.version || '1.0.0';
      return '1.0.0';
    } catch (error) {
      return 'unknown';
    }
  }
}

// Singleton instance - shared across all presenters and services
export default new SessionService();
