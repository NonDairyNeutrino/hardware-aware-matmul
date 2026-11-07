// Timing short operations on a coarse clock. A page that is not cross-origin isolated gets a
// `performance.now()` rounded to about a millisecond, so a multiplication that takes 0.1 ms would
// read as 0. The cure is the usual one: time a BATCH of runs, long enough that the clock's
// rounding is a small share of it, and divide. Pure functions: the clock and the operation are
// passed in, so they can be tested with a fake clock.

/**
 * How many runs to put in one timed sample so that a sample lasts at least `targetMs` by the
 * clock `now` (milliseconds). It doubles (or jumps by what it measured) until it gets there, up
 * to `maxBatch`. Slow operations return 1.
 */
export function chooseBatch(run, now, { targetMs = 30, maxBatch = 4096 } = {}) {
  let batch = 1;
  for (;;) {
    const started = now();
    for (let i = 0; i < batch; i += 1) run();
    const elapsed = now() - started;
    if (elapsed >= targetMs || batch >= maxBatch) return batch;
    // A coarse clock may still read 0 here; then there is nothing to extrapolate from.
    const jump = elapsed > 0 ? Math.ceil((batch * targetMs) / elapsed) : batch * 8;
    batch = Math.min(maxBatch, Math.max(batch * 2, jump));
  }
}

/** The mean time of one run, from timing `batch` runs together. */
export function timeSample(run, now, batch) {
  const started = now();
  for (let i = 0; i < batch; i += 1) run();
  return (now() - started) / batch;
}
