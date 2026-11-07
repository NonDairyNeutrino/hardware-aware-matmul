// What a playground run may ask for, and how long it may take. Pure functions: the page
// and the worker both clamp every request with `clampRequest`, so nothing the page sends (or
// a hand-edited URL asks for) can make the worker do something unbounded.

/** The limits of a run. The sizes are powers of two; at most 5 repeats. */
export const LIMITS = {
  sizes: [64, 128, 256, 512, 1024],
  maxThreads: 8,
  repeats: [1, 3, 5],
  maxBlock: 1024, // cache block and level 4 tile edges
  levels: [0, 1, 2, 3, 4],
};

/** What the controls start at. */
export const DEFAULTS = {
  n: 256,
  levels: [0, 1, 2, 3, 4],
  threads: 4,
  repeats: 3,
  block: [32, 64], // k, j: the crate's defaults
  tile: [128, 128, 128], // level 4 output tile: rows, columns, depth
};

const whole = (value, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? number : fallback;
};
const within = (value, low, high, fallback) => Math.min(high, Math.max(low, whole(value, fallback)));
const nearest = (value, allowed, fallback) => {
  const number = whole(value, fallback);
  return allowed.reduce((best, candidate) => (Math.abs(candidate - number) < Math.abs(best - number) ? candidate : best));
};

/**
 * A request that is always valid, whatever `raw` held. `pool` is the worker's thread pool size
 * (the threads control is the number of jobs over that pool); the lite build has no pool, so its
 * runs always use one thread.
 */
export function clampRequest(raw = {}, { pool = 1, build = 'lite' } = {}) {
  const maxThreads = build === 'threads' ? Math.max(1, Math.min(LIMITS.maxThreads, whole(pool, 1))) : 1;
  const wanted = Array.isArray(raw.levels) ? raw.levels.map((l) => whole(l, -1)) : DEFAULTS.levels;
  const levels = LIMITS.levels.filter((level) => wanted.includes(level));
  const block = Array.isArray(raw.block) ? raw.block : DEFAULTS.block;
  const tile = Array.isArray(raw.tile) ? raw.tile : DEFAULTS.tile;
  return {
    n: nearest(raw.n, LIMITS.sizes, DEFAULTS.n),
    levels: levels.length > 0 ? levels : [...DEFAULTS.levels],
    threads: within(raw.threads, 1, maxThreads, Math.min(DEFAULTS.threads, maxThreads)),
    repeats: nearest(raw.repeats, LIMITS.repeats, DEFAULTS.repeats),
    block: [0, 1].map((i) => within(block[i], 1, LIMITS.maxBlock, DEFAULTS.block[i])),
    tile: [0, 1, 2].map((i) => within(tile[i], 1, LIMITS.maxBlock, DEFAULTS.tile[i])),
  };
}

/**
 * Seconds one single-threaded multiplication of each level takes at n = 512 in the slowest build
 * measured (the reference run's browser, with generous rounding up). Time grows with n cubed.
 */
const SECONDS_AT_512 = { 0: 0.7, 1: 0.7, 2: 0.2, 3: 0.1, 4: 0.2 };

/**
 * How long a request may run before the page gives up and restarts the worker: the work at one
 * thread (an overestimate when threads help), repeated, plus a warm-up run per level, times a
 * safety factor of 4, plus 15 s for loading the module and starting the pool.
 */
export function timeoutMs(request) {
  const scale = (request.n / 512) ** 3;
  const perRepeat = request.levels.reduce((sum, level) => sum + SECONDS_AT_512[level] * scale, 0);
  const seconds = 4 * perRepeat * (request.repeats + 1) + 15;
  return Math.round(seconds * 1000);
}
