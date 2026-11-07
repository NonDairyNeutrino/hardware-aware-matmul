// Turns the results a run streams back into the rows the page shows: median time, throughput,
// speedups, bar lengths, and the "same answer" verdict. Pure functions.

/** The median of a non-empty list of numbers. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * `results` is `[{ level, times_ms: [...], hash }]` in the order the levels ran. Returns one row
 * per level and the verdict. `vsNaive` is the speedup over level 0 if level 0 was run, else null;
 * `vsPrevious` is the speedup over the previous level that was run (null for the first).
 * `bar` is the median as a fraction of the slowest median (so the slowest bar is full length).
 */
export function summarise(results, n) {
  const medians = results.map((r) => median(r.times_ms));
  const slowest = Math.max(...medians, 0);
  const naive = results.findIndex((r) => r.level === 0);
  // A time of zero (a clock too coarse for the run) has no throughput or speedup: never show
  // Infinity or NaN.
  const ratio = (a, b) => (a > 0 && b > 0 ? a / b : null);
  const rows = results.map((r, i) => ({
    level: r.level,
    median_ms: medians[i],
    timed: medians[i] > 0,
    min_ms: Math.min(...r.times_ms),
    max_ms: Math.max(...r.times_ms),
    batch: r.batch ?? 1,
    gflops: medians[i] > 0 ? (2 * n ** 3) / (medians[i] / 1000) / 1e9 : null,
    vsNaive: naive >= 0 ? ratio(medians[naive], medians[i]) : null,
    vsPrevious: i > 0 ? ratio(medians[i - 1], medians[i]) : null,
    bar: slowest > 0 ? medians[i] / slowest : 0,
    hash: r.hash,
  }));
  const hashes = new Set(results.map((r) => r.hash));
  return { rows, sameAnswer: results.length > 0 && hashes.size === 1, hash: hashes.size === 1 ? [...hashes][0] : null };
}

/** The reference run's hash for size `n` (from results.json), or null if it has none. */
export function referenceHash(referenceRuns, n) {
  const run = referenceRuns.find((r) => r.n === n);
  return run ? run.hash : null;
}

/** Plain-language verdict for the "same answer" indicator. */
export function verdict(summary, reference) {
  if (summary.rows.length === 0) return { ok: false, text: 'No results yet.' };
  if (!summary.sameAnswer) return { ok: false, text: 'The levels gave DIFFERENT answers. That should never happen: please report it.' };
  const many = summary.rows.length > 1;
  const base = many ? `All ${summary.rows.length} levels gave the same answer, bit for bit (hash ${summary.hash}).` : `Result hash ${summary.hash}.`;
  if (reference === null) return { ok: true, text: base };
  return summary.hash === reference
    ? { ok: true, text: `${base} It matches the reference run's result for this size.` }
    : { ok: false, text: `${base} But it differs from the reference run's result for this size, which should never happen: please report it.` };
}
