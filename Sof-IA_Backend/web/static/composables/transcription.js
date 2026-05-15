/**
 * @fileoverview TranscriptionStore — reactive state for the ASR transcription tab.
 *
 * The user picks a curated benchmark sample (LibriSpeech / MLS French), triggers
 * transcription with the selected ASR model, and sees the model output alongside
 * the dataset reference transcription.
 */

class TranscriptionStore {
  constructor(asrModels) {
    /** @type {import('vue').Ref<Array>} Completed and in-progress transcription runs */
    this.runs = Vue.ref([]);

    /** @type {import('vue').Ref<string>} Selected ASR model ID */
    this.modelId = Vue.ref(asrModels.length ? asrModels[0].id : '');

    /** @type {import('vue').Ref<Object|null>} Selected audio sample from /api/audio/samples */
    this.selectedSample = Vue.ref(null);

    /** @type {import('vue').Ref<boolean>} True while a transcription is in flight */
    this.busy = Vue.ref(false);

    /** @type {import('vue').Ref<string>} Live progress message from the server */
    this.status = Vue.ref('');

    /** @type {import('vue').Ref<string|null>} Error message, null when none */
    this.error = Vue.ref(null);

    /** @private EventSource connection, closed when the job finishes */
    this._sse = null;
  }

  /** Transcribe the selected sample with the selected ASR model. */
  async transcribe() {
    const sample = this.selectedSample.value;
    if (!sample || this.busy.value) return;

    this.error.value = null;
    this.status.value = '';
    this.busy.value = true;

    const runIndex = this.runs.value.length;
    this.runs.value.push({
      filename:    sample.file.split('/').pop(),
      language:    sample.language,
      duration_s:  sample.duration_s,
      model_id:    this.modelId.value,
      reference:   sample.reference,
      transcript:  '',
      metrics:     null,
      streaming:   true,
    });

    let jobId;
    try {
      const res = await API.startTranscriptionSample(this.modelId.value, sample.file);
      jobId = res.job_id;
    } catch (err) {
      this.error.value = `Failed to start transcription: ${err.message}`;
      this.runs.value[runIndex].streaming = false;
      this._cleanup();
      return;
    }

    this._sse = API.streamJob(jobId);

    this._sse.onmessage = (evt) => {
      let event;
      try { event = JSON.parse(evt.data); } catch { return; }

      if (event.type === 'progress') {
        this.status.value = event.message;
      } else if (event.type === 'done') {
        const m = (event.result || {}).metrics || {};
        this.runs.value[runIndex].transcript = m.full_transcript || '';
        this.runs.value[runIndex].streaming  = false;
        this.runs.value[runIndex].metrics    = {
          audio_duration_s: m.audio_duration_s ?? null,
          processing_ms:    m.processing_ms    ?? null,
          rtf:              m.rtf              ?? null,
          word_count:       m.word_count       ?? null,
          words_per_min:    m.words_per_min    ?? null,
        };
        this.status.value = '';
        this._cleanup();
      } else if (event.type === 'error') {
        this.error.value = event.message || 'Transcription failed';
        this.runs.value[runIndex].streaming = false;
        this.status.value = '';
        this._cleanup();
      }
    };

    this._sse.onerror = () => {
      this.error.value = 'SSE connection lost.';
      if (this.runs.value[runIndex]) {
        this.runs.value[runIndex].streaming = false;
      }
      this.status.value = '';
      this._cleanup();
    };
  }

  /** Clear all runs and reset selection state. */
  clear() {
    this._cleanup();
    this.runs.value        = [];
    this.selectedSample.value = null;
    this.error.value       = null;
    this.status.value      = '';
  }

  /** @private Close SSE and reset busy flag. */
  _cleanup() {
    if (this._sse) { this._sse.close(); this._sse = null; }
    this.busy.value = false;
  }
}