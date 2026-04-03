/**
 * @fileoverview ModelsStore — reactive state for models, standard inputs,
 * and audio samples.
 *
 * @module composables/models
 */

/**
 * Manages the model registry, standard benchmark inputs, audio sample catalogue,
 * and badge helper utilities used by the template.
 *
 * State is initialised empty and populated by calling {@link ModelsStore#init}.
 */
class ModelsStore {
  /**
   * Creates a ModelsStore instance with empty reactive state.
   * Call {@link ModelsStore#init} inside `onMounted` to load data.
   */
  constructor() {
    /** @type {Ref} Reactive array of {@link ModelMeta} — enabled and disabled models. */
    this.models = ref([]);

    /**
     * @type {Ref} Reactive {@link StandardInputs} object.
     * Populated from `/api/benchmark/inputs`.
     */
    this.standardInputs = ref({ slm_prompt: '', asr_audio_path: '', asr_reference: '' });

    /** @type {Ref} Reactive array of {@link AudioSample} — available ASR audio samples. */
    this.audioSamples = ref([]);

    /**
     * Audio samples grouped by BCP-47 language code.
     * Derived automatically from {@link ModelsStore#audioSamples}.
     *
     * @type {ComputedRef} Keys are language codes; values are {@link AudioSample} arrays.
     */
    this.audioSamplesByLang = computed(() => {
      const groups = {};
      for (const s of this.audioSamples.value) {
        const lang = s.language || 'unknown';
        if (!groups[lang]) groups[lang] = [];
        groups[lang].push(s);
      }
      return groups;
    });
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  /**
   * Return the CSS badge class for a given model ID.
   *
   * @param {string} modelId - Model registry key.
   * @returns {string} `"badge-slm"`, `"badge-asr"`, or `""` if not found.
   */
  modelTypeClass(modelId) {
    const m = this.models.value.find(x => x.id === modelId);
    return m?.type === 'slm' ? 'badge-slm' : m?.type === 'asr' ? 'badge-asr' : '';
  }

  /**
   * Return the uppercased type label for a given model ID.
   *
   * @param {string} modelId - Model registry key.
   * @returns {string} `"SLM"`, `"ASR"`, or `"?"` if not found.
   */
  modelTypeLetter(modelId) {
    const m = this.models.value.find(x => x.id === modelId);
    return m?.type?.toUpperCase() ?? '?';
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  /**
   * Load all remote data in parallel: models, standard inputs, audio samples.
   * Populates the reactive properties on this instance.
   * Errors are caught and logged — the store remains in its last valid state.
   *
   * @returns {Promise<void>}
   */
  async init() {
    try {
      const [models, standardInputs, audioSamples] = await Promise.all([
        API.getModels(),
        API.getStandardInputs(),
        API.getAudioSamples(),
      ]);
      this.models.value         = models;
      this.standardInputs.value = standardInputs;
      this.audioSamples.value   = audioSamples;
    } catch (e) {
      console.error('ModelsStore.init', e);
    }
  }
}
