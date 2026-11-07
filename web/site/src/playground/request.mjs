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
export function clampRequest(raw, { pool = 1, build = 'lite' } = {}) {
  raw = raw ?? {};
  const maxThreads = build === 'threads' ? Math.max(1, Math.min(LIMITS.maxThreads, whole(pool, 1))) : 1;
  const wanted = Array.isArray(raw.levels) ? raw.levels.map((l) => whole(l, -1)) : DEFAULTS.levels;
  const levels = LIMITS.levels.filter((level) => wanted.includes(level));
  const block = Array.isArray(raw.block) ? raw.block : DEFAULTS.block;
  const tile = Array.isArray(raw.tile) ? raw.tile : DEFAULTS.tile;
  return fitBudget({
    n: nearest(raw.n, LIMITS.sizes, DEFAULTS.n),
    levels: levels.length > 0 ? levels : [...DEFAULTS.levels],
    threads: within(raw.threads, 1, maxThreads, Math.min(DEFAULTS.threads, maxThreads)),
    repeats: nearest(raw.repeats, LIMITS.repeats, DEFAULTS.repeats),
    block: [0, 1].map((i) => within(block[i], 1, LIMITS.maxBlock, DEFAULTS.block[i])),
    tile: [0, 1, 2].map((i) => within(tile[i], 1, LIMITS.maxBlock, DEFAULTS.tile[i])),
  });
}

/**
 * The longest budget any request may get. The largest request with the default blocks and tiles
 * needs about 6.5 minutes; tiny blocks or tiles could need hours.
 */
export const MAX_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Grows the smallest cache-block or tile edge that the chosen levels use, doubling it, until the
 * request's budget fits under MAX_TIMEOUT_MS. Requests with sensible shapes are returned as they are.
 */
function fitBudget(request) {
  const edges = [
    ...(request.levels.some((level) => level === 2 || level === 3 || level === 4) ? [['block', 0], ['block', 1]] : []),
    ...(request.levels.includes(4) ? [['tile', 0], ['tile', 1], ['tile', 2]] : []),
  ];
  while (timeoutMs(request) > MAX_TIMEOUT_MS) {
    const growable = edges.filter(([field, i]) => request[field][i] < LIMITS.maxBlock);
    if (growable.length === 0) break;
    const [field, i] = growable.reduce((a, b) => (request[b[0]][b[1]] < request[a[0]][a[1]] ? b : a));
    request = { ...request, [field]: request[field].map((edge, j) => (j === i ? Math.min(LIMITS.maxBlock, edge * 2) : edge)) };
  }
  return request;
}

/**
 * Seconds one single-threaded multiplication of each level takes at n = 512 in the slowest build
 * measured (the reference run's browser, with generous rounding up). Time grows with n cubed.
 */
const SECONDS_AT_512 = { 0: 0.7, 1: 0.7, 2: 0.2, 3: 0.1, 4: 0.2 };

/**
 * The fixed cost of one call that the arithmetic above leaves out, in seconds, generously above
 * what native code measured: a level 4 tile (copying it in and out and claiming it from the
 * queue: about 0.04 µs natively at 1 × 1 × 1) and one cache block of a row at levels 2 and 3
 * (about 6 ns natively at 1 × 1). Negligible at the default shapes, they dominate tiny ones.
 */
const SECONDS_PER_TILE = 0.2e-6;
const SECONDS_PER_BLOCK = 25e-9;

const ceilDiv = (a, b) => Math.ceil(a / b);

/** Seconds one single-threaded multiplication of `level` takes, by the slowest build measured. */
function levelSeconds(level, { n, block = DEFAULTS.block, tile = DEFAULTS.tile }) {
  let seconds = SECONDS_AT_512[level] * (n / 512) ** 3;
  // Levels 2 to 4 visit every (row, k-block, j-block); level 4 also every tile.
  if (level >= 2) seconds += n * ceilDiv(n, block[0]) * ceilDiv(n, block[1]) * SECONDS_PER_BLOCK;
  if (level === 4) seconds += ceilDiv(n, tile[0]) * ceilDiv(n, tile[1]) * ceilDiv(n, tile[2]) * SECONDS_PER_TILE;
  return seconds;
}

/**
 * How long a request may run before the page gives up and restarts the worker: the work at one
 * thread (an overestimate when threads help, and counting the per-tile and per-block cost of
 * small shapes), repeated, plus a warm-up run per level, times a safety factor of 4, plus 15 s
 * for loading the module and starting the pool. `clampRequest` keeps it under MAX_TIMEOUT_MS.
 */
export function timeoutMs(request) {
  const perRepeat = request.levels.reduce((sum, level) => sum + levelSeconds(level, request), 0);
  const seconds = 4 * perRepeat * (request.repeats + 1) + 15;
  return Math.round(seconds * 1000);
}
