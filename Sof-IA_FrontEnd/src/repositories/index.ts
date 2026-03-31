/**
 * Repository Layer - Unified data access
 *
 * Centralized export for all repository components:
 * - IRepository interface (contract)
 * - Platform adapters (SqliteAdapter, DexieAdapter)
 * - Factory (automatic platform detection)
 *
 * Usage:
 * ```typescript
 * import { getRepository, Patient, CreatePatientInput } from '@/repositories';
 *
 * const repo = await getRepository();
 * const patient = await repo.create<Patient>("patients", newPatient);
 * ```
 */

// Interface
export * from './interfaces/IRepository';

// Adapters
export * from './adapters';

// Re-export models for convenience
export * from '../models';
