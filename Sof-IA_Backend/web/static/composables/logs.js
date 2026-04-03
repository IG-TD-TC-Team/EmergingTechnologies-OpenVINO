/**
 * @fileoverview LogsStore — reactive state for the Logs tab.
 *
 * Fetches log entries from GET /api/logs and supports auto-refresh every 5s.
 *
 * @module composables/logs
 */

class LogsStore {
  constructor() {
    /**
     * Log records returned by the server, newest first.
     * Each entry is a parsed JSON object from logs/app.json.
     * @type {Ref} Array of log record objects.
     */
    this.records = ref([]);

    /**
     * Active level filter. Empty string means no filter.
     * @type {Ref<string>}
     */
    this.levelFilter = ref('');

    /**
     * True while a fetch is in progress.
     * @type {Ref<boolean>}
     */
    this.loading = ref(false);

    /** @private */
    this._timer = null;
  }

  /**
   * Fetch the latest log entries from the server.
   * Applies the current levelFilter if set.
   *
   * @returns {Promise<void>}
   */
  async fetch() {
    this.loading.value = true;
    try {
      const qs = this.levelFilter.value
        ? `?n=200&level=${encodeURIComponent(this.levelFilter.value)}`
        : '?n=200';
      this.records.value = await API.getLogs(qs);
    } catch (e) {
      console.error('LogsStore.fetch', e);
    } finally {
      this.loading.value = false;
    }
  }

  /**
   * Start polling for new log entries every 5 seconds.
   * Performs an immediate fetch first.
   */
  startAutoRefresh() {
    this.fetch();
    if (this._timer) return;
    this._timer = setInterval(() => this.fetch(), 5000);
  }

  /**
   * Stop the auto-refresh polling timer.
   */
  stopAutoRefresh() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
