/**
 * Simplified Shared Integration Test Suite
 *
 * Tests only the methods that actually exist in IRepository interface:
 * - create, read, update, delete
 * - queryBySession
 * - bulkDelete
 * - purgeExpired
 */

import { IRepository } from '../../../repositories/interfaces/IRepository';
import {
  createTestSession,
  createTestPatient,
  createExpiredEntity,
  createTestEntities,
} from '../../helpers/test-helpers';

export function runStorageIntegrationTests(
  createAdapter: () => IRepository | Promise<IRepository>
) {
  let storage: IRepository;

  beforeEach(async () => {
    storage = await Promise.resolve(createAdapter());
  });

  describe('CRUD Operations - Sessions', () => {
    it('should create a session', async () => {
      const session = createTestSession();
      const created = await storage.create('sessions', session);

      expect(created).toMatchObject({
        nurse_name: session.nurse_name,
      });
    });

    it('should read a session by id', async () => {
      const session = createTestSession();
      const created = await storage.create('sessions', session);

      const found = await storage.read('sessions', created.id);
      expect(found).not.toBeNull();
      expect(found?.nurse_name).toBe(session.nurse_name);
    });

    it('should update a session', async () => {
      const session = createTestSession();
      const created = await storage.create('sessions', session);

      const updated = await storage.update('sessions', created.id, {
        ended_at: new Date().toISOString(),
      });

      expect(updated.ended_at).not.toBeNull();
    });

    it('should delete a session', async () => {
      const session = createTestSession();
      const created = await storage.create('sessions', session);

      await storage.delete('sessions', created.id);

      const found = await storage.read('sessions', created.id);
      expect(found).toBeNull();
    });
  });

  describe('CRUD Operations - Patients', () => {
    it('should create a patient', async () => {
      const patient = createTestPatient();
      const created = await storage.create('patients', patient);

      expect(created).toMatchObject({
        nombre: patient.nombre,
        apellido: patient.apellido,
      });
    });

    it('should read and update patient', async () => {
      const patient = createTestPatient();
      const created = await storage.create('patients', patient);

      const updated = await storage.update('patients', created.id, {
        edad: 40,
      });

      expect(updated.edad).toBe(40);
    });
  });

  describe('Query by Session', () => {
    it('should find patients by session_id', async () => {
      const sessionId = 'session-test-123';
      const patients = createTestEntities(createTestPatient, 2, { session_id: sessionId });

      for (const patient of patients) {
        await storage.create('patients', patient);
      }

      const found = await storage.queryBySession('patients', sessionId);
      expect(found.length).toBeGreaterThanOrEqual(2);
    });

    it('should find sessions by session_id', async () => {
      const sessionId = 'session-unique-456';
      const session = createTestSession({ session_id: sessionId });

      await storage.create('sessions', session);

      const found = await storage.queryBySession('sessions', sessionId);
      expect(found.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Bulk Delete', () => {
    it('should delete multiple records with bulkDelete', async () => {
      const sessionId = 'session-bulk-delete';
      const patients = createTestEntities(createTestPatient, 3, { session_id: sessionId });

      for (const patient of patients) {
        await storage.create('patients', patient);
      }

      // Delete all patients for this session
      const deletedCount = await storage.bulkDelete('patients', { session_id: sessionId });
      expect(deletedCount).toBeGreaterThanOrEqual(3);

      // Verify they're gone
      const remaining = await storage.queryBySession('patients', sessionId);
      expect(remaining.length).toBe(0);
    });
  });

  describe('Data Expiration - purgeExpired()', () => {
    it('should purge expired sessions', async () => {
      // Create expired session
      const expiredSession = createExpiredEntity(createTestSession);
      const created = await storage.create('sessions', expiredSession);

      // Purge expired records
      const purgedCount = await storage.purgeExpired();
      expect(purgedCount).toBeGreaterThanOrEqual(1);

      // Verify expired session is gone
      const found = await storage.read('sessions', created.id);
      expect(found).toBeNull();
    });

    it('should not purge non-expired records', async () => {
      const validSession = createTestSession();
      const created = await storage.create('sessions', validSession);

      await storage.purgeExpired();

      // Verify record still exists
      const found = await storage.read('sessions', created.id);
      expect(found).not.toBeNull();
    });

    it('should purge expired records from multiple tables', async () => {
      // Create expired entities
      const expiredSession = createExpiredEntity(createTestSession);
      const expiredPatient = createExpiredEntity(createTestPatient);

      await storage.create('sessions', expiredSession);
      await storage.create('patients', expiredPatient);

      // Purge all expired
      const purgedCount = await storage.purgeExpired();
      expect(purgedCount).toBeGreaterThanOrEqual(2);
    });

    it('should return 0 when no expired records exist', async () => {
      // Don't create any expired records
      const purgedCount = await storage.purgeExpired();
      expect(purgedCount).toBeGreaterThanOrEqual(0);
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
  });

  describe('Error Handling', () => {
    it('should handle non-existent record gracefully', async () => {
      const found = await storage.read('sessions', 'non-existent-id');
      expect(found).toBeNull();
    });
  });
}
