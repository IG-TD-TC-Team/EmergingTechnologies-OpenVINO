/**
 * @fileoverview HistoryStore — reactive state for past benchmark results.
 *
 * @module composables/history
 */

/**
 * Manages the list of past benchmark runs and the currently displayed result.
 * Also provides the JSON export action.
 *
 * The active result is written directly by `app.js` when a new benchmark
 * completes, in addition to being loaded on demand via {@link HistoryStore#loadResult}.
 */
class HistoryStore {
  /**
   * Creates a HistoryStore with empty history and no active result.
   */
  constructor() {
    /**
     * Metadata list for all past runs, newest first.
     * Each entry contains `id`, `timestamp`, and `model_id`.
     *
     * @type {Ref} Array of `{id, timestamp, model_id}` objects.
     */
    this.history = ref([]);

    /**
     * The full result object currently shown in the Results tab.
     * `null` when no run has been selected yet.
     *
     * @type {Ref} Holds a {@link BenchmarkResult} or `null`.
     */
    this.activeResult = ref(null);
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  /**
   * Refresh the history list from the server.
   * Errors are caught and logged — the existing list is preserved on failure.
   *
   * @returns {Promise<void>}
   */
  async fetchHistory() {
    try {
      this.history.value = await API.getResults();
    } catch (e) {
      console.error('HistoryStore.fetchHistory', e);
    }
  }

  /**
   * Load a single past result by ID and set it as the active result.
   * Errors are caught and logged — `activeResult` is not modified on failure.
   *
   * @param {string} id - Result ID, e.g. `"benchmark_20240101_120000"`.
   * @returns {Promise<void>}
   */
  async loadResult(id) {
    try {
      this.activeResult.value = await API.getResult(id);
    } catch (e) {
      console.error('HistoryStore.loadResult', e);
    }
  }

  /**
   * Trigger a browser download of the active result as a formatted JSON file.
   * Does nothing if no result is currently active.
   */
  exportResult() {
    if (!this.activeResult.value) return;
    const blob = new Blob(
      [JSON.stringify(this.activeResult.value, null, 2)],
      { type: 'application/json' }
    );
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${this.activeResult.value.result_id || 'result'}.json`;
    a.click();
  }
}
