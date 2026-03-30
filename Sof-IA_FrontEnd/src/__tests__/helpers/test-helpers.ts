/**
 * Test Helpers
 * Utilities for creating test data and common assertions
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Session,
  Patient,
  AudioRecording,
  Transcription,
  ClinicalNote,
} from '../../models';

/**
 * Creates a test Session entity
 */
export function createTestSession(overrides?: Partial<Session>): Session {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: uuidv4(),
    user_id: 'test-user-123',
    shift_mode: 'urgencia',
    started_at: now,
    ended_at: null,
    created_at: now,
    updated_at: now,
    expires_at: expiresAt,
    synced: false,
    ...overrides,
  };
}

/**
 * Creates a test Patient entity
 */
export function createTestPatient(overrides?: Partial<Patient>): Patient {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: uuidv4(),
    session_id: 'session-123',
    nombre: 'Juan',
    apellido: 'Pérez',
    edad: 35,
    genero: 'M',
    created_at: now,
    updated_at: now,
    expires_at: expiresAt,
    synced: false,
    ...overrides,
  };
}

/**
 * Creates a test AudioRecording entity
 */
export function createTestAudioRecording(
  overrides?: Partial<AudioRecording>
): AudioRecording {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: uuidv4(),
    patient_id: 'patient-123',
    file_path: '/audio/test.mp3',
    duration_seconds: 120,
    recorded_at: now,
    created_at: now,
    updated_at: now,
    expires_at: expiresAt,
    synced: false,
    ...overrides,
  };
}

/**
 * Creates a test Transcription entity
 */
export function createTestTranscription(
  overrides?: Partial<Transcription>
): Transcription {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: uuidv4(),
    audio_recording_id: 'audio-123',
    text: 'Paciente presenta dolor en el pecho.',
    language: 'es',
    confidence_score: 0.95,
    created_at: now,
    updated_at: now,
    expires_at: expiresAt,
    synced: false,
    ...overrides,
  };
}

/**
 * Creates a test ClinicalNote entity
 */
export function createTestClinicalNote(
  overrides?: Partial<ClinicalNote>
): ClinicalNote {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: uuidv4(),
    transcription_id: 'transcription-123',
    patient_id: 'patient-123',
    content: 'Dolor torácico agudo, requiere evaluación.',
    note_type: 'assessment',
    created_at: now,
    updated_at: now,
    expires_at: expiresAt,
    synced: false,
    ...overrides,
  };
}

/**
 * Creates an expired entity (expires_at in the past)
 */
export function createExpiredEntity<T extends { expires_at: string }>(
  factory: (overrides?: Partial<T>) => T
): T {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return factory({ expires_at: yesterday } as Partial<T>);
}

/**
 * Waits for a promise to resolve with a timeout
 */
export async function waitFor(
  fn: () => Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

/**
 * Creates multiple test entities
 */
export function createTestEntities<T>(
  factory: (overrides?: Partial<T>) => T,
  count: number,
  overrides?: Partial<T>
): T[] {
  return Array.from({ length: count }, () => factory(overrides));
}
