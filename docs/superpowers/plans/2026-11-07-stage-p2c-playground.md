# Stage P2c: The Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A`, `git add .` or `git add <directory>`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Add a playground page where a reader runs the benchmark on their own machine, in the browser: choose a matrix size, levels, threads and repeats, press Run, watch the results arrive level by level, cancel, and see whether every level gave the same answer. It uses the threaded build when the browser can (enabling cross-origin isolation through a service worker, with one reload) and otherwise falls back to the single-threaded build.

**Architecture:** Pure, unit-tested modules hold the logic: the limits and time budget of a request (`request.mjs`), the summary and the same-answer verdict (`summary.mjs`), the isolation decision (`isolation.mjs`), batched timing for short runs on a coarse clock (`batching.mjs`) and the page's side of the worker protocol with cancel and timeout (`controller.mjs`, tested with a fake worker). A Web Worker (`worker.js`) owns the wasm module and the thread pool; `ui.js` and `main.js` are the DOM and the wiring. The page lives at `/playground/`, outside the paper's chapters, because it is the one reading page that registers the service worker. A browser gate (`gate-c3.sh`) drives the production build in three scenarios.

**Tech Stack:** Astro 7.4.7, the existing wasm packages (`pkg/` threaded bundler build, `pkg-lite/`), `coi-serviceworker` (already a dependency), `node:test`, headless Firefox; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-results-design.md` (plan P2c of P2a to P2c; the playground section records the decisions made with the owner).

## Global Constraints

- **The playground is the only reading page that may register the service worker** (one reload, on first use of the threaded build). The paper's chapters, including the Results page, never load it: the output checker enforces both directions, and the playground is deliberately not a chapter (it is an `extraPages` entry in `site.config.mjs`).
- **Requests are clamped** by `clampRequest` in BOTH the page and the worker; nothing the form or the URL carries can make the worker do unbounded work. Sizes 64 to 1024 (powers of two), repeats 1, 3 or 5, threads up to the pool (at most 8), blocks and tiles 1 to 1024.
- **A wasm call cannot be interrupted and a panic in the thread pool hangs the caller:** cancel, timeout and error all end by terminating the worker; the next run starts a fresh one. Never try to cancel cooperatively.
- **Never show an infinite or undefined number:** a time of zero has no throughput or speedup (the summary returns null), and short runs are timed in batches.
- The wasm modules, the Rust crate and `results.json` are not modified. No new dependencies. Node runs only in Docker (`web/dev/node.sh`: **never `docker run` any other image or pull anything**).
- Every result shown comes from the real bench API; the page makes no measurement up and states that browser timings are indicative.
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- Rust: stable and the pinned `nightly-2025-11-15` (with `rust-src` and the wasm target); the `wasm-bindgen` CLI at `$HOME/.cargo/bin/wasm-bindgen`. In every shell that builds or runs gates: `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`. Docker with `node:latest`. Firefox 159 for the headless gates and screenshots.
- The site build imports gitignored build outputs: `web/wasm/pkg-lite/`, `web/wasm/pkg/` (built with `FEATURES=threads` for the bundler) and `web/site/public/expected.json`. `gate-c3.sh` (without `--no-build`) builds all three; with `--no-build` it refuses if `pkg/` was not built for the bundler.
- **Port 8765 (gates) and 8873 (screenshots):** before any browser step check nothing listens there (`ss -ltnp | grep PORT`); start servers with `& SRV=$!` and kill that PID (never `pkill -f`).
- Cold wasm builds take 30 to 60 seconds; give shell commands generous timeouts (up to 600000 ms).

---

### Task 1: The playground's request limits and time budget

`request.mjs` is the one place that says what a playground run may ask for. `clampRequest(raw, { pool, build })` returns a request that is always valid (sizes snap to the nearest allowed size, levels are filtered, threads are capped by the pool and forced to 1 in the lite build, blocks and tiles are bounded, garbage falls back to the defaults, and clamping is idempotent). `timeoutMs(request)` is the time budget after which the page gives up and restarts the worker: the one-thread work of the selected levels (a deliberate overestimate), repeated, plus a warm-up, times a safety factor of 4, plus 15 s for loading the module and starting the pool.

**Files:**
- Create: `web/site/src/playground/request.test.mjs`, `web/site/src/playground/request.mjs`
- Modify: `web/site/package.json`

**Interfaces:**
- Produces (`request.mjs`): `LIMITS`, `DEFAULTS`, `clampRequest(raw, { pool, build })`, `timeoutMs(request)`.

- [ ] **Step 1: Write the tests first**


Create `web/site/src/playground/request.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, LIMITS, clampRequest, timeoutMs } from './request.mjs';

test('an empty request becomes the defaults, capped by the build', () => {
  assert.deepEqual(clampRequest({}, { pool: 8, build: 'threads' }), DEFAULTS);
  assert.equal(clampRequest({}, { pool: 2, build: 'threads' }).threads, 2);
  assert.equal(clampRequest({ threads: 8 }, { pool: 8, build: 'lite' }).threads, 1, 'the lite build has no threads');
});

test('every field is forced into its allowed range', () => {
  const request = clampRequest(
    { n: 100000, levels: [9, -1, 3, 3, 1], threads: 999, repeats: 50, block: [0, 99999], tile: [-5, 3.7, 'x'] },
    { pool: 4, build: 'threads' },
  );
  assert.equal(request.n, 1024);
  assert.deepEqual(request.levels, [1, 3]);
  assert.equal(request.threads, 4);
  assert.equal(request.repeats, 5);
  assert.deepEqual(request.block, [1, LIMITS.maxBlock]);
  assert.deepEqual(request.tile, [1, 4, DEFAULTS.tile[2]]);
});

test('sizes snap to the nearest allowed size; garbage falls back to the default', () => {
  assert.equal(clampRequest({ n: 300 }).n, 256);
  assert.equal(clampRequest({ n: 400 }).n, 512);
  assert.equal(clampRequest({ n: 'banana' }).n, DEFAULTS.n);
  assert.equal(clampRequest({ n: NaN }).n, DEFAULTS.n);
  assert.equal(clampRequest({ repeats: 2 }).repeats, 1, 'ties go to the first (smaller) value');
  assert.equal(clampRequest({ repeats: 4 }).repeats, 3);
});

test('a request with no valid level runs every level', () => {
  assert.deepEqual(clampRequest({ levels: [] }).levels, DEFAULTS.levels);
  assert.deepEqual(clampRequest({ levels: [7, 8] }).levels, DEFAULTS.levels);
  assert.deepEqual(clampRequest({ levels: 'all' }).levels, DEFAULTS.levels);
});

test('clamping is idempotent and never throws on hostile input', () => {
  const hostile = [null, undefined, 5, 'x', [], { n: {}, levels: {}, block: 'ab', tile: null, threads: Infinity }];
  for (const raw of hostile) {
    const once = clampRequest(raw ?? undefined, { pool: 8, build: 'threads' });
    assert.deepEqual(clampRequest(once, { pool: 8, build: 'threads' }), once);
  }
});

test('the timeout grows with the size, the levels and the repeats', () => {
  const base = { n: 256, levels: [0, 1, 2, 3, 4], repeats: 3 };
  assert.ok(timeoutMs({ ...base, n: 512 }) > timeoutMs(base));
  assert.ok(timeoutMs({ ...base, repeats: 5 }) > timeoutMs(base));
  assert.ok(timeoutMs({ ...base, levels: [3] }) < timeoutMs(base));
  // never below the 15 s start-up allowance, and a size-1024 run of everything gets minutes
  assert.ok(timeoutMs({ n: 64, levels: [3], repeats: 1 }) >= 15000);
  assert.ok(timeoutMs({ n: 1024, levels: [0, 1, 2, 3, 4], repeats: 5 }) > 120000);
});
````

- [ ] **Step 2: Make `npm test` run the new directory**

In `web/site/package.json`, replace:

````text
    "prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public/media && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js && cp ../../anim/media/videos/naive_matmul/480p15/NaiveMatMul.mp4 ../../anim/media/videos/naive_matmul_parallel/480p15/ParallelNaiveMatMul.mp4 public/media/",
    "build": "astro build",
    "test": "node --test src/plugins/ src/components/ src/results/",
    "check": "node check-dist.mjs"
  },
````

with:

````text
    "prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public/media && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js && cp ../../anim/media/videos/naive_matmul/480p15/NaiveMatMul.mp4 ../../anim/media/videos/naive_matmul_parallel/480p15/ParallelNaiveMatMul.mp4 public/media/",
    "build": "astro build",
    "test": "node --test src/plugins/ src/components/ src/results/ src/playground/",
    "check": "node check-dist.mjs"
  },
````

- [ ] **Step 3: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module" | head -2` -> `Cannot find module '/work/site/src/playground/request.mjs'`.

- [ ] **Step 4: Write the module**


Create `web/site/src/playground/request.mjs`:

````javascript
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
````

- [ ] **Step 5: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` -> `ℹ tests 61`, `ℹ pass 61`, `ℹ fail 0` (the 55 existing tests and 6 new ones).

- [ ] **Step 6: Commit**

```bash
git add web/site/package.json web/site/src/playground/request.mjs web/site/src/playground/request.test.mjs
git commit -m "add the playground's request limits and time budget"
```

---

### Task 2: The playground's result summary and verdict

`summary.mjs` turns what a run streams back into what the page shows: per level the median, minimum, maximum, throughput, speedup over level 0 and over the previous level run, and a bar length; the verdict that every selected level gave the same answer (true only if every hash agrees); the reference run's hash for a size (from `results.json`) and a plain-language verdict that also says whether the result matches the reference run. A time of zero (a clock too coarse for the run) has **no** throughput or speedup (`null`): the page never shows Infinity or NaN.

**Files:**
- Create: `web/site/src/playground/summary.test.mjs`, `web/site/src/playground/summary.mjs`

**Interfaces:**
- Produces (`summary.mjs`): `median(values)`, `summarise(results, n)` -> `{ rows, sameAnswer, hash }` (each row: `level`, `median_ms`, `timed`, `min_ms`, `max_ms`, `batch`, `gflops`, `vsNaive`, `vsPrevious`, `bar`, `hash`), `referenceHash(runs, n)`, `verdict(summary, reference)` -> `{ ok, text }`.

- [ ] **Step 1: Write the tests first**


Create `web/site/src/playground/summary.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median, referenceHash, summarise, verdict } from './summary.mjs';

test('the median of odd and even lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
});

const results = [
  { level: 0, times_ms: [1000, 1000, 1000], hash: 'h' },
  { level: 1, times_ms: [500, 520, 480], hash: 'h' },
  { level: 3, times_ms: [100, 100, 100], hash: 'h' },
];

test('rows carry median, throughput, speedups and bar lengths', () => {
  const { rows } = summarise(results, 128);
  assert.deepEqual(rows.map((r) => r.level), [0, 1, 3]);
  assert.deepEqual(rows.map((r) => r.median_ms), [1000, 500, 100]);
  assert.equal(rows[0].vsNaive, 1);
  assert.equal(rows[2].vsNaive, 10);
  assert.equal(rows[0].vsPrevious, null);
  assert.equal(rows[1].vsPrevious, 2);
  assert.equal(rows[2].vsPrevious, 5);
  assert.deepEqual(rows.map((r) => r.bar), [1, 0.5, 0.1]);
  assert.ok(Math.abs(rows[0].gflops - (2 * 128 ** 3) / 1 / 1e9) < 1e-9);
  assert.equal(rows[1].min_ms, 480);
  assert.equal(rows[1].max_ms, 520);
});

test('without level 0 there is no speedup over naive', () => {
  const { rows } = summarise(results.slice(1), 128);
  assert.equal(rows[0].vsNaive, null);
  assert.equal(rows[1].vsPrevious, 5);
});

test('a time of zero never becomes Infinity or NaN', () => {
  const { rows } = summarise([
    { level: 0, times_ms: [0, 0, 0], hash: 'h' },
    { level: 3, times_ms: [2, 2, 2], hash: 'h' },
  ], 64);
  assert.equal(rows[0].timed, false);
  assert.equal(rows[0].gflops, null);
  assert.equal(rows[1].vsNaive, null, 'no speedup over a zero time');
  assert.equal(rows[1].vsPrevious, null);
  assert.equal(rows[1].timed, true);
  assert.ok(Number.isFinite(rows[1].gflops));
});

test('the same answer is true only if every hash agrees', () => {
  assert.equal(summarise(results, 128).sameAnswer, true);
  assert.equal(summarise(results, 128).hash, 'h');
  const wrong = [...results.slice(0, 2), { level: 3, times_ms: [100], hash: 'x' }];
  assert.equal(summarise(wrong, 128).sameAnswer, false);
  assert.equal(summarise(wrong, 128).hash, null);
  assert.equal(summarise([], 128).sameAnswer, false);
});

test('the reference hash is looked up by size', () => {
  const runs = [{ n: 512, hash: 'a' }, { n: 1024, hash: 'b' }];
  assert.equal(referenceHash(runs, 1024), 'b');
  assert.equal(referenceHash(runs, 64), null);
});

test('the verdict names the failure modes plainly', () => {
  const ok = summarise(results, 128);
  assert.match(verdict(ok, null).text, /All 3 levels gave the same answer/);
  assert.equal(verdict(ok, null).ok, true);
  assert.match(verdict(ok, 'h').text, /matches the reference run/);
  assert.equal(verdict(ok, 'other').ok, false);
  assert.match(verdict(ok, 'other').text, /differs from the reference run/);
  const bad = summarise([{ level: 0, times_ms: [1], hash: 'a' }, { level: 1, times_ms: [1], hash: 'b' }], 64);
  assert.equal(verdict(bad, null).ok, false);
  assert.match(verdict(bad, null).text, /DIFFERENT answers/);
  assert.equal(verdict(summarise([], 64), null).ok, false);
});
````

- [ ] **Step 2: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module" | head -2` -> `Cannot find module '/work/site/src/playground/summary.mjs'`.

- [ ] **Step 3: Write the module**


Create `web/site/src/playground/summary.mjs`:

````javascript
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
````

- [ ] **Step 4: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` -> `ℹ tests 68`, `ℹ pass 68`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/site/src/playground/summary.mjs web/site/src/playground/summary.test.mjs
git commit -m "add the playground's result summary and verdict"
```

---

### Task 3: The isolation decision

The threaded build needs `SharedArrayBuffer`, which a browser allows only on a cross-origin-isolated page; GitHub Pages cannot send the headers, so a service worker adds them and reloads the page once. `decide({ isolated, attempts, serviceWorkers })` is the pure state machine: an isolated page uses the threaded build; otherwise, if the browser has service workers and this tab has not yet tried, register once; otherwise fall back to the lite build, with a reason for the banner (no service workers, or the page is still not isolated after the attempt: private windows and some settings block it).

**Files:**
- Create: `web/site/src/playground/isolation.test.mjs`, `web/site/src/playground/isolation.mjs`

**Interfaces:**
- Produces (`isolation.mjs`): `decide(state)` -> `{ action: 'threads' }` | `{ action: 'register' }` | `{ action: 'lite', reason }`; `ATTEMPTS_KEY` (the `sessionStorage` key where a tab records that it already tried).

- [ ] **Step 1: Write the tests first**


Create `web/site/src/playground/isolation.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from './isolation.mjs';

test('an isolated page uses the threaded build', () => {
  assert.deepEqual(decide({ isolated: true, attempts: 0, serviceWorkers: true }), { action: 'threads' });
  assert.deepEqual(decide({ isolated: true, attempts: 1, serviceWorkers: false }), { action: 'threads' });
});

test('a first visit without isolation registers the service worker once', () => {
  assert.deepEqual(decide({ isolated: false, attempts: 0, serviceWorkers: true }), { action: 'register' });
});

test('after one attempt that did not isolate the page, fall back to the lite build', () => {
  const result = decide({ isolated: false, attempts: 1, serviceWorkers: true });
  assert.equal(result.action, 'lite');
  assert.match(result.reason, /still not cross-origin isolated/);
});

test('a browser without service workers goes straight to the lite build', () => {
  const result = decide({ isolated: false, attempts: 0, serviceWorkers: false });
  assert.equal(result.action, 'lite');
  assert.match(result.reason, /no service workers/);
});
````

- [ ] **Step 2: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module" | head -2` -> `Cannot find module '/work/site/src/playground/isolation.mjs'`.

- [ ] **Step 3: Write the module**


Create `web/site/src/playground/isolation.mjs`:

````javascript
// Which build the playground should use, and whether it must first enable cross-origin
// isolation. The threaded build needs `SharedArrayBuffer`, which a browser only allows on an
// isolated page; GitHub Pages cannot send the headers, so a service worker (coi-serviceworker)
// adds them and reloads the page once. Pure function: the page feeds it what it observes.

/**
 * @param {object} state
 * @param {boolean} state.isolated        `crossOriginIsolated` right now
 * @param {number}  state.attempts        how many times this tab already tried to enable isolation
 * @param {boolean} state.serviceWorkers  whether the browser has service workers at all
 * @returns {{ action: 'threads' } | { action: 'register' } | { action: 'lite', reason: string }}
 */
export function decide({ isolated, attempts, serviceWorkers }) {
  if (isolated) return { action: 'threads' };
  if (!serviceWorkers) return { action: 'lite', reason: 'this browser has no service workers, which multithreading needs' };
  if (attempts < 1) return { action: 'register' };
  return { action: 'lite', reason: 'the page is still not cross-origin isolated after enabling it (private windows and some settings block it)' };
}

/** The key under which a tab remembers that it already tried. */
export const ATTEMPTS_KEY = 'playground-isolation-attempts';
````

- [ ] **Step 4: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` -> `ℹ tests 72`, `ℹ pass 72`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/site/src/playground/isolation.mjs web/site/src/playground/isolation.test.mjs
git commit -m "add the playground's isolation decision"
```

---

### Task 4: Batched timing for short runs

A page that is not cross-origin isolated gets a `performance.now()` rounded to about a millisecond, so a multiplication that takes 0.1 ms reads as 0. (This was found by looking at the first screenshot of the lite fallback: the table showed `Infinity GFLOP/s` and `NaN×` while the verdict said all was well.) `chooseBatch(run, now)` finds how many runs to put in one timed sample so that a sample lasts at least 30 ms by the clock, and `timeSample(run, now, batch)` times a batch and divides. Slow operations get a batch of 1. The tests use a fake clock rounded to 1 ms.

**Files:**
- Create: `web/site/src/playground/batching.test.mjs`, `web/site/src/playground/batching.mjs`

**Interfaces:**
- Produces (`batching.mjs`): `chooseBatch(run, now, { targetMs = 30, maxBatch = 4096 })`, `timeSample(run, now, batch)`.

- [ ] **Step 1: Write the tests first**


Create `web/site/src/playground/batching.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseBatch, timeSample } from './batching.mjs';

// A fake operation costing `cost` ms and a clock that shows the elapsed time rounded down to a
// multiple of `resolution` ms, like a browser's coarsened performance.now().
function fake(cost, resolution) {
  let time = 0;
  return {
    run: () => { time += cost; },
    now: () => Math.floor(time / resolution) * resolution,
    runs: () => Math.round(time / cost),
  };
}

test('a slow operation is timed one run at a time', () => {
  const { run, now } = fake(100, 1);
  assert.equal(chooseBatch(run, now), 1);
});

test('a fast operation on a 1 ms clock is batched until a sample lasts about the target', () => {
  const { run, now } = fake(0.05, 1);
  const batch = chooseBatch(run, now);
  assert.ok(batch >= 600 && batch <= 4096, `batch ${batch}`);
});

test('the batch is capped', () => {
  const { run, now } = fake(0.0001, 1);
  assert.equal(chooseBatch(run, now, { maxBatch: 64 }), 64);
});

test('a batched sample recovers the true per-run time despite the coarse clock', () => {
  const { run, now } = fake(0.05, 1);
  const batch = chooseBatch(run, now);
  const sample = timeSample(run, now, batch);
  assert.ok(Math.abs(sample - 0.05) < 0.002, `sample ${sample}`);
});

test('timing one run on a coarse clock reads zero: the problem batching solves', () => {
  const { run, now } = fake(0.05, 1);
  assert.equal(timeSample(run, now, 1), 0);
});

test('the calibration runs only as many times as it needs to', () => {
  const clock = fake(10, 1);
  chooseBatch(clock.run, clock.now, { targetMs: 30 });
  assert.ok(clock.runs() <= 7, `ran ${clock.runs()} times`);
});
````

- [ ] **Step 2: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module" | head -2` -> `Cannot find module '/work/site/src/playground/batching.mjs'`.

- [ ] **Step 3: Write the module**


Create `web/site/src/playground/batching.mjs`:

````javascript
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
````

- [ ] **Step 4: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` -> `ℹ tests 78`, `ℹ pass 78`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/site/src/playground/batching.mjs web/site/src/playground/batching.test.mjs
git commit -m "add batched timing for short runs"
```

---

### Task 5: The worker protocol controller

`controller.mjs` is the page's side of the worker protocol, with the worker injected so a fake one can drive the tests. `start(request, { timeout })` posts `{ type: 'run', id, build, request }` and resolves (never rejects) with `{ status, results, ready, ... }` where the status is `done`, `cancelled`, `timeout` or `error`; messages carry the run's `id` and anything with another id is ignored. **Every outcome except `done` terminates the worker** (a wasm call cannot be interrupted and a panic in the thread pool hangs the caller); a finished run keeps its worker and its thread pool for the next run. Starting while a run is in progress is an error.

**Files:**
- Create: `web/site/src/playground/controller.test.mjs`, `web/site/src/playground/controller.mjs`

**Interfaces:**
- Produces (`controller.mjs`): `createController({ makeWorker, build, onMessage })` -> `{ start(request, { timeout }), cancel(), running, hasWorker }`. Protocol: page -> worker `{ type: 'run', id, build, request }`; worker -> page `{ type: 'ready', id, build, pool, env, isolated }`, `{ type: 'result', id, level, times_ms, hash, batch }`, `{ type: 'done', id, request }`, `{ type: 'error', id, message }`.

- [ ] **Step 1: Write the tests first**


Create `web/site/src/playground/controller.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createController } from './controller.mjs';

// A worker the test drives by hand.
function fakeWorkers() {
  const made = [];
  const makeWorker = () => {
    const worker = {
      posted: [],
      terminated: false,
      onmessage: null,
      onerror: null,
      postMessage(message) { this.posted.push(message); },
      terminate() { this.terminated = true; },
      emit(data) { this.onmessage?.({ data }); },
    };
    made.push(worker);
    return worker;
  };
  return { made, makeWorker };
}

const request = { n: 64, levels: [0, 3], threads: 1, repeats: 1, block: [32, 64], tile: [128, 128, 128] };

test('a run streams ready, one result per level, then done', async () => {
  const { made, makeWorker } = fakeWorkers();
  const seen = [];
  const controller = createController({ makeWorker, build: 'lite', onMessage: (m) => seen.push(m.type) });
  const run = controller.start(request, { timeout: 5000 });
  assert.equal(controller.running, true);
  const [worker] = made;
  assert.deepEqual(worker.posted, [{ type: 'run', id: 1, build: 'lite', request }]);
  worker.emit({ type: 'ready', id: 1, build: 'lite', pool: 1, env: { isa: 'X' } });
  worker.emit({ type: 'result', id: 1, level: 0, times_ms: [10], hash: 'h' });
  worker.emit({ type: 'result', id: 1, level: 3, times_ms: [2], hash: 'h' });
  worker.emit({ type: 'done', id: 1, request });
  const outcome = await run;
  assert.equal(outcome.status, 'done');
  assert.deepEqual(outcome.results.map((r) => r.level), [0, 3]);
  assert.equal(outcome.ready.pool, 1);
  assert.deepEqual(seen, ['ready', 'result', 'result', 'done']);
  assert.equal(controller.running, false);
  assert.equal(worker.terminated, false, 'a finished run keeps its worker (and its thread pool)');
});

test('the next run reuses the worker of a finished run', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'threads' });
  const first = controller.start(request, { timeout: 5000 });
  made[0].emit({ type: 'done', id: 1, request });
  await first;
  const second = controller.start(request, { timeout: 5000 });
  assert.equal(made.length, 1);
  assert.equal(made[0].posted[1].id, 2);
  made[0].emit({ type: 'done', id: 2, request });
  assert.equal((await second).status, 'done');
});

test('cancel terminates the worker and the next run gets a fresh one', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'lite' });
  const run = controller.start(request, { timeout: 5000 });
  made[0].emit({ type: 'result', id: 1, level: 0, times_ms: [5], hash: 'h' });
  controller.cancel();
  const outcome = await run;
  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.results.length, 1, 'results that arrived before the cancel are kept');
  assert.equal(made[0].terminated, true);
  assert.equal(controller.hasWorker, false);
  const again = controller.start(request, { timeout: 5000 });
  assert.equal(made.length, 2);
  made[1].emit({ type: 'done', id: 2, request });
  assert.equal((await again).status, 'done');
});

test('a run that takes too long times out and terminates the worker', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'threads' });
  const outcome = await controller.start(request, { timeout: 30 });
  assert.equal(outcome.status, 'timeout');
  assert.equal(outcome.timeout, 30);
  assert.equal(made[0].terminated, true);
  assert.equal(controller.running, false);
});

test('an error message or a worker failure ends the run and discards the worker', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'lite' });
  const first = controller.start(request, { timeout: 5000 });
  made[0].emit({ type: 'error', id: 1, message: 'boom' });
  const failed = await first;
  assert.deepEqual([failed.status, failed.message], ['error', 'boom']);
  assert.equal(made[0].terminated, true);
  const second = controller.start(request, { timeout: 5000 });
  made[1].onerror({ message: 'could not load' });
  const crashed = await second;
  assert.deepEqual([crashed.status, crashed.message], ['error', 'could not load']);
});

test('messages from an old run are ignored', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'lite' });
  const run = controller.start(request, { timeout: 5000 });
  made[0].emit({ type: 'result', id: 99, level: 4, times_ms: [1], hash: 'stale' });
  made[0].emit({ type: 'done', id: 99, request });
  assert.equal(controller.running, true);
  made[0].emit({ type: 'done', id: 1, request });
  const outcome = await run;
  assert.equal(outcome.results.length, 0);
});

test('starting while a run is in progress is an error', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'lite' });
  const run = controller.start(request, { timeout: 5000 });
  assert.throws(() => controller.start(request, { timeout: 5000 }), /already in progress/);
  made[0].emit({ type: 'done', id: 1, request });
  await run;
});
````

- [ ] **Step 2: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module" | head -2` -> `Cannot find module '/work/site/src/playground/controller.mjs'`.

- [ ] **Step 3: Write the controller**


Create `web/site/src/playground/controller.mjs`:

````javascript
// The page's side of the playground's worker protocol: start a run, collect the results it
// streams back, and recover. No DOM and no worker of its own: the worker is injected, so the
// protocol is testable with a fake one.
//
// Protocol (messages carry the run's `id`; anything with another id is ignored):
//   page -> worker  { type: 'run', id, build, request }
//   worker -> page  { type: 'ready', id, build, pool, env, isolated }   module and pool are up
//                   { type: 'result', id, level, times_ms, hash, batch } one per level, in order;
//                                          each time is the mean of `batch` runs timed together
//                   { type: 'done', id, request }                        the clamped request that ran
//                   { type: 'error', id, message }
//
// A wasm call cannot be interrupted, and a panic inside the thread pool hangs the caller, so
// cancel, timeout and error all end the same way: terminate the worker. The next run starts a
// fresh one. Only a run that finished with `done` keeps its worker (and its thread pool).

/**
 * @param {object} options
 * @param {() => {postMessage: Function, terminate: Function, onmessage: any, onerror: any}} options.makeWorker
 * @param {'threads'|'lite'} options.build
 * @param {(message: object) => void} [options.onMessage]  called with every message of the current run
 */
export function createController({ makeWorker, build, onMessage = () => {} }) {
  let worker = null;
  let nextId = 1;
  let current = null;

  const discardWorker = () => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  };

  /**
   * Starts a run. Resolves, never rejects, with `{ status, id, results, ready, ... }` where
   * status is 'done', 'cancelled', 'timeout' or 'error' (with `message`).
   */
  function start(request, { timeout }) {
    if (current) throw new Error('a run is already in progress');
    worker ??= makeWorker();
    const id = nextId++;
    const results = [];
    let ready = null;
    return new Promise((resolve) => {
      let timer = null;
      const finish = (status, extra = {}) => {
        clearTimeout(timer);
        current = null;
        if (status !== 'done') discardWorker();
        resolve({ status, id, results, ready, ...extra });
      };
      worker.onmessage = (event) => {
        const message = event.data;
        if (!message || message.id !== id) return;
        if (message.type === 'ready') ready = message;
        else if (message.type === 'result') results.push({ level: message.level, times_ms: message.times_ms, hash: message.hash, batch: message.batch ?? 1 });
        onMessage(message);
        if (message.type === 'done') finish('done', { request: message.request });
        else if (message.type === 'error') finish('error', { message: message.message });
      };
      worker.onerror = (event) => finish('error', { message: (event && event.message) || 'the worker failed' });
      timer = setTimeout(() => finish('timeout', { timeout }), timeout);
      current = { cancel: () => finish('cancelled') };
      worker.postMessage({ type: 'run', id, build, request });
    });
  }

  return {
    start,
    cancel: () => current?.cancel(),
    get running() { return current !== null; },
    get hasWorker() { return worker !== null; },
  };
}
````

- [ ] **Step 4: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` -> `ℹ tests 85`, `ℹ pass 85`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/site/src/playground/controller.mjs web/site/src/playground/controller.test.mjs
git commit -m "add the playground's worker protocol controller"
```

---

### Task 6: The playground page

The worker (`worker.js`) owns the wasm module and, in the threaded build, the thread pool (`min(cores, 8)`, fixed for the worker's life): per level it warms up once, picks a batch size (Task 4), times `repeats` samples with the bench API, and streams the level's result with its hash. It clamps the request again itself. `ui.js` is the DOM (reading and writing the form, the banner, the build line, the table with bars, the verdict) and `main.js` the wiring: it checks for WebAssembly SIMD (and shows a message instead of a broken page if missing), chooses the build with the isolation decision (loading `coi-serviceworker.js` only here, once, with the one reload; falling back to lite after 8 s if the service worker does not start), locks the threads control in the lite build, and runs the form through the controller with the time budget. `gate.js` holds the automated scenarios for the browser gates (reached only with `?gate=...` in the URL; a normal visit never loads it). The page `/playground/` is an Astro page outside the chapters, linked from the navigation (`extraPages` in `site.config.mjs`) and resolvable from prose as `[text](crate::playground)`; the styles are added.

**Files:**
- Create: `web/site/src/playground/worker.js`, `web/site/src/playground/ui.js`, `web/site/src/playground/main.js`, `web/site/src/playground/gate.js`, `web/site/src/pages/playground/index.astro`
- Modify: `web/site/site.config.mjs`, `web/site/src/layouts/Page.astro`, `web/site/src/styles/site.css`

**Interfaces:**
- Consumes: Tasks 1 to 5; the wasm bench API through `pkg/` and `pkg-lite/`.
- Produces: the page at `/hardware-aware-matmul/playground/`; `site.config.mjs` exports `extraPages`; the `links` table gets `playground`.

- [ ] **Step 1: Write the worker**


Create `web/site/src/playground/worker.js`:

````javascript
// The playground's Web Worker: it owns the wasm module (threaded or lite, chosen by the page)
// and runs benchmark requests through the bench API, streaming one result per level. The page
// never calls wasm directly; see controller.mjs for the protocol and for why cancel and
// timeout end by terminating this worker.
import { chooseBatch, timeSample } from './batching.mjs';
import { clampRequest } from './request.mjs';

let loaded = null; // { build, api, pool, env }

/** Loads and starts the module for `build` once per worker. */
async function load(build) {
  if (loaded && loaded.build === build) return loaded;
  const api = build === 'threads'
    ? await import('../../../wasm/pkg/hardware_aware_matmul_web.js')
    : await import('../../../wasm/pkg-lite/hardware_aware_matmul_web.js');
  await api.default();
  let pool = 1;
  if (build === 'threads') {
    // The pool is fixed for the life of the worker; the threads control is the number of jobs
    // handed to it, up to this size.
    await api.initThreadPool(Math.min(self.navigator.hardwareConcurrency || 1, 8));
    pool = api.pool_threads();
  }
  loaded = { build, api, pool, env: JSON.parse(api.env_info()) };
  return loaded;
}

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || message.type !== 'run') return;
  const { id, build } = message;
  try {
    const { api, pool, env } = await load(build);
    self.postMessage({ type: 'ready', id, build, pool, env, isolated: self.crossOriginIsolated });
    // Clamp again here: the worker trusts nothing it is sent.
    const request = clampRequest(message.request, { pool, build });
    api.bench_prepare(request.n);
    for (const level of request.levels) {
      const run = () => api.bench_multiply(
        level, request.threads, request.block[0], request.block[1],
        request.tile[0], request.tile[1], request.tile[2],
      );
      run(); // one untimed warm-up per level
      // On a page that is not cross-origin isolated the clock is coarse (about 1 ms), so short runs
      // are timed in batches and divided; long ones have a batch of 1 and are timed directly.
      const now = () => performance.now();
      const batch = chooseBatch(run, now);
      const times = [];
      for (let i = 0; i < request.repeats; i += 1) times.push(Number(timeSample(run, now, batch).toFixed(4)));
      self.postMessage({ type: 'result', id, level, times_ms: times, hash: api.bench_hash(), batch });
    }
    self.postMessage({ type: 'done', id, request });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String((error && error.message) || error) });
  }
};
````

- [ ] **Step 2: Write the DOM module, the wiring and the gate scenarios**

Create `web/site/src/playground/ui.js`:

````javascript
// The playground's DOM: reads the form, shows the status, the build, the results table with
// bars, and the "same answer" verdict. No logic about workers or isolation lives here.
import { LIMITS } from './request.mjs';
import { summarise, verdict } from './summary.mjs';

const LEVEL_NAMES = ['Level 0: naive', 'Level 1: threaded', 'Level 2: cache blocking', 'Level 3: SIMD', 'Level 4: streaming'];

const formatMs = (ms) => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  if (ms >= 1) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(3)} ms`;
};

export function createUi(root) {
  const $ = (selector) => root.querySelector(selector);
  const form = $('#pg-form');
  const elements = {
    form,
    run: $('#pg-run'),
    cancel: $('#pg-cancel'),
    status: $('#pg-status'),
    banner: $('#pg-banner'),
    build: $('#pg-build'),
    body: $('#pg-table tbody'),
    table: $('#pg-table'),
    verdict: $('#pg-verdict'),
  };

  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };

  return {
    /** The values currently in the form (unclamped: the controller clamps them). */
    readForm() {
      const data = new FormData(form);
      const number = (name) => Number(data.get(name));
      return {
        n: number('n'),
        levels: LIMITS.levels.filter((level) => data.getAll('levels').includes(String(level))),
        threads: number('threads'),
        repeats: number('repeats'),
        block: [number('block-k'), number('block-j')],
        tile: [number('tile-rows'), number('tile-cols'), number('tile-depth')],
      };
    },
    /** Puts a (clamped) request back into the form. */
    writeForm(request) {
      form.elements.n.value = String(request.n);
      for (const box of form.querySelectorAll('input[name="levels"]')) box.checked = request.levels.includes(Number(box.value));
      form.elements.threads.value = String(request.threads);
      form.elements.repeats.value = String(request.repeats);
      form.elements['block-k'].value = String(request.block[0]);
      form.elements['block-j'].value = String(request.block[1]);
      form.elements['tile-rows'].value = String(request.tile[0]);
      form.elements['tile-cols'].value = String(request.tile[1]);
      form.elements['tile-depth'].value = String(request.tile[2]);
    },
    /** Limits the threads control to what the build can use. */
    setMaxThreads(max) {
      form.elements.threads.max = String(max);
      form.elements.threads.disabled = max <= 1;
      if (Number(form.elements.threads.value) > max) form.elements.threads.value = String(max);
    },
    setBanner(message, kind = 'info') {
      elements.banner.hidden = !message;
      elements.banner.textContent = message ?? '';
      elements.banner.dataset.kind = kind;
    },
    setBuild(message) { elements.build.textContent = message; },
    setStatus(message) { elements.status.textContent = message; },
    setRunning(running) {
      elements.run.disabled = running;
      elements.cancel.disabled = !running;
      for (const control of form.querySelectorAll('input, select')) control.disabled = running;
      // The lite build has one thread: that control stays locked when the run ends.
      if (!running) form.elements.threads.disabled = form.elements.threads.dataset.locked === 'true';
      elements.table.setAttribute('aria-busy', String(running));
    },
    /** Locks the controls the build cannot use (the lite build has one thread). */
    lockThreads(locked) {
      form.elements.threads.dataset.locked = String(locked);
      form.elements.threads.disabled = locked;
    },
    disableAll(reason) {
      for (const control of form.querySelectorAll('input, select, button')) control.disabled = true;
      elements.status.textContent = reason;
    },
    /** Shows the table and the verdict for the results so far. */
    showResults(results, n, reference, { final }) {
      const summary = summarise(results, n);
      elements.body.replaceChildren(...summary.rows.map((row) => {
        const tr = document.createElement('tr');
        tr.append(text('th', LEVEL_NAMES[row.level]));
        tr.lastChild.scope = 'row';
        tr.append(text('td', row.timed ? formatMs(row.median_ms) : 'too fast to time'));
        tr.lastChild.title = `fastest ${formatMs(row.min_ms)}, slowest ${formatMs(row.max_ms)}` +
          (row.batch > 1 ? `; each time is the mean of ${row.batch} runs timed together` : '');
        tr.append(text('td', row.gflops === null ? '' : `${row.gflops.toFixed(1)} GFLOP/s`));
        tr.append(text('td', row.vsNaive === null ? '' : `${row.vsNaive.toFixed(1)}×`));
        tr.append(text('td', row.vsPrevious === null ? '' : `${row.vsPrevious.toFixed(1)}×`));
        const bar = document.createElement('td');
        const fill = document.createElement('span');
        fill.className = 'pg-bar';
        fill.style.width = `${Math.max(2, row.bar * 100).toFixed(1)}%`;
        fill.setAttribute('aria-hidden', 'true');
        bar.append(fill);
        tr.append(bar);
        return tr;
      }));
      elements.table.hidden = summary.rows.length === 0;
      if (final) {
        const v = verdict(summary, reference);
        elements.verdict.hidden = false;
        elements.verdict.dataset.ok = String(v.ok);
        elements.verdict.textContent = `${v.ok ? '✓' : '✗'} ${v.text}`;
      } else {
        elements.verdict.hidden = true;
      }
      return summary;
    },
    clearResults() {
      elements.body.replaceChildren();
      elements.table.hidden = true;
      elements.verdict.hidden = true;
    },
    elements,
  };
}
````


Create `web/site/src/playground/main.js`:

````javascript
// The playground page: picks the build (threaded if the page is cross-origin isolated, else
// tries once to enable isolation through a service worker, else the single-threaded lite
// build), wires the form to the worker through the controller, and shows the results.
import { createController } from './controller.mjs';
import { ATTEMPTS_KEY, decide } from './isolation.mjs';
import { DEFAULTS, clampRequest, timeoutMs } from './request.mjs';
import { createUi } from './ui.js';

const root = document.getElementById('playground');
const base = root.dataset.base;
const reference = JSON.parse(root.dataset.reference); // size -> the reference run's result hash
const query = new URLSearchParams(location.search);
const ui = createUi(root);

// A tiny WebAssembly module using a 128-bit SIMD instruction: it validates only in browsers
// that support WebAssembly SIMD, which both builds of the module need.
const SIMD_PROBE = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const supportsSimd = () => {
  try { return WebAssembly.validate(SIMD_PROBE); } catch { return false; }
};

const store = {
  get() { try { return Number(sessionStorage.getItem(ATTEMPTS_KEY) || 0); } catch { return 0; } },
  set(value) { try { sessionStorage.setItem(ATTEMPTS_KEY, String(value)); } catch { /* storage blocked */ } },
  clear() { try { sessionStorage.removeItem(ATTEMPTS_KEY); } catch { /* storage blocked */ } },
};

/** Resolves to 'threads' or 'lite' (never, if the page reloads to enable isolation). */
async function chooseBuild() {
  const decision = decide({ isolated: self.crossOriginIsolated, attempts: store.get(), serviceWorkers: 'serviceWorker' in navigator });
  if (decision.action === 'threads') {
    store.clear();
    return { build: 'threads' };
  }
  if (decision.action === 'register') {
    store.set(1);
    ui.setBanner('Enabling multithreading: this page will reload once.', 'info');
    // coi-serviceworker registers itself, then reloads the page so the service worker's
    // headers apply. It is loaded here and nowhere else on the site.
    const script = document.createElement('script');
    script.src = `${base}coi-serviceworker.js`;
    document.head.append(script);
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return { build: 'lite', reason: 'the service worker did not start in time' };
  }
  return { build: 'lite', reason: decision.reason };
}

async function main() {
  const context = { ui, reference, base, build: null, pool: 1, lastOutcome: null };
  if (!supportsSimd()) {
    ui.setBanner('This browser has no WebAssembly SIMD support, which the playground needs. Firefox 89, Chrome 91 and Safari 16.4 or later have it.', 'warning');
    ui.disableAll('The playground cannot run in this browser.');
    context.unsupported = true;
    if (query.get('gate')) (await import('./gate.js')).runGate(query.get('gate'), context);
    return;
  }
  ui.disableAll('Choosing how to run…');
  const { build, reason } = await chooseBuild();
  context.build = build;
  const maxThreads = build === 'threads' ? Math.min(navigator.hardwareConcurrency || 1, 8) : 1;
  context.pool = maxThreads;
  for (const control of root.querySelectorAll('input, select, button')) control.disabled = false;
  ui.setRunning(false);
  ui.lockThreads(build === 'lite');
  ui.setMaxThreads(maxThreads);
  ui.writeForm(clampRequest(DEFAULTS, { pool: maxThreads, build }));
  if (build === 'lite') {
    ui.setBanner(`Single-threaded mode: ${reason}. Threads are limited to 1, so the results will be slower than the threaded ones.`, 'warning');
  } else {
    ui.setBanner(null);
  }
  ui.setBuild(build === 'threads' ? `Threaded build (up to ${maxThreads} threads)` : 'Single-threaded (lite) build');
  ui.setStatus('Ready.');

  const timeoutOverride = Number(query.get('timeout_ms'));
  const results = [];
  const controller = createController({
    makeWorker: () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
    build,
    onMessage: (message) => {
      if (message.type === 'ready') {
        const e = message.env;
        ui.setBuild(`${build === 'threads' ? `Threaded build, pool of ${message.pool} threads` : 'Single-threaded (lite) build'}; ${e.isa}; micro-tile ${e.micro_tile[0]}×${e.micro_tile[1]}`);
        ui.setStatus('Running…');
      }
    },
  });
  context.controller = controller;

  /** Runs `request` (clamped by the caller) and shows the outcome. */
  async function run(request, { timeout = timeoutMs(request) } = {}) {
    ui.clearResults();
    ui.setRunning(true);
    ui.setStatus('Starting (the first run loads the module)…');
    results.length = 0;
    const outcome = await controller.start(request, { timeout });
    context.lastOutcome = { ...outcome, request };
    ui.setRunning(false);
    const final = outcome.status === 'done';
    if (outcome.results.length > 0) ui.showResults(outcome.results, request.n, reference[request.n] ?? null, { final });
    ui.setStatus({
      done: 'Done.',
      cancelled: 'Cancelled. The worker was restarted; the next run will reload the module.',
      timeout: `Stopped after ${(outcome.timeout / 1000).toFixed(0)} s (the time budget for this size). The worker was restarted.`,
      error: `The run failed: ${outcome.message}. The worker was restarted.`,
    }[outcome.status]);
    return outcome;
  }
  context.run = (request, options) => run(request, options);
  context.timeoutOverride = timeoutOverride;

  ui.elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (controller.running) return;
    const request = clampRequest(ui.readForm(), { pool: maxThreads, build });
    ui.writeForm(request);
    run(request, timeoutOverride > 0 ? { timeout: timeoutOverride } : undefined);
  });
  ui.elements.cancel.addEventListener('click', () => controller.cancel());

  if (query.get('gate')) (await import('./gate.js')).runGate(query.get('gate'), context);
}

main();
````


Create `web/site/src/playground/gate.js`:

````javascript
// Automated runs of the playground for the browser gates (web/site/gate-c3.sh), chosen by
// `?gate=threads|lite|recover` in the URL. They drive the real page and POST a report that
// web/dev/check_report.py judges. A normal visit never uses this module.
import { DEFAULTS, clampRequest } from './request.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, timeoutMs, what) {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

async function post(report) {
  await fetch('/report', { method: 'POST', body: JSON.stringify(report) });
}

export async function runGate(name, context) {
  const { ui, base } = context;
  const report = {
    gate: `playground-${name}`,
    base,
    build: context.build,
    isolated: self.crossOriginIsolated,
    service_workers: 'serviceWorker' in navigator,
    unsupported: Boolean(context.unsupported),
  };
  try {
    if (context.unsupported) throw new Error('the browser has no WebAssembly SIMD');
    const expected = await (await fetch(`${base}expected.json`)).json();
    report.expected_hash = expected['64'];
    const small = clampRequest({ ...DEFAULTS, n: 64, threads: 2, repeats: 1 }, { pool: context.pool, build: context.build });
    report.threads_control_disabled = ui.elements.form.elements.threads.disabled;
    report.banner = ui.elements.banner.hidden ? null : ui.elements.banner.textContent;

    if (name === 'threads' || name === 'lite') {
      // The real page path: fill the form, press Run, read what the page shows.
      ui.writeForm(small);
      ui.elements.form.requestSubmit();
      await waitFor(() => context.lastOutcome && !context.controller.running, 120000, 'the run to finish');
      const outcome = context.lastOutcome;
      report.status = outcome.status;
      report.pool = outcome.ready?.pool ?? null;
      report.env = outcome.ready?.env ?? null;
      report.threads_used = outcome.request?.threads ?? null;
      report.results = outcome.results.map((r) => ({ level: r.level, median_ms: r.times_ms.reduce((a, b) => a + b, 0) / r.times_ms.length, hash: r.hash }));
      report.rows = [...document.querySelectorAll('#pg-table tbody tr')].map((tr) => tr.firstChild.textContent);
      report.table_text = document.querySelector('#pg-table').textContent;
      report.batches = outcome.results.map((r) => r.batch);
      report.verdict_ok = ui.elements.verdict.dataset.ok === 'true';
      report.verdict_text = ui.elements.verdict.textContent;
      report.build_text = ui.elements.build.textContent;
    } else if (name === 'recover') {
      // Cancel, time out, and then prove the page still works with a fresh worker.
      const big = clampRequest({ n: 1024, levels: [0, 1, 2, 3, 4], threads: 2, repeats: 5 }, { pool: context.pool, build: context.build });
      const first = context.run(big, { timeout: 120000 });
      await waitFor(() => context.controller.running, 5000, 'the big run to start');
      await wait(800);
      context.controller.cancel();
      const cancelled = await first;
      const timedOut = await context.run(big, { timeout: 300 });
      const recovered = await context.run(small);
      report.cancel_status = cancelled.status;
      report.timeout_status = timedOut.status;
      report.recovery_status = recovered.status;
      report.recovery_hashes = recovered.results.map((r) => r.hash);
      report.recovery_levels = recovered.results.map((r) => r.level);
      report.verdict_ok = ui.elements.verdict.dataset.ok === 'true';
    } else {
      throw new Error(`unknown gate: ${name}`);
    }
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String((error && error.stack) || error);
  }
  await post(report);
}
````


- [ ] **Step 3: Write the page**

Create `web/site/src/pages/playground/index.astro`:

````astro
---
// The playground: run the benchmark on the reader's own machine. This is the ONE reading page
// that may register the service worker (to enable multithreading, with one reload); it is
// deliberately not one of the paper's chapters, so those stay reload-free. The logic lives in
// src/playground/.
import Page from '../../layouts/Page.astro';
import results from '../../data/results.json';

const base = import.meta.env.BASE_URL;
// The reference run's result hash for each size it measured: the playground checks its own
// result against it when the size matches.
const reference = Object.fromEntries(
  results.parameters.sizes.map((n) => [n, results.runs.find((run) => run.n === n)?.hash]),
);
const levels = ['Level 0: naive', 'Level 1: threaded', 'Level 2: cache blocking', 'Level 3: SIMD', 'Level 4: streaming'];
---
<Page title="Playground">
  <p>
    Run the benchmark on your own machine. This page runs the same Rust code as the Methods,
    compiled to WebAssembly, inside your browser, and times each level on a matrix size you
    choose. Browser timings are indicative: they depend on your hardware, your browser and what
    else the machine is doing, and will differ from the reference run on the Results page.
  </p>
  <section id="playground" data-base={base} data-reference={JSON.stringify(reference)}>
    <div id="pg-banner" class="pg-banner" role="status" hidden></div>
    <form id="pg-form" class="pg-form">
      <label>Matrix size
        <select name="n">
          {[64, 128, 256, 512, 1024].map((n) => <option value={n}>{n} × {n}</option>)}
        </select>
      </label>
      <label>Repeats (the median is shown)
        <select name="repeats">
          {[1, 3, 5].map((r) => <option value={r}>{r}</option>)}
        </select>
      </label>
      <label>Threads
        <input type="number" name="threads" min="1" max="8" value="4" />
      </label>
      <fieldset>
        <legend>Levels to run</legend>
        {levels.map((name, level) => (
          <label class="pg-check"><input type="checkbox" name="levels" value={level} checked /> {name}</label>
        ))}
      </fieldset>
      <details class="pg-advanced">
        <summary>Cache blocks and tiles</summary>
        <label>Cache block k <input type="number" name="block-k" min="1" max="1024" value="32" /></label>
        <label>Cache block j <input type="number" name="block-j" min="1" max="1024" value="64" /></label>
        <label>Level 4 tile rows <input type="number" name="tile-rows" min="1" max="1024" value="128" /></label>
        <label>Level 4 tile columns <input type="number" name="tile-cols" min="1" max="1024" value="128" /></label>
        <label>Level 4 tile depth <input type="number" name="tile-depth" min="1" max="1024" value="128" /></label>
      </details>
      <div class="pg-actions">
        <button type="submit" id="pg-run">Run</button>
        <button type="button" id="pg-cancel" disabled>Cancel</button>
      </div>
    </form>
    <p id="pg-status" role="status" aria-live="polite"></p>
    <p id="pg-build" class="pg-build"></p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Playground results">
      <table class="results" id="pg-table" hidden>
        <thead>
          <tr>
            <th scope="col">Level</th><th scope="col">Median</th><th scope="col">Throughput</th>
            <th scope="col">vs level 0</th><th scope="col">vs previous</th><th scope="col">Time</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
    <p id="pg-verdict" class="pg-verdict" hidden></p>
  </section>
  <script>
    import '../../playground/main.js';
  </script>
</Page>
````

- [ ] **Step 4: Add the page to the navigation, the link table and the styles**

In `web/site/site.config.mjs`, replace:

````text
];

// Labels for the sections that group several pages.
export const sectionTitles = { methods: 'Methods' };
````

with:

````text
];

// Pages that are not part of the paper's reading order but are linked from the navigation.
// The playground may register the service worker (one reload) to enable multithreading, which
// is why it is not a chapter: the chapters must stay reload-free.
export const extraPages = [{ title: 'Playground', route: 'playground/' }];

// Labels for the sections that group several pages.
export const sectionTitles = { methods: 'Methods' };
````

In `web/site/site.config.mjs`, replace:

````text
  simd: 'levels/simd/',
  streaming: 'levels/streaming/',
  // API items and rustdoc-only pages.
  ...Object.fromEntries([
````

with:

````text
  simd: 'levels/simd/',
  streaming: 'levels/streaming/',
  playground: 'playground/',
  // API items and rustdoc-only pages.
  ...Object.fromEntries([
````


In `web/site/src/layouts/Page.astro`, replace:

````text
import '../styles/site.css';
import StepThroughLoader from '../components/StepThroughLoader.astro';
import { chapters, repoUrl, sectionTitles, siteSubtitle, siteTitle } from '../../site.config.mjs';

interface Props {
````

with:

````text
import '../styles/site.css';
import StepThroughLoader from '../components/StepThroughLoader.astro';
import { chapters, extraPages, repoUrl, sectionTitles, siteSubtitle, siteTitle } from '../../site.config.mjs';

interface Props {
````

In `web/site/src/layouts/Page.astro`, replace:

````text
            ),
          )}
        </ul>
      </nav>
````

with:

````text
            ),
          )}
          {extraPages.map((page) => (
            <li>
              <a href={base + page.route} aria-current={here === base + page.route ? 'page' : undefined}>{page.title}</a>
            </li>
          ))}
        </ul>
      </nav>
````


In `web/site/src/styles/site.css`, replace:

````text
.chart circle.line-4 { fill: var(--series-3); }
.chart .ideal { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 4 3; }
````

with:

````text
.chart circle.line-4 { fill: var(--series-3); }
.chart .ideal { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 4 3; }

/* Playground */
.pg-banner { margin: 0 0 1rem; padding: 0.6rem 0.9rem; border: 1px solid var(--border); border-radius: 6px; }
.pg-banner[data-kind='warning'] { border-color: var(--accent); }
.pg-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.9rem 1.5rem; margin: 0 0 1rem; }
.pg-form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.92rem; }
.pg-form input[type='number'], .pg-form select { padding: 0.3rem 0.4rem; font: inherit; }
.pg-form fieldset { margin: 0; padding: 0.5rem 0.8rem; border: 1px solid var(--border); border-radius: 6px; }
.pg-form .pg-check { flex-direction: row; align-items: center; gap: 0.4rem; }
.pg-advanced { grid-column: 1 / -1; }
.pg-advanced label { margin: 0.5rem 0; }
.pg-actions { grid-column: 1 / -1; display: flex; gap: 0.5rem; }
.pg-actions button { padding: 0.4rem 1.1rem; font: inherit; }
.pg-build { font-size: 0.9rem; color: var(--muted); }
.pg-bar { display: block; height: 0.8rem; min-width: 2px; border-radius: 2px; background: var(--accent); }
#pg-table td:last-child { min-width: 8rem; text-align: left; }
.pg-verdict { margin: 1rem 0; padding: 0.6rem 0.9rem; border-left: 4px solid var(--border); }
.pg-verdict[data-ok='true'] { border-left-color: #2a8a46; }
.pg-verdict[data-ok='false'] { border-left-color: #c33333; }
````


- [ ] **Step 5: Build and check**

With the wasm modules and `expected.json` in place (see the environment section):

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|rror|page\(s\)|unresolv|Cannot"
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"
ls web/site/dist/playground
grep -l "coi-serviceworker" web/site/dist/levels/*/index.html web/site/dist/results/index.html web/site/dist/index.html || echo "no chapter references it"
```

Expected: `11 page(s) built` (the ten from before and `/playground/`), no error, `check-dist: PASS (11 pages)`, `index.html` listed for the playground, and `no chapter references it`. If the build cannot resolve `../../../wasm/pkg/hardware_aware_matmul_web.js`, the threaded bundler module is missing: stop and report BLOCKED (do not weaken anything).

- [ ] **Step 6: Look at it (not gated, but do it)**

Firefox photographs a page on its `load` event, before the worker has run anything. The lite scenario (service workers disabled, `?gate=lite`) runs the benchmark by itself, so hold `load` open for a few seconds with a deliberately slow image in a **temporary copy** of the build, and screenshot at desktop width in light mode and phone width in dark mode. Use absolute paths for the PNGs and for the scratchpad:

```bash
SP=<your scratchpad directory>; mkdir -p "$SP/shots"; ss -ltnp | grep 8873 && echo "port busy: stop"
ROOT=$(mktemp -d -p "$SP"); mkdir -p "$ROOT/hardware-aware-matmul"; cp -a web/site/dist/. "$ROOT/hardware-aware-matmul/"
python3 - "$ROOT" <<'PYEOF'
import re, sys
p = sys.argv[1] + '/hardware-aware-matmul/playground/index.html'
t = open(p).read()
open(p, 'w').write(re.sub(r'(<body[^>]*>)', r'\1<img src="/slow.gif" width="1" height="1" alt="">', t, count=1))
PYEOF
cat > "$SP/shots/slow.py" <<'PYEOF'
import http.server, os, sys, time
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/slow.gif'):
            time.sleep(9)
            self.send_response(200); self.send_header('Content-Type', 'image/gif'); self.end_headers()
            self.wfile.write(bytes.fromhex('47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b'))
        else:
            super().do_GET()
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0))); self.send_response(204); self.end_headers()
    def log_message(self, *a): pass
os.chdir(sys.argv[2]); http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PYEOF
python3 -I "$SP/shots/slow.py" 8873 "$ROOT" & SRV=$!; sleep 1; PROFILE=$(mktemp -d -p "$SP")
printf '%s\n' 'user_pref("dom.serviceWorkers.enabled", false);' > "$PROFILE/user.js"
timeout 120 firefox --headless --no-remote --profile "$PROFILE" --screenshot "$SP/shots/desk.png" --window-size=1000,1400 "http://127.0.0.1:8873/hardware-aware-matmul/playground/?gate=lite"
printf '%s\n' 'user_pref("dom.serviceWorkers.enabled", false);' 'user_pref("ui.systemUsesDarkTheme", 1);' > "$PROFILE/user.js"
timeout 120 firefox --headless --no-remote --profile "$PROFILE" --screenshot "$SP/shots/phone.png" --window-size=420,2000 "http://127.0.0.1:8873/hardware-aware-matmul/playground/?gate=lite"
kill $SRV; rm -rf "$PROFILE" "$ROOT"; ss -ltnp | grep 8873 || echo "port free"
```

Read `desk.png` and `phone.png`. Check: the navigation ends with `Results` and an underlined `Playground`; the intro paragraph; a banner saying `Single-threaded mode: this browser has no service workers...`; the form (size, repeats, a locked threads control, five level checkboxes, a collapsed `Cache blocks and tiles`); `Run` and a disabled `Cancel`; the build line `Single-threaded (lite) build; WASM SIMD128; micro-tile 4×4`; a table with five levels whose times are **real numbers of milliseconds, with no `Infinity` or `NaN`**, speedups, and bars; and a green `✓ All 5 levels gave the same answer, bit for bit (hash 653a9b093a002dca).` On the phone the form stacks, and the wide table scrolls inside its own box. Report anything that looks wrong; do not change the design. Delete the temporary directories afterwards.

- [ ] **Step 7: Commit**

```bash
git add web/site/src/playground/worker.js web/site/src/playground/ui.js web/site/src/playground/main.js web/site/src/playground/gate.js web/site/src/pages/playground/index.astro web/site/site.config.mjs web/site/src/layouts/Page.astro web/site/src/styles/site.css
git commit -m "add the playground page"
```

---

### Task 7: The playground browser gate

`gate-c3.sh` builds both wasm modules and the site, then drives the playground page of the **production build** in headless Firefox on a page served **without** isolation headers, in three scenarios, each in a fresh browser profile:

- `threads`: the page enables cross-origin isolation through the service worker (one reload), uses the threaded build, and a run through the real form and button gives five results that all equal the **native** hash for the same size, a ✓ verdict, a table with five rows and no `NaN`/`Infinity`, and the threaded build's pool.
- `lite`: with service workers **disabled in the browser** (a preference written to the profile through the new `FIREFOX_PREFS` variable of `run_page.sh`), the page falls back to the single-threaded build, locks the threads control, shows the banner, and still gives the native answer.
- `recover`: a size-1024 run is cancelled after 0.8 s, another times out after 0.3 s, and a third (small) run still completes with the right hashes: after cancel and timeout the worker is terminated and a fresh one works.

`check_report.py` gains the three gate names and judges each report; every check has a negative control below.

**Files:**
- Create: `web/site/gate-c3.sh`
- Modify: `web/dev/run_page.sh`, `web/dev/check_report.py`

**Interfaces:**
- Produces: `web/site/gate-c3.sh [--no-build]`; `web/dev/run_page.sh` honours `FIREFOX_PREFS`; `check_report.py playground-threads|playground-lite|playground-recover REPORT.json`.

- [ ] **Step 1: Create the gate script**


Create `web/site/gate-c3.sh` (then `chmod +x`):

````bash
#!/usr/bin/env bash
# Gate C3: the playground page of the Astro production build, served under
# /hardware-aware-matmul/ WITHOUT cross-origin-isolation headers (as GitHub Pages would), in
# headless Firefox. Three scenarios, each a fresh browser profile:
#   threads  the page enables isolation through the service worker (one reload), uses the
#            threaded build and every level gives the native answer
#   lite     service workers disabled: the page falls back to the single-threaded build,
#            locks the threads control, shows the banner, and still gives the native answer
#   recover  a run is cancelled, another times out, and a third still completes correctly
# usage: gate-c3.sh [--no-build]
# env: WASM_BINDGEN, NODE_IMAGE (default node:latest), PORT, TIMEOUT (seconds per scenario)
set -euo pipefail
cd "$(dirname "$0")"
SITE=$PWD
WASM=$SITE/../wasm

if [ "${1:-}" = "--no-build" ]; then
  if [ "$(cat "$WASM/pkg/.features" 2>/dev/null || echo unknown)" != "threads" ]; then
    echo "REFUSING: pkg/ was not built for the bundler; run ./gate-c3.sh without --no-build"; exit 1
  fi
  if [ ! -f "$WASM/pkg-lite/hardware_aware_matmul_web.js" ]; then
    echo "REFUSING: pkg-lite/ is missing; run ./gate-c3.sh without --no-build"; exit 1
  fi
else
  (cd "$WASM" && ./build-lite.sh && FEATURES=threads ./build.sh)
fi

mkdir -p "$WASM/target" "$SITE/public"
if ! (cd "$WASM" && cargo run --release --example expected 2> target/expected-build.log) > "$SITE/public/expected.json"; then
  cat "$WASM/target/expected-build.log"
  echo "FAIL: could not generate the expected hashes"
  exit 1
fi

[ -d node_modules ] || ../dev/node.sh site npm ci --no-audit --no-fund
../dev/node.sh site npm run build
../dev/node.sh site npm run check

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
ln -s "$SITE/dist" "$ROOT/hardware-aware-matmul"
export NO_ISOLATION=1
for SCENARIO in threads lite recover; do
  echo "== playground, scenario $SCENARIO"
  export REPORT="$WASM/target/c3-$SCENARIO-report.json" LOG="$WASM/target/c3-$SCENARIO-server.log"
  rm -f "$LOG"
  PREFS=""
  if [ "$SCENARIO" = lite ]; then PREFS='user_pref("dom.serviceWorkers.enabled", false);'; fi
  FIREFOX_PREFS="$PREFS" ../dev/run_page.sh "$ROOT" "hardware-aware-matmul/playground/?gate=$SCENARIO" "${TIMEOUT:-240}" \
    || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
  python3 -I ../dev/check_report.py "playground-$SCENARIO" "$REPORT"
done
echo "GATE C3: ALL SCENARIOS PASS"
````

- [ ] **Step 2: Let `run_page.sh` write Firefox preferences, and teach the report checker the new gates**

In `web/dev/run_page.sh`, replace:

````text
# Serve ROOT, open URLPATH in headless Firefox, wait for the page to POST its
# report, then stop both. Prints nothing; the report is left in $REPORT.
# usage: run_page.sh ROOT URLPATH [TIMEOUT_SECONDS]      env: PORT, REPORT, LOG
set -u
ROOT=$1
````

with:

````text
# Serve ROOT, open URLPATH in headless Firefox, wait for the page to POST its
# report, then stop both. Prints nothing; the report is left in $REPORT.
# usage: run_page.sh ROOT URLPATH [TIMEOUT_SECONDS]      env: PORT, REPORT, LOG, FIREFOX_PREFS
# FIREFOX_PREFS, if set, is written to the throwaway profile's user.js (for example
# 'user_pref("dom.serviceWorkers.enabled", false);' to test a browser without service workers).
set -u
ROOT=$1
````

In `web/dev/run_page.sh`, replace:

````text
SERVER=$!
PROFILE=$(mktemp -d)
firefox --headless --no-remote --profile "$PROFILE" "http://127.0.0.1:$PORT/$URLPATH" >/dev/null 2>&1 &
BROWSER=$!
````

with:

````text
SERVER=$!
PROFILE=$(mktemp -d)
if [ -n "${FIREFOX_PREFS:-}" ]; then printf '%s\n' "$FIREFOX_PREFS" > "$PROFILE/user.js"; fi
firefox --headless --no-remote --profile "$PROFILE" "http://127.0.0.1:$PORT/$URLPATH" >/dev/null 2>&1 &
BROWSER=$!
````

In `web/dev/check_report.py`, replace:

````text
  probe  informational: records whether StdRunner works in the browser
  lite   g2's cases on the stable single-threaded build, on a page that is NOT isolated
  stepthrough  the chapters' <step-through> element on the lite build, from the Astro
         production build, with no isolation and no service worker
````

with:

````text
  probe  informational: records whether StdRunner works in the browser
  lite   g2's cases on the stable single-threaded build, on a page that is NOT isolated
  playground-threads | playground-lite | playground-recover
         the playground page of the Astro production build, on a page with no isolation
         headers: the threaded build after the service worker enables isolation, the
         single-threaded fallback with service workers disabled, and cancel/timeout recovery
  stepthrough  the chapters' <step-through> element on the lite build, from the Astro
         production build, with no isolation and no service worker
````

In `web/dev/check_report.py`, replace:

````text


def main(gate, path):
    report = json.load(open(path))
````

with:

````text


def check_playground(gate, report):
    """Judges a playground run: which build ran, that every level gave the native answer, and
    that cancel and timeout leave the page able to run again."""
    problems = []
    if report.get("base") != "/hardware-aware-matmul/":
        problems.append("wrong base path: %r" % report.get("base"))
    if report.get("unsupported"):
        problems.append("the browser reported no WebAssembly SIMD support")
    expected = report.get("expected_hash")
    if not expected:
        problems.append("no expected hash in the report")
    want_build = "lite" if gate == "playground-lite" else "threads"
    if report.get("build") != want_build:
        problems.append("the page chose the %r build, expected %r" % (report.get("build"), want_build))
    levels = [0, 1, 2, 3, 4]
    if gate in ("playground-threads", "playground-lite"):
        if report.get("status") != "done":
            problems.append("the run ended with status %r" % report.get("status"))
        results = report.get("results", [])
        if [r["level"] for r in results] != levels:
            problems.append("results for levels %r, expected %r" % ([r["level"] for r in results], levels))
        for r in results:
            if r["hash"] != expected:
                problems.append("level %d hash %s differs from the native %s" % (r["level"], r["hash"], expected))
        if report.get("rows") is None or len(report["rows"]) != 5:
            problems.append("the page's table shows %r rows, expected 5" % (None if report.get("rows") is None else len(report["rows"])))
        if not report.get("verdict_ok") or not str(report.get("verdict_text", "")).startswith("\u2713"):
            problems.append("the same-answer verdict is %r" % report.get("verdict_text"))
        table = report.get("table_text") or ""
        for bad in ("NaN", "Infinity", "too fast to time"):
            if bad in table:
                problems.append("the results table shows %r: %r" % (bad, table[:200]))
        env = report.get("env") or {}
        if env.get("isa") != "WASM SIMD128":
            problems.append("the module reports instruction set %r" % env.get("isa"))
    if gate == "playground-threads":
        if (report.get("pool") or 0) < 2:
            problems.append("the thread pool has %r threads" % report.get("pool"))
        if report.get("threads_used") != 2:
            problems.append("the run used %r threads, expected 2" % report.get("threads_used"))
        if (report.get("env") or {}).get("threads") is not True:
            problems.append("the module is not the threaded build")
        if report.get("threads_control_disabled"):
            problems.append("the threads control is disabled in the threaded build")
    if gate == "playground-lite":
        if report.get("service_workers"):
            problems.append("service workers were available; this gate must run with them disabled")
        if report.get("threads_used") != 1:
            problems.append("the lite run used %r threads, expected 1" % report.get("threads_used"))
        if not report.get("threads_control_disabled"):
            problems.append("the threads control should be locked in the lite build")
        if "Single-threaded mode" not in (report.get("banner") or ""):
            problems.append("no single-threaded banner was shown: %r" % report.get("banner"))
        if (report.get("env") or {}).get("threads") is not False:
            problems.append("the module is not the lite build")
    if gate == "playground-recover":
        for key, want in (("cancel_status", "cancelled"), ("timeout_status", "timeout"), ("recovery_status", "done")):
            if report.get(key) != want:
                problems.append("%s is %r, expected %r" % (key, report.get(key), want))
        if report.get("recovery_levels") != levels:
            problems.append("the recovery run covered levels %r" % report.get("recovery_levels"))
        if any(h != expected for h in report.get("recovery_hashes", [])) or not report.get("recovery_hashes"):
            problems.append("the recovery run's hashes are wrong: %r" % report.get("recovery_hashes"))
        if not report.get("verdict_ok"):
            problems.append("the recovery run's same-answer verdict is not ok")
    return problems


def main(gate, path):
    report = json.load(open(path))
````

In `web/dev/check_report.py`, replace:

````text
    if not report.get("ok"):
        problems.append("page reported an error: " + str(report.get("error")))
    if gate in ("lite", "stepthrough"):
        if report.get("isolated"):
            problems.append("the %s gate must run on a page that is NOT cross-origin isolated" % gate)
    elif not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if gate not in ("g5", "lite", "stepthrough") and report.get("pool_threads") != 4:
        problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))
````

with:

````text
    if not report.get("ok"):
        problems.append("page reported an error: " + str(report.get("error")))
    if gate in ("lite", "stepthrough", "playground-lite"):
        if report.get("isolated"):
            problems.append("the %s gate must run on a page that is NOT cross-origin isolated" % gate)
    elif not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if gate not in ("g5", "lite", "stepthrough") and not gate.startswith("playground-") and report.get("pool_threads") != 4:
        problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))
````

In `web/dev/check_report.py`, replace:

````text
    if gate == "stepthrough":
        problems.extend(check_stepthrough(report))

    if gate == "g5":
````

with:

````text
    if gate == "stepthrough":
        problems.extend(check_stepthrough(report))
    if gate.startswith("playground-"):
        problems.extend(check_playground(gate, report))

    if gate == "g5":
````

- [ ] **Step 3: Run the gate**

From `web/site`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"` and port 8765 free (`ss -ltnp | grep 8765`):

```bash
./gate-c3.sh 2>&1 | grep -E "page\(s\)|check-dist|==|GATE|FAIL|REFUS|^ - "
```

It builds both wasm modules and the site (a few minutes cold), then prints `== playground, scenario threads` / `lite` / `recover`, each followed by its `GATE PLAYGROUND-...: PASS`, and finally `GATE C3: ALL SCENARIOS PASS`. The reports are in `web/wasm/target/c3-<scenario>-report.json`. If a scenario says `the page never reported`, check the port first (`ss -ltnp | grep 8765`) and read `web/wasm/target/c3-<scenario>-server.log`; do not weaken the gate. If the `threads` scenario reports the `lite` build, the service worker did not enable isolation: stop and report BLOCKED with the report.

- [ ] **Step 4: Check that the gate can fail**

From the repository root, after Step 3, corrupt copies of the reports (not the sources) seven ways:

```bash
python3 -I - <<'EOF'
import copy, json, subprocess
def load(name): return json.load(open(f'web/wasm/target/c3-{name}-report.json'))
t, l, r = load('threads'), load('lite'), load('recover')
print('threads:', t['build'], t['isolated'], t['pool'], t['threads_used'], t['verdict_text'])
print('lite:', l['build'], l['isolated'], l['service_workers'], l['threads_used'], l['threads_control_disabled'])
print('recover:', r['cancel_status'], r['timeout_status'], r['recovery_status'])
def check(gate, report):
    json.dump(report, open('web/wasm/target/mutated.json', 'w'))
    p = subprocess.run(['python3', '-I', 'web/dev/check_report.py', gate, 'web/wasm/target/mutated.json'], capture_output=True, text=True)
    return p.returncode, [x for x in p.stdout.splitlines() if x.startswith(' - ')][:1]
def mutate(report, **changes):
    report = copy.deepcopy(report); report.update(changes); return report
rows = [
    ('threads, wrong hash', 'playground-threads', mutate(t, results=[dict(x, hash='dead') if x['level'] == 2 else x for x in t['results']])),
    ('threads, wrong build', 'playground-threads', mutate(t, build='lite')),
    ('threads, NaN shown', 'playground-threads', mutate(t, table_text=t['table_text'] + ' NaN')),
    ('lite, control not locked', 'playground-lite', mutate(l, threads_control_disabled=False)),
    ('lite, service workers present', 'playground-lite', mutate(l, service_workers=True)),
    ('recover, no timeout', 'playground-recover', mutate(r, timeout_status='done')),
    ('recover, no recovery', 'playground-recover', mutate(r, recovery_hashes=[])),
]
for label, gate, report in rows:
    print(label, '->', check(gate, report))
EOF
```

Expected: the first three lines show what the real reports say (the threaded build, isolated, a pool, two threads used, the ✓ verdict; the lite build, not isolated, no service workers, one thread, the control locked; `cancelled timeout done`), then seven lines of the form `<label> -> (1, [' - <the reason>'])`: every corruption is rejected with exit code 1 and a specific reason.

- [ ] **Step 5: Check that the other gates still pass**

```bash
(cd web/site && ./gate-g3.sh --no-build 2>&1 | grep -E "GATE|FAIL|REFUS")      # GATE G3: PASS
(cd web/site && ./gate-c2.sh --no-build 2>&1 | grep -E "GATE|FAIL|REFUS")      # GATE STEPTHROUGH: PASS
```

(`gate-c3.sh` built `pkg/` for the bundler, which is what both need.) Then `(cd web/wasm && ./build.sh)` so the plain gates work again.

- [ ] **Step 6: Commit**

```bash
git add web/site/gate-c3.sh web/dev/run_page.sh web/dev/check_report.py
git commit -m "add the playground browser gate"
```

---

### Task 8: Link the playground from the Results page and check it

The Results page gains a short section, `Run it yourself`, whose link to the playground is resolved through the link table (`[playground](crate::playground)`). The output checker gains rules for the playground: the page must exist with its section, load a script, and **that script must reference the service worker** (it is the one reading page that registers it: dropping it would silently disable threads); the Results page must link to the playground. The existing rules still forbid every chapter, including Results, to load or reference the service worker.

**Files:**
- Modify: `docs/paper/results.md`, `web/site/check-dist.mjs`

- [ ] **Step 1: Add the section to the Results page**


In `docs/paper/results.md`, replace:

````text
hash agrees for each size.

# Noise and limits
````

with:

````text
hash agrees for each size.

# Run it yourself

The [playground](crate::playground) runs the same benchmark on your own machine, in your
browser, and reports whether every level gave the same answer.

# Noise and limits
````

- [ ] **Step 2: Add the checker rules**

In `web/site/check-dist.mjs`, replace:

````text
//   - a landing page that is not headed by the site title and subtitle with the abstract
//     under them;
//   - a Results page with an unresolved `{{...}}` placeholder, a count of tables or
//     charts that differs from what site.config.mjs inserts, or a NaN/undefined/
````

with:

````text
//   - a landing page that is not headed by the site title and subtitle with the abstract
//     under them;
//   - a playground page that is missing, has no script, or whose scripts never load the service
//     worker (it is the one reading page that may, so that readers can use the threaded build);
//     and a Results page that does not link to it;
//   - a Results page with an unresolved `{{...}}` placeholder, a count of tables or
//     charts that differs from what site.config.mjs inserts, or a NaN/undefined/
````

In `web/site/check-dist.mjs`, replace:

````text
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, chapters, demos, insertions, siteSubtitle, siteTitle } from './site.config.mjs';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
````

with:

````text
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, chapters, demos, extraPages, insertions, siteSubtitle, siteTitle } from './site.config.mjs';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
````

In `web/site/check-dist.mjs`, replace:

````text
    const wantTables = (inserted.match(/<table class="results"/g) ?? []).length;
    const wantCharts = (inserted.match(/<figure class="chart"/g) ?? []).length;
    if (tables !== wantTables || charts !== wantCharts) {
      problems.push(`${where}: ${tables} tables and ${charts} charts, expected ${wantTables} and ${wantCharts}`);
    }
  }
}
````

with:

````text
    const wantTables = (inserted.match(/<table class="results"/g) ?? []).length;
    const wantCharts = (inserted.match(/<figure class="chart"/g) ?? []).length;
    if (!html.includes(`${base}playground/`)) problems.push(`${where}: does not link to the playground`);
    if (tables !== wantTables || charts !== wantCharts) {
      problems.push(`${where}: ${tables} tables and ${charts} charts, expected ${wantTables} and ${wantCharts}`);
    }
  }
}

// Pages outside the paper's reading order. The playground may register the service worker (one
// reload, to enable multithreading): it is the only reading page that does, so its scripts MUST
// reference it, and nothing else does (the chapters are checked above).
for (const page of extraPages) {
  const file = join(dist, page.route, 'index.html');
  if (!existsSync(file)) {
    problems.push(`${page.route}: page was not built`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  if (!html.includes('id="playground"')) problems.push(`${page.route}: the playground section is missing`);
  const scripts = reachableScripts(html);
  if (scripts.length === 0) problems.push(`${page.route}: loads no script`);
  else if (!scripts.some((s) => /coi-serviceworker/.test(readFileSync(join(dist, '_astro', s), 'utf8')))) {
    problems.push(`${page.route}: its scripts never load the service worker, so the threaded build could not be enabled`);
  }
}
````

- [ ] **Step 3: Build, check, and run the negative controls**

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|page\(s\)"       # 11 page(s) built
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"          # check-dist: PASS (11 pages)
```

Then, editing only the **built output** and restoring `dist` from a copy you take first (inside your scratchpad) after each, run `web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"` and expect `check-dist: FAIL` with the line shown:

```bash
# 1. the Results page without its link to the playground
sed -i 's|/hardware-aware-matmul/playground/|/hardware-aware-matmul/x/|g' web/site/dist/results/index.html
#    expect: - results/: does not link to the playground
# 2. the playground's script without the service worker
f=$(ls web/site/dist/_astro/index.astro_astro_type_script*.js); sed -i 's/coi-serviceworker/coi-serviceXworker/g' $f
#    expect: - playground/: its scripts never load the service worker, so the threaded build could not be enabled
# 3. the section missing
sed -i 's|id="playground"|id="pg"|' web/site/dist/playground/index.html
#    expect: - playground/: the playground section is missing
# 4. the page missing
rm -rf web/site/dist/playground
#    expect: - playground/: page was not built
```

At the end the check must print `check-dist: PASS (11 pages)` again.

- [ ] **Step 4: Commit**

```bash
git add docs/paper/results.md web/site/check-dist.mjs
git commit -m "link the playground from the Results page and check it"
```

---

### Task 9: Document the playground in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Apply the edits**


In `CLAUDE.md`, replace:

````text
## What this is

A teaching-oriented Rust crate (`hardware_aware_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `hardware-aware-matmul`; the crate name is `hardware_aware_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build; both wasm builds enable `+simd128`, so level 3 vectorises in the browser); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). The site is laid out as a paper: abstract (`docs/paper/abstract.md`, the landing page), introduction, methods (the levels), results, and later discussion and conclusion (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`); the Results page is generated from `web/site/src/data/results.json` by `web/site/src/results/` (lookup and renderers), its prose cites numbers only through `{{metric subject selectors}}` placeholders (`{{ms simd n=1024 native}}`, `{{env cpu}}`) that the remark plugin resolves, and one that does not resolve fails the build; `chapters` and `sectionTitles` in `site.config.mjs` give the order and the navigation groups. It renders those pages from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch, on every push to `trunk` (which deploys it, unless the push only touches `docs/superpowers/`) and on pull requests (build only); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

with:

````text
## What this is

A teaching-oriented Rust crate (`hardware_aware_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `hardware-aware-matmul`; the crate name is `hardware_aware_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build; both wasm builds enable `+simd128`, so level 3 vectorises in the browser); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). The site is laid out as a paper: abstract (`docs/paper/abstract.md`, the landing page), introduction, methods (the levels), results, and later discussion and conclusion (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`); the Results page is generated from `web/site/src/data/results.json` by `web/site/src/results/` (lookup and renderers), its prose cites numbers only through `{{metric subject selectors}}` placeholders (`{{ms simd n=1024 native}}`, `{{env cpu}}`) that the remark plugin resolves, and one that does not resolve fails the build. `/playground/` (`web/site/src/playground/`) lets readers run the benchmark on their own machine: pure, unit-tested modules (`request.mjs` clamps every request and sets the time budget, `summary.mjs`, `isolation.mjs` decides threaded or lite, `batching.mjs` times short runs on a coarse clock, `controller.mjs` is the worker protocol with cancel and timeout by terminating the worker), `worker.js` (owns the wasm module), `ui.js`, `main.js` and `gate.js`; it is the ONLY reading page that registers the service worker (one reload, to enable threads), which is why it is an `extraPages` entry and not a chapter; `chapters` and `sectionTitles` in `site.config.mjs` give the order and the navigation groups. It renders those pages from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch, on every push to `trunk` (which deploys it, unless the push only touches `docs/superpowers/`) and on pull requests (build only); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

In `CLAUDE.md`, replace:

````text
cargo run --release --example bench -- --sizes 512,1024   # the native half of the reference run (JSON on stdout; web/dev/bench-reference.sh runs everything)
./bench-browser.sh lite|threads OUT.json                  # one browser build of the reference run (needs pkg-lite/ or pkg/)
(cd ../site && ./gate-c2.sh [--no-build])       # the step-through element from the production build, on a page with no isolation and no service worker
(cd ../site && ./gate-g3.sh [--no-build])       # Astro production build (Node in Docker) served under /hardware-aware-matmul/ with no isolation headers; coi-serviceworker supplies them
````

with:

````text
cargo run --release --example bench -- --sizes 512,1024   # the native half of the reference run (JSON on stdout; web/dev/bench-reference.sh runs everything)
./bench-browser.sh lite|threads OUT.json                  # one browser build of the reference run (needs pkg-lite/ or pkg/)
(cd ../site && ./gate-c3.sh [--no-build])       # the playground from the production build in three scenarios: threaded after the service worker enables isolation, the lite fallback with service workers disabled (FIREFOX_PREFS in web/dev/run_page.sh), and cancel/timeout recovery
(cd ../site && ./gate-c2.sh [--no-build])       # the step-through element from the production build, on a page with no isolation and no service worker
(cd ../site && ./gate-g3.sh [--no-build])       # Astro production build (Node in Docker) served under /hardware-aware-matmul/ with no isolation headers; coi-serviceworker supplies them
````

- [ ] **Step 2: Verify**

```bash
grep -n "gate-c3.sh\|/playground/\|extraPages" CLAUDE.md | cut -c1-120
```

Expected: at least two lines (the paragraph in "What this is" and the Commands entry).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "document the playground in CLAUDE.md"
```

---

## After this plan

If every task passes, the site has a playground at `/playground/` that runs the benchmark on the reader's own machine, threaded after one reload when the browser allows it and single-threaded otherwise, with cancel and timeout recovery proven in a real browser. Merging deploys it (the push trigger). Remaining for the paper: **P3**, the Discussion, the Conclusion and the final abstract, which explain what the Results show; the Results page's mention of "the Discussion" still points at a page that does not exist.
