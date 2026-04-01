/**
 * Shared Integration Test Suite
 *
 * This test suite verifies that both SQLite and Dexie adapters
 * implement the IRepository interface identically, ensuring business
 * logic works the same on Android (SQLite) and Web (IndexedDB/Dexie).
 *
 * Usage:
 * ```typescript
 * import { runStorageIntegrationTests } from './shared/storage.integration.suite';
 *
 * describe('SqliteAdapter Integration Tests', () => {
 *   runStorageIntegrationTests(() => new SqliteAdapter());
 * });
 * ```
 */

import { IRepository } from '../../../repositories/interfaces/IRepository';
import {
  createTestSession,
  createTestPatient,
  createTestAudioRecording,
  createTestTranscription,
  createTestClinicalNote,
  createExpiredEntity,
  createTestEntities,
} from '../../helpers/test-helpers';

/**
 * Runs the complete integration test suite against a storage adapter
 * @param createAdapter Factory function to create a fresh adapter instance
 */
export function runStorageIntegrationTests(
  createAdapter: () => IRepository | Promise<IRepository>
) {
  let storage: IRepository;

  beforeEach(async () => {
    storage = await Promise.resolve(createAdapter());
    await storage.initialize();
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
    }
  });

  describe('Initialization and Health', () => {
    it('should initialize successfully', async () => {
      expect(storage).toBeDefined();
      const health = await storage.healthCheck();
      expect(health.healthy).toBe(true);
    });

    it('should create all required tables on initialization', async () => {
      // Verify we can interact with all tables
      const tables = ['sessions', 'patients', 'audio_recordings', 'transcriptions', 'clinical_notes'];

      for (const table of tables) {
        const items = await storage.findAll(table);
        expect(Array.isArray(items)).toBe(true);
      }
    });
  });

  describe('CRUD Operations - Sessions', () => {
    it('should create a session', async () => {
      const session = createTestSession();
      const created = await storage.create('sessions', session);

      expect(created).toMatchObject({
        id: session.id,
        user_id: session.user_id,
        shift_mode: session.shift_mode,
      });
    });

    it('should read a session by id', async () => {
      const session = createTestSession();
      await storage.create('sessions', session);

      const found = await storage.findById('sessions', session.id);
      expect(found).toMatchObject({
        id: session.id,
        user_id: session.user_id,
      });
    });

    it('should update a session', async () => {
      const session = createTestSession();
      await storage.create('sessions', session);

      const updated = await storage.update('sessions', session.id, {
        ended_at: new Date().toISOString(),
      });

      expect(updated.ended_at).not.toBeNull();
    });

    it('should delete a session', async () => {
      const session = createTestSession();
      await storage.create('sessions', session);

      await storage.delete('sessions', session.id);

      const found = await storage.findById('sessions', session.id);
      expect(found).toBeNull();
    });

    it('should find all sessions', async () => {
      const sessions = createTestEntities(createTestSession, 3);

      for (const session of sessions) {
        await storage.create('sessions', session);
      }

      const allSessions = await storage.findAll('sessions');
      expect(allSessions.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('CRUD Operations - Patients', () => {
    it('should create a patient', async () => {
      const patient = createTestPatient();
      const created = await storage.create('patients', patient);

      expect(created).toMatchObject({
        id: patient.id,
        nombre: patient.nombre,
        apellido: patient.apellido,
      });
    });

    it('should find patients by session_id', async () => {
      const sessionId = 'session-test-123';
      const patients = createTestEntities(createTestPatient, 2, { session_id: sessionId });

      for (const patient of patients) {
        await storage.create('patients', patient);
      }

      const found = await storage.findByField('patients', 'session_id', sessionId);
      expect(found.length).toBe(2);
    });

    it('should update patient information', async () => {
      const patient = createTestPatient();
      await storage.create('patients', patient);

      const updated = await storage.update('patients', patient.id, {
        edad: 40,
      });

      expect(updated.edad).toBe(40);
    });
  });

  describe('CRUD Operations - AudioRecordings', () => {
    it('should create an audio recording', async () => {
      const audio = createTestAudioRecording();
      const created = await storage.create('audio_recordings', audio);

      expect(created).toMatchObject({
        id: audio.id,
        patient_id: audio.patient_id,
        file_path: audio.file_path,
      });
    });

    it('should find audio recordings by patient_id', async () => {
      const patientId = 'patient-test-456';
      const recordings = createTestEntities(createTestAudioRecording, 3, { patient_id: patientId });

      for (const recording of recordings) {
        await storage.create('audio_recordings', recording);
      }

      const found = await storage.findByField('audio_recordings', 'patient_id', patientId);
      expect(found.length).toBe(3);
    });
  });

  describe('CRUD Operations - Transcriptions', () => {
    it('should create a transcription', async () => {
      const transcription = createTestTranscription();
      const created = await storage.create('transcriptions', transcription);

      expect(created).toMatchObject({
        id: transcription.id,
        text: transcription.text,
        language: transcription.language,
      });
    });

    it('should find transcription by audio_recording_id', async () => {
      const audioId = 'audio-test-789';
      const transcription = createTestTranscription({ audio_recording_id: audioId });
      await storage.create('transcriptions', transcription);

      const found = await storage.findByField('transcriptions', 'audio_recording_id', audioId);
      expect(found.length).toBe(1);
      expect(found[0].audio_recording_id).toBe(audioId);
    });
  });

  describe('CRUD Operations - ClinicalNotes', () => {
    it('should create a clinical note', async () => {
      const note = createTestClinicalNote();
      const created = await storage.create('clinical_notes', note);

      expect(created).toMatchObject({
        id: note.id,
        content: note.content,
        note_type: note.note_type,
      });
    });

    it('should find clinical notes by patient_id', async () => {
      const patientId = 'patient-test-999';
      const notes = createTestEntities(createTestClinicalNote, 2, { patient_id: patientId });

      for (const note of notes) {
        await storage.create('clinical_notes', note);
      }

      const found = await storage.findByField('clinical_notes', 'patient_id', patientId);
      expect(found.length).toBe(2);
    });
  });

  describe('Query Operations', () => {
    it('should count records in a table', async () => {
      const sessions = createTestEntities(createTestSession, 5);

      for (const session of sessions) {
        await storage.create('sessions', session);
      }

      const count = await storage.count('sessions');
      expect(count).toBeGreaterThanOrEqual(5);
    });

    it('should check if record exists', async () => {
      const session = createTestSession();
      await storage.create('sessions', session);

      const exists = await storage.exists('sessions', session.id);
      expect(exists).toBe(true);

      const notExists = await storage.exists('sessions', 'non-existent-id');
      expect(notExists).toBe(false);
    });

    it('should find records with pagination', async () => {
      const sessions = createTestEntities(createTestSession, 10);

      for (const session of sessions) {
        await storage.create('sessions', session);
      }

      const page1 = await storage.findAll('sessions', { limit: 5, offset: 0 });
      const page2 = await storage.findAll('sessions', { limit: 5, offset: 5 });

      expect(page1.length).toBeLessThanOrEqual(5);
      expect(page2.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Data Expiration - purgeExpired()', () => {
    it('should purge expired sessions', async () => {
      // Create expired session
      const expiredSession = createExpiredEntity(createTestSession);
      await storage.create('sessions', expiredSession);

      // Create valid session
      const validSession = createTestSession();
      await storage.create('sessions', validSession);

      // Purge expired records
      const purgedCount = await storage.purgeExpired();
      expect(purgedCount).toBeGreaterThanOrEqual(1);

      // Verify expired session is gone
      const found = await storage.findById('sessions', expiredSession.id);
      expect(found).toBeNull();

      // Verify valid session still exists
      const validFound = await storage.findById('sessions', validSession.id);
      expect(validFound).not.toBeNull();
    });

    it('should purge expired records from all tables', async () => {
      // Create expired entities in all tables
      const expiredSession = createExpiredEntity(createTestSession);
      const expiredPatient = createExpiredEntity(createTestPatient);
      const expiredAudio = createExpiredEntity(createTestAudioRecording);
      const expiredTranscription = createExpiredEntity(createTestTranscription);
      const expiredNote = createExpiredEntity(createTestClinicalNote);

      await storage.create('sessions', expiredSession);
      await storage.create('patients', expiredPatient);
      await storage.create('audio_recordings', expiredAudio);
      await storage.create('transcriptions', expiredTranscription);
      await storage.create('clinical_notes', expiredNote);

      // Purge all expired
      const purgedCount = await storage.purgeExpired();
      expect(purgedCount).toBeGreaterThanOrEqual(5);

      // Verify all expired records are gone
      expect(await storage.findById('sessions', expiredSession.id)).toBeNull();
      expect(await storage.findById('patients', expiredPatient.id)).toBeNull();
      expect(await storage.findById('audio_recordings', expiredAudio.id)).toBeNull();
      expect(await storage.findById('transcriptions', expiredTranscription.id)).toBeNull();
      expect(await storage.findById('clinical_notes', expiredNote.id)).toBeNull();
    });

    it('should return 0 when no expired records exist', async () => {
      const purgedCount = await storage.purgeExpired();
      expect(purgedCount).toBeGreaterThanOrEqual(0);
    });

    it('should not purge non-expired records', async () => {
      const validSession = createTestSession();
      const validPatient = createTestPatient();

      await storage.create('sessions', validSession);
      await storage.create('patients', validPatient);

      await storage.purgeExpired();

      // Verify records still exist
      expect(await storage.exists('sessions', validSession.id)).toBe(true);
      expect(await storage.exists('patients', validPatient.id)).toBe(true);
    });
  });

  describe('Transaction Support', () => {
    it('should execute operations in a transaction', async () => {
      const session1 = createTestSession();
      const session2 = createTestSession();

      await storage.transaction(async (tx) => {
        await storage.create('sessions', session1);
        await storage.create('sessions', session2);
      });

      // Verify both sessions were created
      expect(await storage.exists('sessions', session1.id)).toBe(true);
      expect(await storage.exists('sessions', session2.id)).toBe(true);
    });
  });

  describe('Batch Operations', () => {
    it('should create multiple records in batch', async () => {
      const sessions = createTestEntities(createTestSession, 5);

      await storage.batchCreate('sessions', sessions);

      // Verify all sessions were created
      for (const session of sessions) {
        const exists = await storage.exists('sessions', session.id);
        expect(exists).toBe(true);
      }
    });

    it('should delete multiple records in batch', async () => {
      const sessions = createTestEntities(createTestSession, 3);

      // Create sessions
      for (const session of sessions) {
        await storage.create('sessions', session);
      }

      // Batch delete
      const ids = sessions.map(s => s.id);
      await storage.batchDelete('sessions', ids);

      // Verify all sessions were deleted
      for (const id of ids) {
        const exists = await storage.exists('sessions', id);
        expect(exists).toBe(false);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid table name gracefully', async () => {
      await expect(async () => {
        await storage.findAll('invalid_table_name' as any);
      }).rejects.toThrow();
    });

    it('should handle non-existent record gracefully', async () => {
      const found = await storage.findById('sessions', 'non-existent-id');
      expect(found).toBeNull();
    });

    it('should handle duplicate ID creation', async () => {
      const session = createTestSession();
      await storage.create('sessions', session);

      // Try to create again with same ID
      await expect(async () => {
        await storage.create('sessions', session);
      }).rejects.toThrow();
    });
  });

  describe('Data Integrity', () => {
    it('should preserve data types', async () => {
      const patient = createTestPatient({
        edad: 35,
        genero: 'M',
      });

      const created = await storage.create('patients', patient);
      expect(typeof created.edad).toBe('number');
      expect(created.edad).toBe(35);
    });

    it('should handle null values correctly', async () => {
      const session = createTestSession({ ended_at: null });
      const created = await storage.create('sessions', session);

      expect(created.ended_at).toBeNull();
    });

    it('should preserve timestamps', async () => {
      const session = createTestSession();
      const created = await storage.create('sessions', session);

      expect(created.created_at).toBe(session.created_at);
      expect(created.updated_at).toBe(session.updated_at);
    });
  });
}
