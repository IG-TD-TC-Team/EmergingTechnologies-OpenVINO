/**
 * Data Models - TypeScript entity interfaces
 *
 * Centralized export for all domain entities and types.
 * All entities extend BaseEntity with common fields:
 * - id: Unique identifier (UUID)
 * - created_at: Creation timestamp
 * - expires_at: Expiration timestamp for automatic cleanup
 * - session_id: Shift/session association for data isolation
 *
 * Usage:
 * ```typescript
 * import { Patient, CreatePatientInput, PatientStatus } from '@/models';
 * ```
 */

// Base entity
export * from './BaseEntity';

// Domain entities
export * from './Session';
export * from './Patient';
export * from './ClinicalNote';
export * from './Transcription';
export * from './AudioRecording';
