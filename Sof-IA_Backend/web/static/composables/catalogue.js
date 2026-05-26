/**
 * @fileoverview CatalogueStore — manages the curated model catalogue,
 * local disk status, and the active download/conversion job.
 *
 * Follows the same class-based singleton pattern as other stores.
 */

class CatalogueStore {
  constructor() {
    /** @type {Ref<Array>} All catalogue entries merged with disk status. */
    this.entries = ref([]);

    /** @type {Ref<boolean>} True while the catalogue is being fetched. */
    this.loading = ref(false);

    /** @type {Ref<string>} Active type filter: "all" | "asr" | "slm" */
    this.typeFilter = ref('all');

    /** @type {Ref<string>} Optional HuggingFace token for gated models. */
    this.hfToken = ref('');

    /**
     * Entries filtered by typeFilter, with on-disk models sorted first.
     * @type {ComputedRef<Array>}
     */
    this.filteredEntries = computed(() => {
      const all = this.entries.value;
      const filtered = this.typeFilter.value === 'all'
        ? all
        : all.filter(e => e.type === this.typeFilter.value);
      return [...filtered].sort((a, b) => {
        const rank = e => (e.status === 'downloaded_ov' ? 0 : e.status === 'downloading' ? 1 : 2);
        return rank(a) - rank(b);
      });
    });

    /** @type {Ref<Object>} Compression selected per entry id. */
    this._selectedCompression = ref({});

    /** @type {Ref<string|null>} job_id of the active download job. */
    this.activeJobId = ref(null);

    /** @type {Ref<string|null>} catalogue_id being downloaded. */
    this.activeEntryId = ref(null);

    /** @type {Ref<string>} "openvino" | "pytorch" — which variant is downloading. */
    this.activeVariant = ref('openvino');

    /** @type {Ref<string[]>} Live log lines from the conversion job. */
    this.jobLog = ref([]);

    /** @type {Ref<number>} Progress 0–100. */
    this.jobProgress = ref(0);

    /** @type {Ref<string|null>} Error message if the job failed. */
    this.jobError = ref(null);

    /** @type {Ref<boolean>} True when the failure is a HuggingFace gated-model 401. */
    this.jobIsGated = ref(false);

    /** @type {Ref<Object|null>} Last catalogue entry that was downloaded (kept after job ends). */
    this.lastActiveEntry = ref(null);

    /** @type {Ref<HTMLElement|null>} Log scroll container (template ref). */
    this.logEl = ref(null);

    /** @type {EventSource|null} */
    this._es = null;

    /**
     * Optional callback invoked (with no arguments) when a download job
     * completes successfully.  Set by `app.js` to trigger a model-list
     * refresh so newly downloaded models appear in the Benchmark and Chat
     * dropdowns without requiring a manual page reload.
     *
     * @type {Function|null}
     */
    this.onDownloadComplete = null;
  }

  /** Fetch the catalogue from the server and populate this.entries. */
  async fetch() {
    this.loading.value = true;
    try {
      this.entries.value = await API.fetchCatalogue();
    } catch (e) {
      console.error('CatalogueStore.fetch failed', e);
    } finally {
      this.loading.value = false;
    }
  }

  /**
   * Return the selected compression for a catalogue entry (defaults to
   * the entry's default_compression).
   */
  compressionFor(entry) {
    return this._selectedCompression.value[entry.id] ?? entry.default_compression;
  }

  setCompression(entryId, value) {
    this._selectedCompression.value = { ...this._selectedCompression.value, [entryId]: value };
  }

  /**
   * Start a download job for the given catalogue entry.
   *
   * @param {string} catalogueId
   * @param {string} compression  "int8" or "int4"
   * @param {string} variant      "openvino" | "pytorch"
   */
  async startDownload(catalogueId, compression, variant = 'openvino') {
    if (this.activeJobId.value) return;

    this.activeEntryId.value = catalogueId;
    this.activeVariant.value = variant;
    this.jobLog.value = [];
    this.jobProgress.value = 0;
    this.jobError.value = null;
    this.jobIsGated.value = false;
    this.lastActiveEntry.value = this.entries.value.find(e => e.id === catalogueId) || null;

    if (variant === 'pytorch') {
      this._setEntryPytorchStatus(catalogueId, 'downloading');
    } else {
      this._setEntryStatus(catalogueId, 'downloading');
    }

    try {
      const { job_id } = await API.startModelDownload(catalogueId, compression, this.hfToken.value, variant);
      this.activeJobId.value = job_id;
      this._handleStream(job_id, catalogueId, variant);
    } catch (e) {
      if (variant === 'pytorch') {
        this._setEntryPytorchStatus(catalogueId, 'available');
      } else {
        this._setEntryStatus(catalogueId, 'available');
      }
      this.jobError.value = String(e);
      this.activeJobId.value = null;
      this.activeEntryId.value = null;
    }
  }

  _handleStream(jobId, catalogueId, variant = 'openvino') {
    if (this._es) { this._es.close(); this._es = null; }

    const es = API.streamJob(jobId);
    this._es = es;

    es.onmessage = (evt) => {
      let event;
      try { event = JSON.parse(evt.data); } catch { return; }

      if (event.type === 'progress') {
        this.jobLog.value = [...this.jobLog.value, event.message];
        this.jobProgress.value = Math.min(95, this.jobProgress.value + 3);
        nextTick(() => {
          if (this.logEl.value) this.logEl.value.scrollTop = this.logEl.value.scrollHeight;
        });
      } else if (event.type === 'done') {
        this.jobProgress.value = 100;
        const doneMsg = variant === 'pytorch' ? 'PyTorch download complete.' : 'Download and conversion complete.';
        this.jobLog.value = [...this.jobLog.value, doneMsg];
        if (variant === 'pytorch') {
          this._setEntryPytorchStatus(catalogueId, 'downloaded');
        } else {
          this._setEntryStatus(catalogueId, 'downloaded_ov');
        }
        es.close();
        this._es = null;
        this.activeJobId.value = null;
        this.activeEntryId.value = null;
        // Notify app.js to refresh the model list so the new model appears
        // in the Benchmark and Chat dropdowns without a manual page reload.
        if (this.onDownloadComplete) this.onDownloadComplete();
      } else if (event.type === 'error') {
        const raw = event.message || '';
        this.jobIsGated.value = raw.startsWith('GATED_MODEL:') || /gated|401|restricted/i.test(raw);
        this.jobError.value = raw.replace(/^GATED_MODEL:[^\n]*\n/, '');
        this.jobLog.value = [...this.jobLog.value, `Error: ${this.jobError.value}`];
        if (variant === 'pytorch') {
          this._setEntryPytorchStatus(catalogueId, 'available');
        } else {
          this._setEntryStatus(catalogueId, 'available');
        }
        es.close();
        this._es = null;
        this.activeJobId.value = null;
        this.activeEntryId.value = null;
      }
    };

    es.onerror = () => {
      es.close();
      this._es = null;
      if (this.jobProgress.value < 100) {
        this.jobError.value = 'Connection lost. Check server logs.';
        if (variant === 'pytorch') {
          this._setEntryPytorchStatus(catalogueId, 'available');
        } else {
          this._setEntryStatus(catalogueId, 'available');
        }
        this.activeJobId.value = null;
        this.activeEntryId.value = null;
      }
    };
  }

  _setEntryStatus(catalogueId, status) {
    this.entries.value = this.entries.value.map(e =>
      e.id === catalogueId ? { ...e, status } : e
    );
  }

  _setEntryPytorchStatus(catalogueId, pytorch_status) {
    this.entries.value = this.entries.value.map(e =>
      e.id === catalogueId ? { ...e, pytorch_status } : e
    );
  }
}
