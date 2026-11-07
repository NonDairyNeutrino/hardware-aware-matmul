// The benchmark matrix of the reference run, over the wasm bench API: a warm-up pass
// first (every level and thread count once on a small matrix, untimed, so the first timed
// case does not pay for cold-module costs such as wasm tier-up and starting the pool),
// then for each size the operands are prepared once and every level and thread count is
// warmed up and timed `repeats` times with `performance.now()` around the multiplication
// alone. The result's hash is read after every repeat, outside the timer, and a repeat
// that differs from the first is an error.
// The cache blocks and the level 5 tile are fixed, like the native bench example's; the
// workers report them in their parameters.
export const BLOCK = [32, 64];
export const TILE = [128, 128, 128];

export function runBench(api, { sizes, threads, repeats, warmup }) {
  const multiply = (level, t) => api.bench_multiply(level, t, BLOCK[0], BLOCK[1], TILE[0], TILE[1], TILE[2]);
  // Level 0 is single-threaded whatever the setting.
  const countsFor = (level) => (level === 0 ? [1] : threads);
  api.bench_prepare(Math.min(Math.min(...sizes), 128));
  for (let level = 0; level <= 5; level += 1) {
    for (const t of countsFor(level)) multiply(level, t);
  }
  const runs = [];
  for (const n of sizes) {
    api.bench_prepare(n);
    for (let level = 0; level <= 5; level += 1) {
      for (const t of countsFor(level)) {
        for (let i = 0; i < warmup; i += 1) multiply(level, t);
        const times = [];
        let hash = null;
        for (let i = 0; i < repeats; i += 1) {
          const started = performance.now();
          multiply(level, t);
          times.push(Number((performance.now() - started).toFixed(4)));
          const got = api.bench_hash();
          if (hash === null) hash = got;
          else if (got !== hash) {
            throw new Error(`level ${level} n ${n} threads ${t}: a repeat gave hash ${got}, the first gave ${hash}`);
          }
        }
        runs.push({ level, n, threads: t, times_ms: times, hash });
      }
    }
  }
  return runs;
}
