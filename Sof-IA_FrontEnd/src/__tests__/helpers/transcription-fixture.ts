/**
 * Canonical API response fixture for POST /api/voice/transcribe-and-structure.
 *
 * This is the single source of truth for the structured response shape used
 * in unit tests (TranscriptionService, PatientDetailsPresenter, card stores)
 * and integration tests (storage fan-out, card display).
 *
 * Import the full response:
 *   import { TRANSCRIPTION_FIXTURE } from '../helpers/transcription-fixture';
 *
 * Import individual sections for focused tests:
 *   import { MEDICATIONS_FIXTURE, VITAL_SIGNS_FIXTURE } from '../helpers/transcription-fixture';
 */

// ─── Card-level types ─────────────────────────────────────────────────────────

export interface MedicationEntry {
  medication_name: string;
  dose: string;
  frequency: string;
  next_due: string;        // ISO-8601 datetime
  administered_at: string | null;
}

export interface VitalSigns {
  blood_pressure: string | null;
  heart_rate: number | null;  // bpm
  temperature: number | null; // °C
  spo2: number | null;        // %
  timestamp: string;          // ISO-8601 datetime of measurement
}

export interface AllergyEntry {
  allergen: string;
  reaction_type: string;
  severity: 'mild' | 'moderate' | 'severe';
}

export interface SafetyInfoEntry {
  safety_flag: string;
  description: string;
}

// ─── Structured payload (the `structured` field of the API response) ──────────

export interface StructuredClinicalData {
  // Identity
  patient_name: string | null;
  room: string | null;
  activity_type: string | null;
  actions: string[] | null;

  // Cards
  medications: MedicationEntry[] | null;
  vital_signs: VitalSigns | null;
  allergies: AllergyEntry[] | null;
  safety_info: SafetyInfoEntry[] | null;
}

// ─── Full API response ────────────────────────────────────────────────────────

export interface TranscriptionApiResponse {
  transcript: string;
  language: string;
  confidence: number;
  timestamp_start: number; // epoch ms
  timestamp_end: number;   // epoch ms
  structured: StructuredClinicalData;
}

// ─── Individual card fixtures (used in card-level tests) ─────────────────────

export const MEDICATIONS_FIXTURE: MedicationEntry[] = [
  {
    medication_name: 'Paracetamol',
    dose: '1g',
    frequency: 'every 6h',
    next_due: '2026-04-19T14:30:00.000Z',
    administered_at: '2026-04-19T08:30:00.000Z',
  },
  {
    medication_name: 'Metformin',
    dose: '500mg',
    frequency: 'twice daily',
    next_due: '2026-04-19T20:00:00.000Z',
    administered_at: null,
  },
];

export const VITAL_SIGNS_FIXTURE: VitalSigns = {
  blood_pressure: '120/80',
  heart_rate: 72,
  temperature: 37.2,
  spo2: 98,
  timestamp: '2026-04-19T09:15:00.000Z',
};

export const ALLERGIES_FIXTURE: AllergyEntry[] = [
  {
    allergen: 'Penicillin',
    reaction_type: 'anaphylaxis',
    severity: 'severe',
  },
  {
    allergen: 'Latex',
    reaction_type: 'contact dermatitis',
    severity: 'moderate',
  },
];

export const SAFETY_INFO_FIXTURE: SafetyInfoEntry[] = [
  {
    safety_flag: 'fall_risk',
    description: 'Patient has history of falls; bed rails must remain raised.',
  },
  {
    safety_flag: 'nil_by_mouth',
    description: 'Fasting prior to procedure scheduled at 11:00.',
  },
];

// ─── Full structured block ────────────────────────────────────────────────────

export const STRUCTURED_FIXTURE: StructuredClinicalData = {
  patient_name: 'Alice Martin',
  room: '3',
  activity_type: 'assessment',
  actions: ['administer_medication', 'record_vitals'],

  medications: MEDICATIONS_FIXTURE,
  vital_signs: VITAL_SIGNS_FIXTURE,
  allergies: ALLERGIES_FIXTURE,
  safety_info: SAFETY_INFO_FIXTURE,
};

// ─── Full API response fixture ────────────────────────────────────────────────

export const TRANSCRIPTION_FIXTURE: TranscriptionApiResponse = {
  transcript: 'Patient Alice Martin en chambre 3. Paracétamol 1g toutes les 6h, prochain à 14h30. TA 120/80, FC 72, T° 37,2, SpO2 98% à 09h15. Allergie pénicilline anaphylaxie sévère. Risque de chute — barrières du lit relevées.',
  language: 'fr',
  confidence: 0.94,
  timestamp_start: 1713513600000,
  timestamp_end:   1713513648000,
  structured: STRUCTURED_FIXTURE,
};

// ─── Minimal fixture (no card data — used to test "no empty placeholders") ───

export const EMPTY_STRUCTURED_FIXTURE: StructuredClinicalData = {
  patient_name: 'Bob Durand',
  room: '7',
  activity_type: 'observation',
  actions: null,

  medications: null,
  vital_signs: null,
  allergies: null,
  safety_info: null,
};

export const EMPTY_TRANSCRIPTION_FIXTURE: TranscriptionApiResponse = {
  transcript: 'Patient Bob Durand chambre 7, observation.',
  language: 'fr',
  confidence: 0.88,
  timestamp_start: 1713513700000,
  timestamp_end:   1713513710000,
  structured: EMPTY_STRUCTURED_FIXTURE,
};
