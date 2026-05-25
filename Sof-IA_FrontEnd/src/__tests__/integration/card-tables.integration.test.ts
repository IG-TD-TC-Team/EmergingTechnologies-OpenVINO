/**
 * Card Tables Integration Tests (US22 — Task 2)
 *
 * Verifies that:
 *   1. All four card stores (medications, vital_signs, allergies, safety_info)
 *      exist and accept records via DexieAdapter.
 *   2. queryBySessionAndBed() returns only records that match BOTH session_id
 *      and bed_id, excluding records from other beds or sessions.
 *   3. purgeExpired() removes expired card records.
 *
 * Uses DexieAdapter backed by fake-indexeddb (configured in jest.setup.js).
 */

import { DexieAdapter } from '../../repositories/adapters/dexie/DexieAdapter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapter(): DexieAdapter {
  const dbName = `card_tables_test_${Date.now()}_${Math.random()}`;
  return new DexieAdapter(dbName);
}

const SESSION_A = 'session_20260419_080000';
const SESSION_B = 'session_20260419_200000';
const BED_3     = 'bed-3';
const BED_7     = 'bed-7';

const futureExpiry  = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString();
const pastExpiry    = new Date(Date.now() - 1000).toISOString();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Card Tables — DexieAdapter integration', () => {
  let db: DexieAdapter;

  beforeEach(() => {
    db = makeAdapter();
  });

  // ── medications ─────────────────────────────────────────────────────────────

  describe('medications table', () => {
    it('creates and reads a medication record', async () => {
      const created = await db.create('medications', {
        session_id:      SESSION_A,
        bed_id:          BED_3,
        medication_name: 'Paracetamol',
        dose:            '1g',
        frequency:       'every 6h',
        next_due:        '2026-04-19T14:30:00.000Z',
        administered_at: null,
        flagged:         false,
        confidence:      0.94,
        expires_at:      futureExpiry,
      });

      expect(created.id).toBeTruthy();
      const found = await db.read('medications', created.id);
      expect(found).not.toBeNull();
      expect(found?.medication_name).toBe('Paracetamol');
    });
  });

  // ── vital_signs ─────────────────────────────────────────────────────────────

  describe('vital_signs table', () => {
    it('creates and reads a vital signs record', async () => {
      const created = await db.create('vital_signs', {
        session_id:     SESSION_A,
        bed_id:         BED_3,
        blood_pressure: '120/80',
        heart_rate:     72,
        temperature:    37.2,
        spo2:           98,
        timestamp:      '2026-04-19T09:15:00.000Z',
        flagged:        false,
        confidence:     0.91,
        expires_at:     futureExpiry,
      });

      expect(created.id).toBeTruthy();
      const found = await db.read('vital_signs', created.id);
      expect(found).not.toBeNull();
      expect(found?.heart_rate).toBe(72);
    });
  });

  // ── allergies ───────────────────────────────────────────────────────────────

  describe('allergies table', () => {
    it('creates and reads an allergy record', async () => {
      const created = await db.create('allergies', {
        session_id:    SESSION_A,
        bed_id:        BED_3,
        allergen:      'Penicillin',
        reaction_type: 'anaphylaxis',
        severity:      'severe',
        flagged:       false,
        confidence:    0.97,
        expires_at:    futureExpiry,
      });

      expect(created.id).toBeTruthy();
      const found = await db.read('allergies', created.id);
      expect(found).not.toBeNull();
      expect(found?.allergen).toBe('Penicillin');
    });
  });

  // ── safety_info ─────────────────────────────────────────────────────────────

  describe('safety_info table', () => {
    it('creates and reads a safety info record', async () => {
      const created = await db.create('safety_info', {
        session_id:  SESSION_A,
        bed_id:      BED_3,
        safety_flag: 'fall_risk',
        description: 'Patient has history of falls; bed rails must remain raised.',
        flagged:     false,
        confidence:  0.89,
        expires_at:  futureExpiry,
      });

      expect(created.id).toBeTruthy();
      const found = await db.read('safety_info', created.id);
      expect(found).not.toBeNull();
      expect(found?.safety_flag).toBe('fall_risk');
    });
  });

  // ── queryBySessionAndBed ────────────────────────────────────────────────────

  describe('queryBySessionAndBed()', () => {
    beforeEach(async () => {
      // Seed medications across two sessions and two beds
      await db.create('medications', { session_id: SESSION_A, bed_id: BED_3, medication_name: 'Paracetamol', dose: '1g',    frequency: 'every 6h', next_due: '2026-04-19T14:30:00.000Z', administered_at: null, flagged: false, confidence: 0.94, expires_at: futureExpiry });
      await db.create('medications', { session_id: SESSION_A, bed_id: BED_3, medication_name: 'Metformin',   dose: '500mg', frequency: 'twice daily', next_due: '2026-04-19T20:00:00.000Z', administered_at: null, flagged: false, confidence: 0.90, expires_at: futureExpiry });
      await db.create('medications', { session_id: SESSION_A, bed_id: BED_7, medication_name: 'Ibuprofen',   dose: '400mg', frequency: 'every 8h',  next_due: '2026-04-19T16:00:00.000Z', administered_at: null, flagged: false, confidence: 0.88, expires_at: futureExpiry });
      await db.create('medications', { session_id: SESSION_B, bed_id: BED_3, medication_name: 'Amoxicillin', dose: '500mg', frequency: 'every 8h',  next_due: '2026-04-19T18:00:00.000Z', administered_at: null, flagged: false, confidence: 0.92, expires_at: futureExpiry });
    });

    it('returns only records matching session_id AND bed_id', async () => {
      const results = await db.queryBySessionAndBed('medications', SESSION_A, BED_3);
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.session_id).toBe(SESSION_A);
        expect(r.bed_id).toBe(BED_3);
      }
    });

    it('excludes records from a different bed in the same session', async () => {
      const results = await db.queryBySessionAndBed('medications', SESSION_A, BED_3);
      const names = results.map((r: any) => r.medication_name);
      expect(names).not.toContain('Ibuprofen');
    });

    it('excludes records from a different session on the same bed', async () => {
      const results = await db.queryBySessionAndBed('medications', SESSION_A, BED_3);
      const names = results.map((r: any) => r.medication_name);
      expect(names).not.toContain('Amoxicillin');
    });

    it('returns an empty array when no records match', async () => {
      const results = await db.queryBySessionAndBed('medications', 'unknown-session', BED_3);
      expect(results).toEqual([]);
    });

    it('works across all four card stores', async () => {
      await db.create('vital_signs',  { session_id: SESSION_A, bed_id: BED_3, blood_pressure: '120/80', heart_rate: 72, temperature: 37.2, spo2: 98, timestamp: '2026-04-19T09:15:00.000Z', flagged: false, confidence: 0.91, expires_at: futureExpiry });
      await db.create('allergies',    { session_id: SESSION_A, bed_id: BED_3, allergen: 'Penicillin', reaction_type: 'anaphylaxis', severity: 'severe', flagged: false, confidence: 0.97, expires_at: futureExpiry });
      await db.create('safety_info',  { session_id: SESSION_A, bed_id: BED_3, safety_flag: 'fall_risk', description: 'Rails up.', flagged: false, confidence: 0.89, expires_at: futureExpiry });

      const vitals   = await db.queryBySessionAndBed('vital_signs', SESSION_A, BED_3);
      const allergies = await db.queryBySessionAndBed('allergies', SESSION_A, BED_3);
      const safety   = await db.queryBySessionAndBed('safety_info', SESSION_A, BED_3);

      expect(vitals.length).toBe(1);
      expect(allergies.length).toBe(1);
      expect(safety.length).toBe(1);
    });
  });

  // ── purgeExpired ────────────────────────────────────────────────────────────

  describe('purgeExpired() — card stores', () => {
    it('removes expired medication records', async () => {
      const expired = await db.create('medications', {
        session_id: SESSION_A, bed_id: BED_3,
        medication_name: 'OldDrug', dose: '100mg', frequency: 'once', next_due: '2026-04-18T08:00:00.000Z',
        administered_at: null, flagged: false, confidence: 0.5,
        expires_at: pastExpiry,
      });

      const purged = await db.purgeExpired();
      expect(purged).toBeGreaterThanOrEqual(1);

      const found = await db.read('medications', expired.id);
      expect(found).toBeNull();
    });

    it('does not purge non-expired card records', async () => {
      const active = await db.create('allergies', {
        session_id: SESSION_A, bed_id: BED_3,
        allergen: 'Latex', reaction_type: 'contact', severity: 'mild',
        flagged: false, confidence: 0.8,
        expires_at: futureExpiry,
      });

      await db.purgeExpired();

      const found = await db.read('allergies', active.id);
      expect(found).not.toBeNull();
    });
  });
});
