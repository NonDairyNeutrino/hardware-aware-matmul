// The benchmark matrix of the reference run, over the wasm bench API: for each size the
// operands are prepared once, then every level and thread count is warmed up and timed
// `repeats` times with `performance.now()` around the multiplication alone. The result's
// hash is read afterwards, outside the timer.
// The cache blocks (32, 64) and the level 4 tile (128 x 128 x 128) are fixed, like the
// native bench example's.
export function runBench(api, { sizes, threads, repeats, warmup }) {
  const runs = [];
  for (const n of sizes) {
    api.bench_prepare(n);
    for (let level = 0; level <= 4; level += 1) {
      // Level 0 is single-threaded whatever the setting.
      for (const t of level === 0 ? [1] : threads) {
        const run = () => api.bench_multiply(level, t, 32, 64, 128, 128, 128);
        for (let i = 0; i < warmup; i += 1) run();
        const times = [];
        for (let i = 0; i < repeats; i += 1) {
          const started = performance.now();
          run();
          times.push(Number((performance.now() - started).toFixed(4)));
        }
        runs.push({ level, n, threads: t, times_ms: times, hash: api.bench_hash() });
      }
    }
  }
  return runs;
}
