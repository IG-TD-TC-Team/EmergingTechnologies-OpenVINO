/**
 * @fileoverview ChatStore — reactive state for the chat interface.
 *
 * Manages the in-memory conversation, model selection, system prompt,
 * and the streaming SSE connection for token-by-token SLM output.
 */

class ChatStore {
  constructor(slmModels) {
    /** @type {import('vue').Ref<Array<{role:string,content:string,metrics?:string}>>} */
    this.messages = Vue.ref([]);

    /** @type {import('vue').Ref<string>} Currently streamed assistant output */
    this.streamingText = Vue.ref('');

    /** @type {import('vue').Ref<boolean>} True while a generation is in flight */
    this.busy = Vue.ref(false);

    /** @type {import('vue').Ref<string>} User's current input */
    this.input = Vue.ref('');

    /** @type {import('vue').Ref<string>} Editable system prompt */
    this.systemPrompt = Vue.ref('You are a helpful clinical AI assistant.');

    /** @type {import('vue').Ref<string>} Selected SLM model ID */
    this.modelId = Vue.ref(slmModels.length ? slmModels[0].id : '');

    /** @type {import('vue').Ref<string|null>} Error message, null when none */
    this.error = Vue.ref(null);

    /** @private EventSource connection, closed after each generation */
    this._sse = null;
  }

  /**
   * Send the current input as a user message and stream the assistant reply.
   */
  async send() {
    const text = this.input.value.trim();
    if (!text || this.busy.value) return;

    this.error.value = null;
    this.input.value = '';
    this.busy.value = true;
    this.streamingText.value = '';

    // Optimistically show user bubble
    this.messages.value.push({ role: 'user', content: text });

    let jobId;
    try {
      const res = await API.startChat(this.modelId.value, text, this.systemPrompt.value);
      jobId = res.job_id;
    } catch (err) {
      this.error.value = `Failed to start chat: ${err.message}`;
      this.busy.value = false;
      return;
    }

    // Streaming placeholder for assistant reply
    const assistantIndex = this.messages.value.length;
    this.messages.value.push({ role: 'assistant', content: '', streaming: true });

    const startTime = performance.now();
    let tokenCount = 0;
    let firstTokenMs = null;

    this._sse = API.streamJob(jobId);

    this._sse.onmessage = (evt) => {
      let event;
      try { event = JSON.parse(evt.data); } catch { return; }

      if (event.type === 'token') {
        if (firstTokenMs === null) firstTokenMs = performance.now() - startTime;
        tokenCount++;
        this.streamingText.value += event.token;
        this.messages.value[assistantIndex].content = this.streamingText.value;
      } else if (event.type === 'done') {
        const totalMs = performance.now() - startTime;
        const tokSec = tokenCount > 0 ? (tokenCount / (totalMs / 1000)).toFixed(1) : '—';
        const ttft = firstTokenMs !== null ? firstTokenMs.toFixed(0) : '—';
        this.messages.value[assistantIndex].streaming = false;
        this.messages.value[assistantIndex].metrics =
          `${tokSec} tok/s · TTFT ${ttft} ms · ${tokenCount} tokens`;
        this._cleanup();
      } else if (event.type === 'error') {
        this.error.value = event.message || 'Unknown streaming error';
        this.messages.value[assistantIndex].streaming = false;
        this._cleanup();
      }
    };

    this._sse.onerror = () => {
      this.error.value = 'SSE connection lost.';
      if (this.messages.value[assistantIndex]) {
        this.messages.value[assistantIndex].streaming = false;
      }
      this._cleanup();
    };
  }

  /** Clear the conversation both locally and on the server. */
  async clear() {
    this._cleanup();
    this.messages.value = [];
    this.streamingText.value = '';
    this.error.value = null;
    try {
      await API.clearChat();
    } catch (err) {
      this.error.value = `Failed to clear session: ${err.message}`;
    }
  }

  /** @private Close SSE and reset busy flag. */
  _cleanup() {
    if (this._sse) { this._sse.close(); this._sse = null; }
    this.busy.value = false;
    this.streamingText.value = '';
  }
}