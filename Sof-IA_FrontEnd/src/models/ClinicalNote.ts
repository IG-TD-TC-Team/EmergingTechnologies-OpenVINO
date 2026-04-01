import { BaseEntity } from './BaseEntity';

/**
 * ClinicalNote - AI-extracted structured clinical data
 *
 * Represents structured clinical information extracted from audio
 * transcriptions using NLP/AI. Generated automatically by the
 * AIExtractionService after transcription completes.
 *
 * Lifecycle:
 * 1. Created when AI extraction completes on a transcription
 * 2. Nurse reviews and edits in CorrectionScreen (future feature)
 * 3. Linked to patient record for clinical context
 * 4. Purged when parent session ends
 *
 * Design Notes:
 * - Uses SOAP format (Subjective, Objective, Assessment, Plan)
 * - Supports multiple note types (SOAP, vitals, medications)
 * - Editable by nurse for corrections and additions
 */

/**
 * Type of clinical note
 */
export enum NoteType {
  /**
   * SOAP note (Subjective, Objective, Assessment, Plan)
   * Standard clinical documentation format
   */
  SOAP = 'soap',

  /**
   * Vital signs measurement (BP, HR, temp, SpO2, etc.)
   */
  VITALS = 'vitals',

  /**
   * Medication administration or changes
   */
  MEDICATION = 'medication',

  /**
   * Nursing assessment (skin, mobility, pain, etc.)
   */
  ASSESSMENT = 'assessment',

  /**
   * Incident or event report
   */
  INCIDENT = 'incident',

  /**
   * General observation or note
   */
  GENERAL = 'general',
}

/**
 * Vital signs data structure
 */
export interface VitalSigns {
  /**
   * Blood pressure (systolic/diastolic in mmHg)
   * @example "120/80"
   */
  blood_pressure?: string;

  /**
   * Heart rate (beats per minute)
   * @example 72
   */
  heart_rate?: number;

  /**
   * Respiratory rate (breaths per minute)
   * @example 16
   */
  respiratory_rate?: number;

  /**
   * Body temperature (Celsius or Fahrenheit with unit)
   * @example "37.2°C" | "98.6°F"
   */
  temperature?: string;

  /**
   * Oxygen saturation (percentage)
   * @example 98
   */
  spo2?: number;

  /**
   * Pain level (0-10 scale)
   * @example 3
   */
  pain_level?: number;

  /**
   * Blood glucose (mg/dL)
   * @example 110
   */
  blood_glucose?: number;
}

/**
 * SOAP note structure
 */
export interface SOAPNote {
  /**
   * Subjective: Patient's description of symptoms/concerns
   * @example "Patient reports chest pain radiating to left arm, started 2 hours ago"
   */
  subjective?: string;

  /**
   * Objective: Observable/measurable clinical findings
   * @example "BP 140/90, HR 88, appears diaphoretic, EKG shows ST elevation"
   */
  objective?: string;

  /**
   * Assessment: Diagnosis or clinical interpretation
   * @example "Possible acute myocardial infarction"
   */
  assessment?: string;

  /**
   * Plan: Treatment plan and next steps
   * @example "Administer aspirin 325mg, activate cath lab, continue monitoring"
   */
  plan?: string;
}

/**
 * ClinicalNote entity representing structured clinical data.
 * Extends BaseEntity with clinical-specific fields.
 */
export interface ClinicalNote extends BaseEntity {
  /**
   * Reference to the patient this note is about.
   * Foreign key to Patient.id
   */
  patient_id: string;

  /**
   * Reference to the transcription this note was extracted from.
   * Foreign key to Transcription.id
   * Null if note was manually created (not AI-generated).
   */
  transcription_id: string | null;

  /**
   * Type of clinical note.
   * Determines which structured fields are populated.
   */
  note_type: NoteType;

  /**
   * SOAP note content (if note_type === NoteType.SOAP)
   */
  soap?: SOAPNote;

  /**
   * Vital signs data (if note_type === NoteType.VITALS)
   */
  vitals?: VitalSigns;

  /**
   * Free-form note content.
   * Used for:
   * - Medication notes
   * - Assessment notes
   * - Incident reports
   * - General observations
   * - AI extraction fallback when structure is unclear
   */
  content: string;

  /**
   * AI confidence score (0-1 scale).
   * Indicates reliability of AI extraction.
   * Higher scores = more confident extraction.
   *
   * Null if note was manually created.
   *
   * @example 0.92
   */
  confidence_score: number | null;

  /**
   * Whether nurse has reviewed and approved this note.
   * False = AI-generated, needs review
   * True = Nurse has verified accuracy
   *
   * Used for workflow tracking and compliance.
   */
  reviewed: boolean;

  /**
   * Timestamp when nurse reviewed/edited the note (ISO 8601 format).
   * Null if not yet reviewed.
   *
   * @example "2026-03-25T14:35:00.000Z"
   */
  reviewed_at: string | null;

  /**
   * User-defined tags for categorization and search.
   * AI-suggested or manually added.
   *
   * @example ["urgent", "follow-up", "pain-management"]
   */
  tags: string[];

  /**
   * Whether this note has been edited from AI-generated version.
   * Used for AI model improvement tracking.
   */
  edited: boolean;

  /**
   * Original AI-generated content (before nurse edits).
   * Stored for audit trail and AI training.
   * Null if note was manually created.
   */
  original_content: string | null;
}

/**
 * Type for creating a new clinical note (before persistence).
 * Omits fields that are auto-generated by the repository.
 */
export type CreateClinicalNoteInput = Omit<
  ClinicalNote,
  | 'id'
  | 'created_at'
  | 'expires_at'
  | 'reviewed'
  | 'reviewed_at'
  | 'edited'
  | 'original_content'
> & {
  session_id: string;
  patient_id: string;
  note_type: NoteType;
  content: string;
};

/**
 * Type for updating an existing clinical note.
 * Allows partial updates to mutable fields.
 */
export type UpdateClinicalNoteInput = Partial<
  Pick<
    ClinicalNote,
    | 'soap'
    | 'vitals'
    | 'content'
    | 'reviewed'
    | 'reviewed_at'
    | 'tags'
    | 'edited'
  >
>;
