/**
 * BaseEntity - Common fields for all persisted entities
 *
 * Provides consistent metadata tracking across all data stores.
 * Every entity stored via IRepository must extend this interface.
 *
 * Design Decisions:
 * - id: String UUID for cross-platform compatibility (SQLite and IndexedDB)
 * - created_at: ISO 8601 timestamp for consistent datetime handling
 * - expires_at: Automatic cleanup via IRepository.purgeExpired()
 * - session_id: Session-based data isolation for shift cleanup
 */

/**
 * Base interface for all entities in the system.
 * Enforces consistent metadata and lifecycle tracking.
 */
export interface BaseEntity {
  /**
   * Unique identifier for the entity.
   * Generated as UUID v4 on creation.
   *
   * @example "550e8400-e29b-41d4-a716-446655440000"
   */
  id: string;

  /**
   * Timestamp when the entity was created (ISO 8601 format).
   * Automatically set by repository on create().
   *
   * @example "2026-03-25T14:30:22.123Z"
   */
  created_at: string;

  /**
   * Timestamp when the entity should be purged (ISO 8601 format).
   * Used by IRepository.purgeExpired() for automatic cleanup.
   *
   * Expiration policies:
   * - Sessions: 30 days after shift end
   * - Patient data: Deleted on shift end (expires_at = shift.ended_at)
   * - Audio recordings: 7 days after creation (storage space management)
   * - Transcriptions: Same as parent audio recording
   *
   * @example "2026-04-24T14:30:22.123Z"
   */
  expires_at: string;

  /**
   * Reference to the shift/session this entity belongs to.
   * Critical for session-based data isolation and cleanup.
   *
   * Format: "shift_{YYYYMMDD}_{HHMMSS}"
   * @example "shift_20260325_143022"
   *
   * Used by:
   * - IRepository.queryBySession() - Retrieve all session data
   * - IRepository.bulkDelete() - Clean up on shift end
   * - Dashboard filtering - Show only current shift patients
   */
  session_id: string;
}
