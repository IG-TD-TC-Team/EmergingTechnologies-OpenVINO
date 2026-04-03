/**
 * @fileoverview ChartStore — Chart.js instance lifecycle management.
 *
 * @module composables/chart
 */

/**
 * Encapsulates the Chart.js bar chart that visualises latency for two compared runs.
 *
 * Keeps both the canvas template ref and the Chart instance internal,
 * so no other part of the application needs to interact with Chart.js directly.
 * The previous chart is always destroyed before creating a new one to prevent
 * canvas memory leaks.
 */
class ChartStore {
  /**
   * Creates a ChartStore with a null canvas ref and no active chart instance.
   */
  constructor() {
    /**
     * Template ref bound to the `<canvas>` element in the Chart tab.
     * @type {Ref} Holds an `HTMLCanvasElement` or `null`.
     */
    this.chartCanvas = ref(null);

    /**
     * Active Chart.js instance. `null` before the first render.
     * @type {Chart|null}
     * @private
     */
    this._instance = null;
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  /**
   * Render (or re-render) the latency comparison bar chart.
   *
   * Waits for the next DOM tick before accessing the canvas so it is safe
   * to call immediately after a tab switch. Does nothing if the canvas ref
   * is not yet mounted or if either result is absent.
   *
   * @param {{a: BenchmarkResult|null, b: BenchmarkResult|null}} compareResults
   *   The two loaded results to visualise.
   * @returns {Promise<void>}
   */
  async render(compareResults) {
    await nextTick();
    if (!this.chartCanvas.value) return;

    const { a, b } = compareResults;
    if (!a || !b) return;

    const labels = ['Mean (ms)', 'p50 (ms)', 'p95 (ms)'];
    const dataA  = [
      a.metrics?.latency?.mean_ms ?? 0,
      a.metrics?.latency?.p50_ms  ?? 0,
      a.metrics?.latency?.p95_ms  ?? 0,
    ];
    const dataB  = [
      b.metrics?.latency?.mean_ms ?? 0,
      b.metrics?.latency?.p50_ms  ?? 0,
      b.metrics?.latency?.p95_ms  ?? 0,
    ];

    this._destroy();
    this._instance = new Chart(this.chartCanvas.value, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: a.model_id + ' (A)', data: dataA, backgroundColor: '#3b82f6' },
          { label: b.model_id + ' (B)', data: dataB, backgroundColor: '#f59e0b' },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#64748b' }, grid: { color: '#334155' } },
        },
      },
    });
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  /**
   * Destroy the current Chart.js instance and release the canvas.
   * Safe to call when `_instance` is already `null`.
   *
   * @private
   */
  _destroy() {
    if (this._instance) {
      this._instance.destroy();
      this._instance = null;
    }
  }
}
