import { BaseEntity } from './BaseEntity';

/**
 * AudioRecording - Audio file metadata and storage reference
 *
 * Represents a captured audio recording from bedside conversations.
 * Stores metadata and file references, not the raw audio data itself.
 * Audio files are stored separately (filesystem or object storage).
 *
 * Lifecycle:
 * 1. Created when nurse starts recording (mic button pressed)
 * 2. Updated with duration/file info when recording stops
 * 3. Linked to Transcription entity after upload to API
 * 4. Purged 7 days after creation (or when session ends, whichever is sooner)
 *
 * Design Notes:
 * - Supports both USB-C microphone and device built-in mic
 * - Tracks storage location for cleanup and playback
 * - Metadata enables audio quality analysis and debugging
 */

/**
 * Audio recording status
 */
export enum RecordingStatus {
  /**
   * Recording is currently in progress
   */
  RECORDING = 'recording',

  /**
   * Recording stopped, file saved locally
   */
  STOPPED = 'stopped',

  /**
   * Recording uploaded to transcription service
   */
  UPLOADED = 'uploaded',

  /**
   * Transcription completed (linked to Transcription entity)
   */
  TRANSCRIBED = 'transcribed',

  /**
   * Recording failed (permission denied, device error, etc.)
   */
  FAILED = 'failed',

  /**
   * Recording deleted from storage (cleanup)
   */
  DELETED = 'deleted',
}

/**
 * Audio source (microphone type)
 */
export enum AudioSource {
  /**
   * USB-C connected external microphone (e.g., Rhode Mini Wireless)
   */
  USB_MIC = 'usb_mic',

  /**
   * Device built-in microphone
   */
  DEVICE_MIC = 'device_mic',

  /**
   * Bluetooth headset/microphone
   */
  BLUETOOTH_MIC = 'bluetooth_mic',

  /**
   * Unknown or undetected source
   */
  UNKNOWN = 'unknown',
}

/**
 * Audio format/codec information
 */
export interface AudioFormat {
  /**
   * MIME type of the audio file
   * @example "audio/mp4" | "audio/wav" | "audio/webm"
   */
  mime_type: string;

  /**
   * Audio codec used
   * @example "aac" | "pcm" | "opus"
   */
  codec: string;

  /**
   * Sample rate in Hz
   * @example 44100 | 48000
   */
  sample_rate: number;

  /**
   * Number of audio channels
   * @example 1 (mono) | 2 (stereo)
   */
  channels: number;

  /**
   * Bit depth (bits per sample)
   * @example 16 | 24 | 32
   */
  bit_depth: number | null;

  /**
   * Bitrate in kbps
   * @example 128 | 256
   */
  bitrate: number | null;
}

/**
 * AudioRecording entity representing a captured audio file.
 * Extends BaseEntity with audio-specific fields.
 */
export interface AudioRecording extends BaseEntity {
  /**
   * Reference to the patient this recording is about.
   * Foreign key to Patient.id
   * Null if patient hasn't been assigned yet (ambient recording mode).
   */
  patient_id: string | null;

  /**
   * Current status of the recording.
   */
  status: RecordingStatus;

  /**
   * Microphone/audio source used for this recording.
   */
  audio_source: AudioSource;

  /**
   * File path or URI where audio file is stored.
   * Platform-specific:
   * - Android: file:///data/user/0/.../recordings/rec_123.m4a
   * - Web: indexeddb://audio-blobs/rec_123 (Blob reference)
   *
   * @example "file:///data/user/0/com.sofia.app/files/recordings/rec_20260325_143022.m4a"
   */
  file_path: string;

  /**
   * Original filename (without path).
   * Used for download/export features.
   *
   * @example "rec_20260325_143022.m4a"
   */
  filename: string;

  /**
   * File size in bytes.
   * Used for storage quota tracking and cleanup prioritization.
   *
   * @example 1048576 (1 MB)
   */
  file_size_bytes: number;

  /**
   * Recording duration in seconds.
   * Null if recording is still in progress.
   *
   * @example 123.45
   */
  duration_seconds: number | null;

  /**
   * Audio format metadata.
   */
  format: AudioFormat;

  /**
   * Timestamp when recording started (ISO 8601 format).
   * @example "2026-03-25T14:30:00.000Z"
   */
  started_at: string;

  /**
   * Timestamp when recording stopped (ISO 8601 format).
   * Null if still recording.
   *
   * @example "2026-03-25T14:32:03.450Z"
   */
  stopped_at: string | null;

  /**
   * Reference to the transcription generated from this recording.
   * Foreign key to Transcription.id
   * Null if not yet transcribed.
   */
  transcription_id: string | null;

  /**
   * Whether the audio file has been uploaded to transcription service.
   */
  uploaded: boolean;

  /**
   * Timestamp when file was uploaded (ISO 8601 format).
   * Null if not yet uploaded.
   *
   * @example "2026-03-25T14:32:10.000Z"
   */
  uploaded_at: string | null;

  /**
   * Audio quality score (0-1 scale).
   * Calculated based on:
   * - Sample rate
   * - Background noise level
   * - Clipping/distortion detection
   *
   * Used to warn nurse about poor audio quality before transcription.
   *
   * @example 0.85
   */
  quality_score: number | null;

  /**
   * Background noise level (dB).
   * Used for audio quality assessment.
   *
   * @example -40 (quiet) | -20 (moderate noise) | -10 (high noise)
   */
  noise_level_db: number | null;

  /**
   * User-assigned tags for organization.
   * @example ["urgent", "medication-change", "family-present"]
   */
  tags: string[];

  /**
   * Free-form notes about the recording context.
   * Added by nurse for additional context.
   *
   * @example "Family meeting with patient's daughter present"
   */
  notes: string | null;

  /**
   * Error message if recording failed.
   * Null if successful.
   *
   * @example "Microphone permission denied" | "Storage full" | "Device disconnected"
   */
  error_message: string | null;
}

/**
 * Type for creating a new audio recording (before persistence).
 * Omits fields that are auto-generated by the repository.
 */
export type CreateAudioRecordingInput = Omit<
  AudioRecording,
  | 'id'
  | 'created_at'
  | 'expires_at'
  | 'duration_seconds'
  | 'stopped_at'
  | 'transcription_id'
  | 'uploaded'
  | 'uploaded_at'
  | 'quality_score'
  | 'noise_level_db'
  | 'error_message'
> & {
  session_id: string;
  status: RecordingStatus.RECORDING;
  audio_source: AudioSource;
  file_path: string;
  filename: string;
  format: AudioFormat;
  started_at: string;
};

/**
 * Type for updating an existing audio recording.
 * Allows partial updates to mutable fields.
 */
export type UpdateAudioRecordingInput = Partial<
  Pick<
    AudioRecording,
    | 'patient_id'
    | 'status'
    | 'file_size_bytes'
    | 'duration_seconds'
    | 'stopped_at'
    | 'transcription_id'
    | 'uploaded'
    | 'uploaded_at'
    | 'quality_score'
    | 'noise_level_db'
    | 'tags'
    | 'notes'
    | 'error_message'
  >
>;
