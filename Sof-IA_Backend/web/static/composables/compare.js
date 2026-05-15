/**
 * @fileoverview CompareStore — reactive state for the A/B comparison view.
 *
 * @module composables/compare
 */

/**
 * @typedef {Object} CompareRow
 * @property {string}  label        - Metric name, e.g. `"Mean latency"`.
 * @property {string}  a            - Formatted value for run A, e.g. `"123.4 ms"`.
 * @property {string}  b            - Formatted value for run B.
 * @property {boolean} winnerA      - `true` if run A has the better (lower) value.
 * @property {boolean} winnerB      - `true` if run B has the better (lower) value.
 * @property {string}  speedup      - Human-readable delta, e.g. `"1.5x faster"`.
 * @property {string}  speedupColor - CSS class: `"win"`, `"lose"`, or `""`.
 */

/**
 * Manages the selection of two past runs for side-by-side comparison
 * and derives the comparison table rows automatically.
 *
 * The `compareRows` computed ref is recalculated whenever `compareResults`
 * changes — no manual refresh needed.
 */
class CompareStore {
  /**
   * Creates a CompareStore with empty selection and no loaded results.
   */
  constructor() {
    /** @type {Ref} Result ID string selected for run A. */
    this.compareA = ref('');

    /** @type {Ref} Result ID string selected for run B. */
    this.compareB = ref('');

    /**
     * The two loaded result objects after calling {@link CompareStore#load}.
     *
     * @type {Ref} Object with shape `{a: BenchmarkResult|null, b: BenchmarkResult|null}`.
     */
    this.compareResults = ref({ a: null, b: null });

    /**
     * Comparison table rows derived from `compareResults`.
     * Returns an empty array until both `a` and `b` are loaded.
     *
     * @type {ComputedRef} Array of {@link CompareRow} objects.
     */
    this.compareRows = computed(() => this._buildRows());
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  /**
   * Fetch both selected results in parallel and store them in `compareResults`.
   * Requires both {@link CompareStore#compareA} and {@link CompareStore#compareB}
   * to be set before calling.
   * Errors are caught and logged — `compareResults` is not modified on failure.
   *
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const [a, b] = await Promise.all([
        API.getResult(this.compareA.value),
        API.getResult(this.compareB.value),
      ]);
      this.compareResults.value = { a, b };
    } catch (e) {
      console.error('CompareStore.load', e);
    }
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  /**
   * Build the comparison table rows from the currently loaded results.
   * Called automatically by the `compareRows` computed ref.
   * Lower values are considered better for all numeric metrics.
   *
   * @returns {CompareRow[]} Rows ready for rendering. Empty if either result is absent.
   * @private
   */
  _buildRows() {
    const { a, b } = this.compareResults.value;
    if (!a || !b) return [];

    const rows = [];

    /**
     * Append a numeric metric row, computing winner and speedup string.
     *
     * @param {string}      label          - Display label.
     * @param {number|null} valA           - Metric value for run A.
     * @param {number|null} valB           - Metric value for run B.
     * @param {string}      [unit='ms']    - Unit suffix for display.
     * @param {boolean}     [lowerIsBetter=true] - If `false`, higher values win (e.g. tokens/sec).
     * @param {number}      [decimals=1]   - Decimal places for formatted values.
     */
    const _addRow = (label, valA, valB, unit = 'ms', lowerIsBetter = true, decimals = 1) => {
      if (valA == null || valB == null) return;
      const winnerA = lowerIsBetter ? valA < valB : valA > valB;
      const winnerB = lowerIsBetter ? valB < valA : valB > valA;
      // ratio > 1 → A is better; ratio < 1 → B is better
      const denomA = lowerIsBetter ? valA : valB;
      const numerA = lowerIsBetter ? valB : valA;
      const ratio  = denomA > 0 ? numerA / denomA : null;
      const speedupStr = ratio == null ? '—'
        : ratio > 1 ? `${ratio.toFixed(2)}x faster`
        : ratio < 1 ? `${(1 / ratio).toFixed(2)}x slower`
        : 'equal';
      rows.push({
        label,
        a:            `${valA.toFixed(decimals)} ${unit}`,
        b:            `${valB.toFixed(decimals)} ${unit}`,
        winnerA,      winnerB,
        speedup:      speedupStr,
        speedupColor: winnerA ? 'win' : winnerB ? 'lose' : '',
      });
    };

    const la = a.metrics?.latency,         lb  = b.metrics?.latency;
    if (la && lb) {
      _addRow('Mean latency', la.mean_ms, lb.mean_ms);
      _addRow('p50 latency',  la.p50_ms,  lb.p50_ms);
      _addRow('p95 latency',  la.p95_ms,  lb.p95_ms);
    }

    const ta = a.metrics?.ms_per_token,    tb  = b.metrics?.ms_per_token;
    if (ta && tb) {
      _addRow('Mean ms/token',   ta.mean_ms_per_token,  tb.mean_ms_per_token,  'ms',    true,  2);
      _addRow('Mean tokens/sec', ta.mean_tokens_per_sec, tb.mean_tokens_per_sec, 'tok/s', false, 2);
    }

    const ra = a.metrics?.rtf,             rb  = b.metrics?.rtf;
    if (ra != null && rb != null) _addRow('Real-Time Factor (RTF)', ra, rb, '', true, 3);

    const wa2 = a.metrics?.words_per_sec,  wb2 = b.metrics?.words_per_sec;
    if (wa2 != null && wb2 != null) _addRow('Words per second', wa2, wb2, 'w/s', false, 2);

    const wa = a.metrics?.wer,             wb  = b.metrics?.wer;
    if (wa != null && wb != null) {
      const waP = wa * 100, wbP = wb * 100, diff = waP - wbP;
      rows.push({
        label:        'WER',
        a:            `${waP.toFixed(1)}%`,
        b:            `${wbP.toFixed(1)}%`,
        winnerA:      waP < wbP,
        winnerB:      wbP < waP,
        speedup:      diff === 0 ? 'equal' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)} pp`,
        speedupColor: diff < 0 ? 'win' : diff > 0 ? 'lose' : '',
      });
    }

    return rows;
  }
}
