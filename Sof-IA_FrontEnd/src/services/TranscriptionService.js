/**
 * TranscriptionService
 *
 * Sends audio chunks to POST /api/voice/transcribe-and-structure, persists
 * the response as a transcription_segment, and cleans up the raw audio.
 *
 * On API failure the chunk is handed to OfflineQueueManager for retry.
 *
 * TTL for stored segments = session.started_at + 14 hours (not the default 30 days).
 *
 * ─── API Response Contract ─────────────────────────────────────────────────────
 *
 * The backend returns a JSON object with the following shape.
 * All card-data lives under `structured`; top-level fields are metadata.
 *
 * {
 *   transcript:       string,          // raw transcription text
 *   language:         string,          // e.g. "fr"
 *   confidence:       number,          // 0–1
 *   timestamp_start:  number,          // epoch ms
 *   timestamp_end:    number,          // epoch ms
 *
 *   structured: {
 *     // ── Identity ──────────────────────────────────────────────────────────
 *     patient_name:  string | null,
 *     room:          string | null,
 *     activity_type: string | null,    // e.g. "assessment", "medication"
 *     actions:       string[] | null,
 *
 *     // ── Medications card ──────────────────────────────────────────────────
 *     medications: Array<{
 *       medication_name: string,       // e.g. "Paracetamol"
 *       dose:            string,       // e.g. "1g"
 *       frequency:       string,       // e.g. "every 6h"
 *       next_due:        string,       // ISO-8601 datetime
 *       administered_at: string | null // ISO-8601 datetime or null
 *     }> | null,
 *
 *     // ── Vital Signs card ──────────────────────────────────────────────────
 *     vital_signs: {
 *       blood_pressure: string | null, // e.g. "120/80"
 *       heart_rate:     number | null, // bpm
 *       temperature:    number | null, // °C
 *       spo2:           number | null, // %
 *       timestamp:      string         // ISO-8601 datetime of measurement
 *     } | null,
 *
 *     // ── Allergies card ────────────────────────────────────────────────────
 *     allergies: Array<{
 *       allergen:      string,         // e.g. "Penicillin"
 *       reaction_type: string,         // e.g. "anaphylaxis"
 *       severity:      string          // "mild" | "moderate" | "severe"
 *     }> | null,
 *
 *     // ── Safety Info card ──────────────────────────────────────────────────
 *     safety_info: Array<{
 *       safety_flag:  string,          // e.g. "fall_risk"
 *       description:  string           // human-readable explanation
 *     }> | null
 *   }
 * }
 *
 * The `structured` object is stored verbatim as structured_json (JSON string)
 * in the transcription_segments table.  Downstream card repositories read
 * that field and fan out into their own stores (medications, vital_signs,
 * allergies, safety_info).
 *
 * See src/__tests__/helpers/transcription-fixture.ts for the canonical fixture
 * used across all unit and integration tests.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import { getStorage } from '../repositories';
import { capabilities } from '../config/capabilities';
import SessionService from './SessionService';
import OfflineQueueManager from './queue/OfflineQueueManager';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.sofia-health.example/v1';
const ENDPOINT = `${API_BASE_URL}/api/voice/transcribe-and-structure`;
console.log('[TranscriptionService] API endpoint:', ENDPOINT);

const TranscriptionService = {

  /**
   * Process one audio chunk end-to-end:
   * upload → persist segment → delete raw audio.
   * On any API failure the chunk is queued for retry.
   *
   * @param {object} params
   * @param {string} params.recordingId    — AudioRecording.id in DB
   * @param {string} params.filePath       — indexeddb://audio-blobs/<uuid> (web)
   *                                         or file:///... (Android)
   * @param {string} params.sessionId      — session_id string
   * @param {string} params.mimeType       — 'audio/webm' | 'audio/mp4'
   * @param {number} params.timestampStart — recording start time in ms
   */
  async processChunk({ recordingId, filePath, sessionId, mimeType, patientId = null, timestampStart }) {
    try {
      const session = await SessionService.getActiveShift();
      const nurseId = session?.nurse_name ?? 'unknown';

      // TTL shared by the segment row and all card rows derived from it.
      const startedAt = session?.started_at ?? new Date().toISOString();
      const expiresAt = new Date(
        new Date(startedAt).getTime() + 14 * 60 * 60 * 1000
      ).toISOString();

      const formData = await this._buildFormData(filePath, mimeType);
      formData.append('session_id', sessionId);
      formData.append('timestamp_start', String(timestampStart));
      formData.append('nurse_id', nurseId);

      const response = await fetch(ENDPOINT, { method: 'POST', body: formData });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data = await response.json();

      await this._persistSegment(data, recordingId, sessionId, expiresAt, patientId);
      await this._fanOutCardData(data.structured, sessionId, patientId, expiresAt, data.confidence);
      await this._markRecordingTranscribed(recordingId);
      await this._deleteRawAudio(filePath);

      console.log('[TranscriptionService] Chunk processed — recording:', recordingId);
      return { success: true };
    } catch (error) {
      console.warn('[TranscriptionService] Chunk failed, queuing for retry:', error.message);
      await OfflineQueueManager.enqueue(recordingId, sessionId);
      return { success: false, error: error.message };
    }
  },

  // ─── Private helpers ───────────────────────────────────────────────────────

  async _buildFormData(filePath, mimeType) {
    const formData = new FormData();

    if (capabilities.isWeb) {
      const blob = await this._readBlobFromDexie(filePath);
      formData.append('audio', blob, 'chunk.webm');
    } else {
      const filename = filePath.split('/').pop();
      formData.append('audio', {
        uri: filePath,
        name: filename,
        type: mimeType ?? 'audio/mp4',
      });
    }

    return formData;
  },

  async _readBlobFromDexie(filePath) {
    // filePath format: indexeddb://audio-blobs/<uuid>
    const blobId = filePath.replace('indexeddb://audio-blobs/', '');
    const storage = await getStorage();
    const record = await storage.read('audio_blobs', blobId);
    if (!record) throw new Error(`Blob not found in IndexedDB: ${blobId}`);
    return record.blob;
  },

  async _persistSegment(apiResponse, recordingId, sessionId, expiresAt, patientId = null) {
    const storage = await getStorage();

    await storage.create('transcription_segments', {
      id: uuidv4(),
      session_id: sessionId,
      audio_recording_id: recordingId,
      transcript: apiResponse.transcript ?? '',
      structured_json: apiResponse.structured
        ? JSON.stringify(apiResponse.structured)
        : null,
      language: apiResponse.language ?? 'fr',
      confidence: apiResponse.confidence ?? null,
      ts_start: apiResponse.timestamp_start ?? null,
      ts_end: apiResponse.timestamp_end ?? null,
      bed_id: patientId,
      expires_at: expiresAt,
    });
  },

  /**
   * Fan out structured card data from one API response into the four dedicated
   * card stores (medications, vital_signs, allergies, safety_info).
   *
   * Non-fatal — a write failure is logged but does not fail the chunk pipeline.
   * Skipped entirely when structured is null/undefined or bedId is null.
   *
   * @param {object|null} structured - The `structured` field from the API response
   * @param {string}      sessionId
   * @param {string|null} bedId      - Corresponds to patientId / bed_id column
   * @param {string}      expiresAt  - Same TTL as the parent segment row
   * @param {number|null} confidence - Top-level confidence score from the API
   */
  async _fanOutCardData(structured, sessionId, bedId, expiresAt, confidence) {
    if (!structured || !bedId) return;

    // Log the full structured payload so field-name mismatches are visible in devtools
    console.log('[TranscriptionService] fan-out structured:', JSON.stringify(structured));

    try {
      const storage = await getStorage();
      const base = {
        session_id: sessionId,
        bed_id:     bedId,
        expires_at: expiresAt,
        confidence: confidence ?? null,
        flagged:    false,
      };

      // ── Medications ──────────────────────────────────────────────────────────
      // LLM returns either objects OR plain strings like "paracetamol - 1 gramme"
      const meds = structured.medications ?? structured.medicaments ?? structured.drugs ?? [];
      if (Array.isArray(meds) && meds.length > 0) {
        for (const med of meds) {
          let medName, medDose, medFrequency, medNextDue, medAdministeredAt;

          if (typeof med === 'string') {
            // Parse "medication_name - dose" format
            const dashIdx = med.indexOf(' - ');
            if (dashIdx !== -1) {
              medName = med.substring(0, dashIdx).trim();
              medDose = med.substring(dashIdx + 3).trim();
            } else {
              medName = med.trim();
              medDose = '';
            }
            medFrequency     = '';
            medNextDue       = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
            medAdministeredAt = null;
          } else {
            medName = (
              med.medication_name || med.name || med.drug || med.medicament
              || med.medicationName || med.medicine || ''
            ).trim();
            medDose          = med.dose || med.dosage || med.amount || med.posologie || '';
            medFrequency     = med.frequency || med.interval || med.schedule || med.frequence || '';
            medNextDue       = med.next_due || med.nextDue || med.next_administration
                               || new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
            medAdministeredAt = med.administered_at ?? null;
          }

          await storage.create('medications', {
            ...base,
            medication_name: medName || 'Medication identified',
            dose:            medDose,
            frequency:       medFrequency,
            next_due:        medNextDue,
            administered_at: medAdministeredAt,
          });
        }
      }

      // ── Vital Signs (single row per response) ────────────────────────────────
      // Accept 'vital_signs', 'vitals', 'signes_vitaux' from the LLM
      const vs = structured.vital_signs ?? structured.vitals ?? structured.signes_vitaux ?? null;
      if (vs) {
        const hasAnyValue =
          (vs.blood_pressure ?? vs.bp ?? vs.tension) != null ||
          (vs.heart_rate     ?? vs.hr ?? vs.fc)      != null ||
          (vs.temperature    ?? vs.temp)              != null ||
          (vs.spo2           ?? vs.saturation)        != null;

        if (hasAnyValue) {
          await storage.create('vital_signs', {
            ...base,
            blood_pressure: vs.blood_pressure ?? vs.bp  ?? vs.tension    ?? null,
            heart_rate:     vs.heart_rate     ?? vs.hr  ?? vs.fc         ?? null,
            temperature:    vs.temperature    ?? vs.temp                  ?? null,
            spo2:           vs.spo2           ?? vs.saturation            ?? null,
            timestamp:      vs.timestamp      ?? vs.measured_at           ?? new Date().toISOString(),
          });
        }
      }

      // ── Allergies ────────────────────────────────────────────────────────────
      if (Array.isArray(structured.allergies)) {
        for (const allergy of structured.allergies) {
          await storage.create('allergies', {
            ...base,
            allergen:      allergy.allergen      || allergy.allergen_name || '',
            reaction_type: allergy.reaction_type || allergy.reaction      || '',
            severity:      allergy.severity      || allergy.severite      || 'unknown',
          });
        }
      }

      // ── Safety Info ──────────────────────────────────────────────────────────
      if (Array.isArray(structured.safety_info)) {
        for (const info of structured.safety_info) {
          await storage.create('safety_info', {
            ...base,
            safety_flag: info.safety_flag || info.flag  || '',
            description: info.description || info.details || '',
          });
        }
      }
    } catch (err) {
      // Non-fatal — segment is already saved; cards can be re-derived on next response
      console.warn('[TranscriptionService] Card fan-out failed:', err.message);
    }
  },

  async _markRecordingTranscribed(recordingId) {
    const storage = await getStorage();
    await storage.update('audio_recordings', recordingId, {
      status: 'transcribed',
      uploaded: 1,
      uploaded_at: new Date().toISOString(),
    });
  },

  async _deleteRawAudio(filePath) {
    try {
      if (capabilities.isWeb) {
        const blobId = filePath.replace('indexeddb://audio-blobs/', '');
        const storage = await getStorage();
        await storage.delete('audio_blobs', blobId);
      } else {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      }
    } catch (err) {
      // Non-fatal — raw audio cleanup failure should not fail the transcription
      console.warn('[TranscriptionService] Failed to delete raw audio:', err.message);
    }
  },
};

export default TranscriptionService;