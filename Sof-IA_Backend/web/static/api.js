/**
 * @fileoverview Pure HTTP service layer for the OpenVino Benchmark API.
 *
 * All communication with the FastAPI backend is centralised here.
 * No framework dependency — this module uses only the native `fetch` API
 * and the browser's built-in `EventSource`.
 *
 * Exposed as the global constant {@link API}.
 *
 * @module api
 */

/**
 * @typedef {Object} ModelMeta
 * @property {string}  id      - Registry key, e.g. `"phi3_pytorch"`.
 * @property {string}  label   - Human-readable display name.
 * @property {string}  type    - `"slm"` or `"asr"`.
 * @property {boolean} enabled - Whether the model is active in `models.yaml`.
 */

/**
 * @typedef {Object} StandardInputs
 * @property {string} slm_prompt      - Default SLM prompt text.
 * @property {string} asr_audio_path  - Default audio file path for ASR.
 * @property {string} asr_reference   - Reference transcript for WER computation.
 */

/**
 * @typedef {Object} AudioSample
 * @property {string} file        - Relative path to the audio file.
 * @property {string} reference   - Ground-truth transcript.
 * @property {string} language    - BCP-47 language code, e.g. `"en"`.
 * @property {number} duration_s  - Duration in seconds.
 */

/**
 * @typedef {Object} BenchmarkResult
 * @property {string} model_id     - Model registry key.
 * @property {string} result_id    - Filename stem, e.g. `"benchmark_20240101_120000"`.
 * @property {number} warmup_runs  - Number of discarded warm-up iterations.
 * @property {number} timed_runs   - Number of measured iterations.
 * @property {Object} metrics      - Latency, memory, ms/token, WER, transcript.
 */

/**
 * @typedef {Object} JobStatus
 * @property {string}           job_id  - UUID assigned at job creation.
 * @property {string}           status  - `"pending"` | `"running"` | `"done"` | `"failed"`.
 * @property {BenchmarkResult}  [result]- Present when `status === "done"`.
 * @property {string}           [error] - Present when `status === "failed"`.
 */

/**
 * @typedef {Object} StartBenchmarkPayload
 * @property {string} model_id             - Model registry key.
 * @property {string} input_data           - Prompt text (SLM) or audio path (ASR).
 * @property {number} warmup_runs          - Warm-up iterations to discard.
 * @property {number} timed_runs           - Iterations to measure.
 * @property {string} [reference_transcript] - Ground-truth for WER (ASR only).
 */

/**
 * Frozen singleton exposing all backend API calls.
 * @namespace API
 */
const API = (() => {
  /**
   * Internal fetch wrapper — throws on non-2xx responses.
   *
   * @param {string} path - URL path relative to the server root.
   * @param {RequestInit} [opts={}] - Options forwarded to `fetch`.
   * @returns {Promise<*>} Parsed JSON response body.
   * @throws {Error} If the HTTP status is not in the 2xx range.
   */
  async function _fetch(path, opts = {}) {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  return Object.freeze({
    /**
     * Fetch all models registered in `config/models.yaml`.
     *
     * @returns {Promise<ModelMeta[]>} Array of model metadata objects.
     */
    getModels: () => _fetch('/api/models'),

    /**
     * Fetch the standard benchmark inputs (default prompt and audio sample).
     *
     * @returns {Promise<StandardInputs>} Default input values.
     */
    getStandardInputs: () => _fetch('/api/benchmark/inputs'),

    /**
     * Fetch the list of available audio samples for ASR benchmarks.
     *
     * @returns {Promise<AudioSample[]>} Array of audio sample descriptors.
     */
    getAudioSamples: () => _fetch('/api/audio/samples'),

    /**
     * Fetch metadata for all past benchmark results, newest first.
     *
     * @returns {Promise<Array<{id: string, timestamp: string, model_id: string}>>}
     */
    getResults: () => _fetch('/api/results'),

    /**
     * Fetch a single benchmark result by its ID.
     *
     * @param {string} id - Result ID, e.g. `"benchmark_20240101_120000"`.
     * @returns {Promise<BenchmarkResult>} Full result object.
     */
    getResult: (id) => _fetch(`/api/results/${id}`),

    /**
     * Poll the current status of a background benchmark job.
     *
     * @param {string} jobId - UUID returned by {@link API.startBenchmark}.
     * @returns {Promise<JobStatus>} Current job status and optional result.
     */
    getJob: (jobId) => _fetch(`/api/benchmark/${jobId}`),

    /**
     * Start a new benchmark job in the background.
     *
     * @param {StartBenchmarkPayload} payload - Job parameters.
     * @returns {Promise<{job_id: string}>} The assigned job UUID.
     */
    startBenchmark: (payload) => _fetch('/api/benchmark/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

    /**
     * Open a Server-Sent Events stream for live progress of a running job.
     * Each event is a JSON object with a `type` field:
     * `"progress"` | `"done"` | `"error"`.
     *
     * @param {string} jobId - UUID of the running job.
     * @returns {EventSource} SSE connection — caller is responsible for closing it.
     */
    streamJob: (jobId) => new EventSource(`/api/benchmark/${jobId}/stream`),

    /**
     * Fetch recent log entries from logs/app.json.
     *
     * @param {string} [qs=''] - Query string, e.g. `'?n=200&level=ERROR'`.
     * @returns {Promise<Array>} Array of log record objects, newest first.
     */
    getLogs: (qs = '') => _fetch('/api/logs' + qs),

    /**
     * Send a user message and start a streaming SLM generation.
     *
     * @param {string} model_id      - SLM model registry key.
     * @param {string} message       - User message text.
     * @param {string} system_prompt - System prompt for the conversation.
     * @returns {Promise<{job_id: string}>} The assigned job UUID.
     */
    startChat: (model_id, message, system_prompt) => _fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id, message, system_prompt }),
    }),

    /**
     * Clear the in-memory chat session.
     *
     * @returns {Promise<{status: string}>}
     */
    clearChat: () => _fetch('/api/chat', { method: 'DELETE' }),

    /**
     * Fetch the current chat history (list of role/content objects).
     *
     * @returns {Promise<Array<{role: string, content: string}>>}
     */
    getChatHistory: () => _fetch('/api/chat/history'),

    /**
     * Fetch the curated model catalogue with local disk status per entry.
     *
     * @returns {Promise<Array>} Each entry includes id, label, type, status,
     *   size_gb, compression_options, notes, etc.
     */
    fetchCatalogue: () => _fetch('/api/catalogue'),

    /**
     * Start a background download + OpenVINO conversion job.
     *
     * @param {string} catalogueId  - Entry id from the catalogue.
     * @param {string} compression  - "int8" or "int4".
     * @returns {Promise<{job_id: string}>} The assigned job UUID.
     */
    startModelDownload: (catalogueId, compression, hfToken = '', variant = 'openvino') => _fetch('/api/catalogue/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogue_id: catalogueId, compression, hf_token: hfToken, variant }),
    }),

    /**
     * Upload an audio file for ASR transcription with the selected model.
     * Returns a job UUID; stream result via {@link API.streamJob}.
     *
     * @param {File}   file     - Audio file from a file input or drop event.
     * @param {string} modelId  - ASR model registry key.
     * @returns {Promise<{job_id: string}>}
     */
    startTranscription: (file, modelId) => {
      const fd = new FormData();
      fd.append('audio', file);
      fd.append('model_id', modelId);
      return _fetch('/api/transcription/file', { method: 'POST', body: fd });
    },

    /**
     * Transcribe one of the curated benchmark audio samples.
     *
     * @param {string} modelId    - ASR model registry key.
     * @param {string} audioPath  - Relative path from /api/audio/samples (e.g. data/benchmark/…/sample_00.wav).
     * @returns {Promise<{job_id: string}>}
     */
    startTranscriptionSample: (modelId, audioPath) => _fetch('/api/transcription/sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, audio_path: audioPath }),
    }),
  });
})();
