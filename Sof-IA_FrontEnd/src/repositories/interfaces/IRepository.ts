/**
 * IRepository - Unified storage interface
 *
 * Provides a platform-agnostic contract for data persistence that works
 * identically on Android (expo-sqlite) and Web (Dexie.js/IndexedDB).
 *
 * Design Goals:
 * - Zero platform-specific code in business logic layer
 * - Type-safe generic methods for all CRUD operations
 * - Support for session-based queries and bulk operations
 * - Automatic expiration handling
 *
 * @see https://github.com/Sof-IA - Project documentation
 */

/**
 * Where clause for filtering records in bulk operations.
 * Supports simple field-value matching and complex conditions.
 *
 * Examples:
 * - Simple: { sessionId: "abc123" }
 * - Multiple fields: { sessionId: "abc123", status: "active" }
 * - With operator: { field: "createdAt", operator: "<", value: Date.now() }
 */
export type WhereClause =
  | { [field: string]: any }
  | {
      field: string;
      operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'like';
      value: any;
    };

/**
 * Core repository interface for unified data access across platforms.
 *
 * All methods are async and return Promises to support both local and remote storage.
 * Generic type parameter <T> ensures type safety for entity operations.
 */
export interface IRepository {
  /**
   * Create a new record in the specified store.
   *
   * @template T - The entity type
   * @param store - Store/table name (e.g., "patients", "sessions", "notes")
   * @param data - Entity data to persist
   * @returns The created entity with generated ID and timestamps
   *
   * @example
   * const patient = await repo.create("patients", {
   *   name: "John Doe",
   *   sessionId: "shift_123"
   * });
   */
  create<T>(store: string, data: T): Promise<T>;

  /**
   * Read a single record by ID.
   *
   * @template T - The entity type
   * @param store - Store/table name
   * @param id - Unique identifier for the record
   * @returns The entity if found, null otherwise
   *
   * @example
   * const patient = await repo.read<Patient>("patients", "patient_456");
   */
  read<T>(store: string, id: string): Promise<T | null>;

  /**
   * Update an existing record with partial data.
   *
   * @template T - The entity type
   * @param store - Store/table name
   * @param id - Unique identifier for the record
   * @param data - Partial entity data to merge with existing record
   * @returns The updated entity
   *
   * @example
   * const updated = await repo.update("patients", "patient_456", {
   *   status: "discharged"
   * });
   */
  update<T>(store: string, id: string, data: Partial<T>): Promise<T>;

  /**
   * Delete a single record by ID.
   *
   * @param store - Store/table name
   * @param id - Unique identifier for the record
   * @returns Promise that resolves when deletion is complete
   *
   * @example
   * await repo.delete("patients", "patient_456");
   */
  delete(store: string, id: string): Promise<void>;

  /**
   * Query all records associated with a specific session.
   * Critical for shift-based data isolation and cleanup.
   *
   * @template T - The entity type
   * @param store - Store/table name
   * @param sessionId - Session/shift identifier (e.g., "shift_20260325_143022")
   * @returns Array of entities belonging to the session
   *
   * @example
   * const shiftPatients = await repo.queryBySession<Patient>(
   *   "patients",
   *   "shift_20260325_143022"
   * );
   */
  queryBySession<T>(store: string, sessionId: string): Promise<T[]>;

  /**
   * Find all records where a given field equals a value.
   */
  findByField<T>(store: string, field: string, value: any): Promise<T[]>;

  /**
   * Delete multiple records matching a where clause.
   * Used for bulk cleanup operations and session data purging.
   *
   * @param store - Store/table name
   * @param where - Filtering criteria (field-value pairs or complex condition)
   * @returns Number of records deleted
   *
   * @example
   * // Delete all records for a session
   * const count = await repo.bulkDelete("notes", { sessionId: "shift_123" });
   *
   * @example
   * // Delete old records using operator
   * const count = await repo.bulkDelete("logs", {
   *   field: "createdAt",
   *   operator: "<",
   *   value: Date.now() - 86400000 // 24 hours ago
   * });
   */
  bulkDelete(store: string, where: WhereClause): Promise<number>;

  /**
   * Purge all expired records across all stores.
   * Removes data past TTL (time-to-live) thresholds to prevent storage bloat.
   *
   * Expiration rules are implementation-specific but typically based on:
   * - createdAt timestamps older than retention policy
   * - Explicit expiresAt field values
   * - Session end time + grace period
   *
   * @returns Number of records purged
   *
   * @example
   * // Run daily cleanup
   * const purgedCount = await repo.purgeExpired();
   * console.log(`Cleaned up ${purgedCount} expired records`);
   */
  purgeExpired(): Promise<number>;
}
