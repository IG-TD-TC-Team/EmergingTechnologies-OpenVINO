/**
 * @fileoverview Root Vue 3 application — instantiates all stores and wires
 * cross-store reactions.
 *
 * Responsibilities of this file:
 * 1. Instantiate one instance of each store class.
 * 2. Define computed state that spans multiple stores.
 * 3. Wire cross-store side-effects via `watch` (the only place stores talk to each other).
 * 4. Define template helpers that need data from more than one store.
 * 5. Return a flat surface object consumed by `index.html`.
 *
 * @module app
 */

createApp({
  /**
   * Vue 3 Composition API setup function.
   * All reactive state, watchers, and lifecycle hooks are registered here.
   *
   * @returns {Object} Flat object of refs, computed values, and methods
   *   exposed to the HTML template.
   */
  setup() {
    // ------------------------------------------------------------------
    // Store instances
    // ------------------------------------------------------------------

    /** @type {ModelsStore} */
    const modelStore = new ModelsStore();

    /** @type {BenchmarkStore} */
    const benchmark  = new BenchmarkStore();

    /** @type {HistoryStore} */
    const histStore  = new HistoryStore();

    /** @type {CompareStore} */
    const compare    = new CompareStore();

    /** @type {ChartStore} */
    const chart      = new ChartStore();

    /** @type {LogsStore} */
    const logsStore  = new LogsStore();

    /** @type {CatalogueStore} */
    const catalogueStore = new CatalogueStore();

    /**
     * Currently active right-panel tab.
     * @type {Ref} One of `"results"`, `"compare"`, `"chart"`, or `"logs"`.
     */
    const tab = ref('results');

    /**
     * Top-level mode switch — `"benchmark"`, `"chat"`, or `"transcription"`.
     * @type {Ref<string>}
     */
    const mode = ref('benchmark');

    /**
     * SLM models available for the chat interface (enabled SLMs only).
     * @type {ComputedRef<ModelMeta[]>}
     */
    const slmModels = computed(() =>
      modelStore.models.value.filter(m => m.type === 'slm' && m.enabled)
    );

    /**
     * ASR models available for the transcription tab (enabled ASRs only).
     * @type {ComputedRef<ModelMeta[]>}
     */
    const asrModels = computed(() =>
      modelStore.models.value.filter(m => m.type === 'asr' && m.enabled)
    );

    /** @type {ChatStore} — instantiated after slmModels is defined */
    const chat = new ChatStore(slmModels.value);

    /** @type {TranscriptionStore} — instantiated after asrModels is defined */
    const asr = new TranscriptionStore(asrModels.value);

    /**
     * Update chat modelId when the enabled SLM list changes (e.g., after models load).
     */
    watch(slmModels, (models) => {
      if (models.length && !models.find(m => m.id === chat.modelId.value)) {
        chat.modelId.value = models[0].id;
      }
    });

    /**
     * Update asr modelId when the enabled ASR list changes (e.g., after models load).
     */
    watch(asrModels, (models) => {
      if (models.length && !models.find(m => m.id === asr.modelId.value)) {
        asr.modelId.value = models[0].id;
      }
    });

    /** Template ref for the chat messages container — used for auto-scroll. */
    const chatEl = ref(null);

    /** Template ref for the transcription runs container — used for auto-scroll. */
    const transcriptionEl = ref(null);

    // ------------------------------------------------------------------
    // Derived state spanning multiple stores
    // ------------------------------------------------------------------

    /**
     * The full ModelMeta object for the model currently selected in the form.
     * `null` when no model is selected or the list is still loading.
     *
     * @type {ComputedRef} Holds a {@link ModelMeta} or `null`.
     */
    const selectedModel = computed(() =>
      modelStore.models.value.find(m => m.id === benchmark.run.value.modelId) || null
    );

    // ------------------------------------------------------------------
    // Cross-store wiring — the only place inter-store reactions live
    // ------------------------------------------------------------------

    /**
     * When a benchmark completes, display the result in the Results tab
     * and refresh the history list.
     */
    watch(benchmark.lastResult, (result) => {
      if (!result) return;
      histStore.activeResult.value = result;
      tab.value = 'results';
      histStore.fetchHistory();
    });

    /**
     * When both compare results are loaded, automatically render the chart
     * so it is ready if the user switches to the Chart tab.
     */
    watch(
      () => compare.compareResults.value,
      (results) => { if (results.a && results.b) chart.render(results); },
      { deep: true }
    );

    /**
     * When the user switches to the Chart tab, re-render in case the canvas
     * element was not yet in the DOM when the data first loaded.
     * When switching to the Logs tab, start auto-refresh; stop it on leave.
     */
    watch(tab, (t, prev) => {
      if (t === 'chart') chart.render(compare.compareResults.value);
      if (t === 'logs') {
        logsStore.startAutoRefresh();
      } else if (prev === 'logs') {
        logsStore.stopAutoRefresh();
      }
    });

    /**
     * Auto-scroll the chat message list to the bottom whenever a new
     * message is added or the streaming content changes.
     */
    watch(
      () => [chat.messages.value.length, chat.streamingText.value],
      () => nextTick(() => {
        if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
      }),
      { deep: false }
    );

    /**
     * Auto-scroll the transcription runs list when a new run is added.
     */
    watch(
      () => asr.runs.value.length,
      () => nextTick(() => {
        if (transcriptionEl.value) transcriptionEl.value.scrollTop = transcriptionEl.value.scrollHeight;
      })
    );

    // ------------------------------------------------------------------
    // Template helpers — functions that read from more than one store
    // ------------------------------------------------------------------

    /**
     * Fill the prompt field with the standard SLM prompt from the server.
     */
    function useStandardPrompt() {
      benchmark.run.value.inputData = modelStore.standardInputs.value.slm_prompt;
    }

    /**
     * Handle a selection from the audio sample `<select>` element.
     * Fills both the audio path and the reference transcript fields.
     *
     * @param {Event} evt - The native `change` event from the `<select>`.
     */
    function onSampleSelect(evt) {
      const idx    = evt.target.value;
      if (idx === '') return;
      const sample = modelStore.audioSamples.value[idx];
      if (!sample) return;
      benchmark.run.value.inputData           = sample.file;
      benchmark.run.value.referenceTranscript = sample.reference;
    }

    /**
     * Format a numeric metric value to one decimal place.
     *
     * @param {number|null} v - The value to format.
     * @returns {string} Formatted string, or `"—"` when the value is absent.
     */
    function fmt(v) { return v != null ? v.toFixed(1) : '—'; }

    /**
     * Convert a compact timestamp string to a readable date-time string.
     *
     * @param {string} ts - Compact timestamp, e.g. `"20240101_120000"`.
     * @returns {string} Formatted string, e.g. `"2024-01-01 12:00"`, or `"—"`.
     */
    function formatTimestamp(ts) {
      if (!ts || ts.length < 15) return ts || '—';
      return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}`;
    }

    /** Delegate to ChatStore.send() */
    function sendChat() { chat.send(); }

    /** Delegate to ChatStore.clear() */
    function clearChat() { chat.clear(); }

    /** Delegate to TranscriptionStore.transcribe() */
    function sendTranscription() { asr.transcribe(); }

    /** Delegate to TranscriptionStore.clear() */
    function clearTranscription() { asr.clear(); }

    /** Set the selected sample from the dropdown index value. */
    function onTranscriptionSampleSelect(evt) {
      const idx = evt.target.value;
      if (idx === '') { asr.selectedSample.value = null; return; }
      asr.selectedSample.value = modelStore.audioSamples.value[idx] || null;
    }

    // ------------------------------------------------------------------
    // Initialisation
    // ------------------------------------------------------------------

    /**
     * On mount: load all remote data in parallel, then select the first
     * enabled model so the form is ready to use without manual interaction.
     */
    onMounted(async () => {
      await Promise.all([modelStore.init(), histStore.fetchHistory(), catalogueStore.fetch()]);
      const first = modelStore.models.value.find(m => m.enabled);
      if (first) benchmark.run.value.modelId = first.id;
    });

    // ------------------------------------------------------------------
    // Template surface
    // ------------------------------------------------------------------
    return {
      tab,
      mode,

      // --- chat ---
      chat,
      slmModels,
      chatEl,
      sendChat,
      clearChat,

      // --- asr transcription ---
      asr,
      asrModels,
      transcriptionEl,
      sendTranscription,
      clearTranscription,
      onTranscriptionSampleSelect,

      // --- modelStore ---
      models:             modelStore.models,
      standardInputs:     modelStore.standardInputs,
      audioSamples:       modelStore.audioSamples,
      audioSamplesByLang: modelStore.audioSamplesByLang,
      modelTypeClass:     (id) => modelStore.modelTypeClass(id),
      modelTypeLetter:    (id) => modelStore.modelTypeLetter(id),
      selectedModel,

      // --- benchmark ---
      run:              benchmark.run,
      logEl:            benchmark.logEl,
      startBenchmark:   () => benchmark.start(),
      onModelChange:    () => benchmark.onModelChange(),
      useStandardPrompt,
      onSampleSelect,

      // --- histStore ---
      history:      histStore.history,
      activeResult: histStore.activeResult,
      fetchHistory: () => histStore.fetchHistory(),
      loadResult:   (id) => histStore.loadResult(id),
      exportResult: () => histStore.exportResult(),

      // --- compare ---
      compareA:       compare.compareA,
      compareB:       compare.compareB,
      compareResults: compare.compareResults,
      compareRows:    compare.compareRows,
      loadCompare:    () => compare.load(),

      // --- chart ---
      chartCanvas: chart.chartCanvas,
      renderChart: () => chart.render(compare.compareResults.value),

      // --- logsStore ---
      logsStore,

      // --- catalogueStore ---
      catalogue:               catalogueStore.entries,
      catalogueFiltered:       catalogueStore.filteredEntries,
      catalogueLoading:        catalogueStore.loading,
      catalogueTypeFilter:     catalogueStore.typeFilter,
      activeDownloadId:        catalogueStore.activeJobId,
      activeDownloadEntryId:   catalogueStore.activeEntryId,
      activeDownloadVariant:   catalogueStore.activeVariant,
      catalogueJobLog:         catalogueStore.jobLog,
      catalogueJobProgress:    catalogueStore.jobProgress,
      catalogueJobError:       catalogueStore.jobError,
      catalogueJobIsGated:     catalogueStore.jobIsGated,
      catalogueLastEntry:      catalogueStore.lastActiveEntry,
      catalogueLogEl:          catalogueStore.logEl,
      compressionFor:          (entry) => catalogueStore.compressionFor(entry),
      setCatalogueCompression: (id, val) => catalogueStore.setCompression(id, val),
      downloadModel:           (id, compression, variant) => catalogueStore.startDownload(id, compression, variant),
      refreshCatalogue:        () => catalogueStore.fetch(),
      setCatalogueFilter:      (f) => { catalogueStore.typeFilter.value = f; },
      catalogueHfToken:        catalogueStore.hfToken,
      catalogueReadyCount:     computed(() => catalogueStore.entries.value.filter(e => e.status === 'downloaded_ov').length),

      // --- helpers ---
      fmt,
      formatTimestamp,
    };
  },
}).mount('#app');
