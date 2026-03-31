/**
 * SQLite Database Migrations
 *
 * Migration system for SQLite database schema evolution.
 * Each migration is a numbered SQL script that runs once.
 *
 * Design:
 * - Migrations run in order (1, 2, 3, ...)
 * - Each migration is tracked in _migrations table
 * - Failed migrations rollback via transaction
 * - WAL mode enabled for concurrent reads during writes
 */

import * as SQLite from 'expo-sqlite';

export interface Migration {
  version: number;
  name: string;
  up: string; // SQL to apply migration
  down?: string; // SQL to rollback (optional)
}

/**
 * All database migrations in order.
 * Add new migrations at the end with incremented version number.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Enable foreign key constraints
      PRAGMA foreign_keys = ON;

      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        nurse_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('active', 'ended', 'pending_sync')),
        device_id TEXT NOT NULL,
        app_version TEXT NOT NULL,
        patient_count INTEGER NOT NULL DEFAULT 0,
        total_recording_duration REAL NOT NULL DEFAULT 0,
        synced INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT
      );

      -- Patients table
      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mrn TEXT,
        bed TEXT,
        date_of_birth TEXT,
        status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'discharged', 'transferred')),
        diagnosis TEXT,
        allergies TEXT,
        medications TEXT,
        notes TEXT,
        last_interaction_at TEXT NOT NULL,
        note_count INTEGER NOT NULL DEFAULT 0,
        recording_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      -- Audio recordings table
      CREATE TABLE IF NOT EXISTS audio_recordings (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        patient_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('recording', 'stopped', 'uploaded', 'transcribed', 'failed', 'deleted')),
        audio_source TEXT NOT NULL CHECK(audio_source IN ('usb_mic', 'device_mic', 'bluetooth_mic', 'unknown')),
        file_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        duration_seconds REAL,
        format_mime_type TEXT NOT NULL,
        format_codec TEXT NOT NULL,
        format_sample_rate INTEGER NOT NULL,
        format_channels INTEGER NOT NULL,
        format_bit_depth INTEGER,
        format_bitrate INTEGER,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        transcription_id TEXT,
        uploaded INTEGER NOT NULL DEFAULT 0,
        uploaded_at TEXT,
        quality_score REAL,
        noise_level_db REAL,
        tags TEXT, -- JSON array
        notes TEXT,
        error_message TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
      );

      -- Transcriptions table
      CREATE TABLE IF NOT EXISTS transcriptions (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        audio_recording_id TEXT NOT NULL,
        patient_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'partial')),
        text TEXT NOT NULL DEFAULT '',
        word_timestamps TEXT, -- JSON array
        confidence_score REAL,
        language TEXT NOT NULL,
        service_provider TEXT NOT NULL,
        api_request_id TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        processing_duration_ms INTEGER,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        extracted INTEGER NOT NULL DEFAULT 0,
        extracted_at TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        FOREIGN KEY (audio_recording_id) REFERENCES audio_recordings(id) ON DELETE CASCADE,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
      );

      -- Clinical notes table
      CREATE TABLE IF NOT EXISTS clinical_notes (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        transcription_id TEXT,
        note_type TEXT NOT NULL CHECK(note_type IN ('soap', 'vitals', 'medication', 'assessment', 'incident', 'general')),
        soap_subjective TEXT,
        soap_objective TEXT,
        soap_assessment TEXT,
        soap_plan TEXT,
        vitals_blood_pressure TEXT,
        vitals_heart_rate INTEGER,
        vitals_respiratory_rate INTEGER,
        vitals_temperature TEXT,
        vitals_spo2 INTEGER,
        vitals_pain_level INTEGER,
        vitals_blood_glucose INTEGER,
        content TEXT NOT NULL,
        confidence_score REAL,
        reviewed INTEGER NOT NULL DEFAULT 0,
        reviewed_at TEXT,
        tags TEXT, -- JSON array
        edited INTEGER NOT NULL DEFAULT 0,
        original_content TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (transcription_id) REFERENCES transcriptions(id) ON DELETE SET NULL
      );

      -- Indexes for common queries
      -- Session queries
      CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

      -- Patient queries (by session, last interaction)
      CREATE INDEX IF NOT EXISTS idx_patients_session_id ON patients(session_id);
      CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);
      CREATE INDEX IF NOT EXISTS idx_patients_last_interaction ON patients(last_interaction_at DESC);
      CREATE INDEX IF NOT EXISTS idx_patients_expires_at ON patients(expires_at);

      -- Audio recording queries (by session, patient, status)
      CREATE INDEX IF NOT EXISTS idx_audio_recordings_session_id ON audio_recordings(session_id);
      CREATE INDEX IF NOT EXISTS idx_audio_recordings_patient_id ON audio_recordings(patient_id);
      CREATE INDEX IF NOT EXISTS idx_audio_recordings_status ON audio_recordings(status);
      CREATE INDEX IF NOT EXISTS idx_audio_recordings_expires_at ON audio_recordings(expires_at);

      -- Transcription queries (by session, audio, patient)
      CREATE INDEX IF NOT EXISTS idx_transcriptions_session_id ON transcriptions(session_id);
      CREATE INDEX IF NOT EXISTS idx_transcriptions_audio_recording_id ON transcriptions(audio_recording_id);
      CREATE INDEX IF NOT EXISTS idx_transcriptions_patient_id ON transcriptions(patient_id);
      CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);
      CREATE INDEX IF NOT EXISTS idx_transcriptions_expires_at ON transcriptions(expires_at);

      -- Clinical notes queries (by session, patient, transcription)
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_session_id ON clinical_notes(session_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient_id ON clinical_notes(patient_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_transcription_id ON clinical_notes(transcription_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_note_type ON clinical_notes(note_type);
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_reviewed ON clinical_notes(reviewed);
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_expires_at ON clinical_notes(expires_at);

      -- Migration tracking table
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `,
  },
];

/**
 * Run all pending migrations
 */
export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  console.log('[SQLite] Running migrations...');

  // Get current migration version
  const currentVersion = await getCurrentVersion(db);
  console.log(`[SQLite] Current version: ${currentVersion}`);

  // Filter pending migrations
  const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    console.log('[SQLite] No pending migrations');
    return;
  }

  console.log(`[SQLite] Found ${pendingMigrations.length} pending migration(s)`);

  // Apply each migration in a transaction
  for (const migration of pendingMigrations) {
    console.log(`[SQLite] Applying migration ${migration.version}: ${migration.name}`);

    try {
      await db.execAsync(`
        BEGIN TRANSACTION;
        ${migration.up}
        INSERT INTO _migrations (version, name, applied_at) VALUES (${migration.version}, '${migration.name}', '${new Date().toISOString()}');
        COMMIT;
      `);

      console.log(`[SQLite] Migration ${migration.version} applied successfully`);
    } catch (error) {
      console.error(`[SQLite] Migration ${migration.version} failed:`, error);
      await db.execAsync('ROLLBACK;');
      throw new Error(`Migration ${migration.version} failed: ${error}`);
    }
  }

  console.log('[SQLite] All migrations completed');
}

/**
 * Get current database version
 */
async function getCurrentVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  try {
    // Check if migrations table exists
    const result = await db.getFirstAsync<{ version: number }>(
      "SELECT MAX(version) as version FROM _migrations"
    );
    return result?.version ?? 0;
  } catch (error) {
    // Migrations table doesn't exist yet
    return 0;
  }
}

/**
 * Initialize database with WAL mode and migrations
 */
export async function initializeDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  console.log('[SQLite] Initializing database...');

  // Enable WAL mode for better concurrency
  // WAL allows multiple readers while one writer is active
  await db.execAsync('PRAGMA journal_mode = WAL;');
  console.log('[SQLite] WAL mode enabled');

  // Enable foreign key constraints
  await db.execAsync('PRAGMA foreign_keys = ON;');
  console.log('[SQLite] Foreign key constraints enabled');

  // Run migrations
  await runMigrations(db);

  console.log('[SQLite] Database initialized');
}
