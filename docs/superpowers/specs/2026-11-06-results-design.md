# The Results Section: Reference Run, Placeholders, Results Page, Playground

Status: design approved in conversation, 2026-11-06. Refines stage P2 of
`2026-11-06-paper-structure-design.md` and absorbs the playground of
`2026-11-05-stage-c-site-design.md` (plan C3).

## Goal

Add the **Results** section to the paper: benchmarks of each level, native and in the
browser, that the Discussion (P3) can compare. Numbers never appear in the prose by
hand: they are generated data, cited through placeholders, produced by a reference run
on a stated machine, and reproducible by any reader through a playground.

## Decisions (from the owner, in conversation)

| Question | Decision |
|---|---|
| Source of the numbers | A committed **reference run** plus a **live playground** (readers reproduce it on their own machine). |
| Where numbers may appear | Only as generated data, through `{{...}}` placeholders; never typed in Markdown. |
| Browser timings | Indicative; reported next to native ones, never merged with them. |

## What is measured

- **Workload:** the product of two `n x n` matrices of the crate's order-sensitive
  "rough" operands (the same generator native and in the browser), `n` in `{512, 1024}`,
  levels 0 to 4, threads in `{1, 2, 4, 8}` capped at the machine's cores (level 0 is
  single-threaded whatever the setting). Level 4 uses fixed 128 x 128 x 128 tiles, the
  cache blocks are the crate defaults.
- **Timed region:** the multiplication only. The operands are built once per `n`
  beforehand and the result is hashed afterwards, outside the timer. (Inside the
  browser the timer is `performance.now()` around the call; natively `Instant`.)
- **Repeats:** one discarded warm-up, then at least 5 timed runs (the committed run uses 9 after 2 warm-ups, so that the median survives a few slow outliers); the median, minimum and
  maximum are recorded, and the interquartile range is the measure of noise to show, since one slow outlier dominates max minus min. GFLOP/s is `2 n^3 / median`.
- **Integrity check (the project's thesis, as data):** every measured run also records
  the FNV hash of the result's bits. For one `n`, **every level, thread count, native
  and browser run must give the same hash**. The assembler refuses to write
  `results.json` otherwise.
- **Environments recorded:** CPU model, logical cores, OS, `rustc -V` (recorded per build: the pinned nightly for the native and threaded builds, stable for the lite build), the wasm-bindgen CLI version and wasm target features, physical cores, the CPU governor, AC power and the starting load average, the Firefox
  version, the git commit, the build flags and the date. Native and in-browser results
  are separate sections of the file; in the browser the **lite** (single-threaded) and
  **threaded** (pool of `min(cores, 8)`) builds are separate too.

## Design

### Bench API (shared by the reference run and the playground)

In `web/wasm`, `cases.rs` gains `Bench`: it holds the prepared operands and the last
result. `prepare(n)` builds the operands (`n` in `1..=2048`); `multiply(level, threads,
block, tile_shape, runner)` multiplies them and stores the result; `hash()` hashes the
stored result. The wasm exports (both builds) are `bench_prepare(n)`,
`bench_multiply(level, threads, tile_k, tile_j, tile_rows, tile_cols, tile_depth)` and
`bench_hash()`, over a thread-local `Bench` (the lite build runs jobs inline, the
threaded build on the rayon pool). Every argument is validated and returns an error,
never panics. The existing gate functions (`run_case`) are unchanged.

### The reference run

A manual process, not CI (shared CI machines are too noisy to trust for timing):

1. `examples/bench.rs` times the levels natively with `Instant` and `StdRunner` and
   prints JSON.
2. A bench page and worker (`www/bench.html`) run the same matrix of cases in headless
   Firefox for the lite and the threaded build and post JSON.
3. `web/dev/results.py` merges both with the recorded environment, checks the integrity
   rule above, and writes `web/site/src/data/results.json` (committed, schema version 1).
4. `web/dev/bench-reference.sh` runs the whole thing; its parameters can be reduced
   (sizes, repeats, thread counts) through environment variables so the pipeline can be
   tested quickly. Only a full-size run produces the committed file.

### Placeholders and the Results page (plan P2b)

- Prose cites figures with placeholders such as `{{speedup simd/naive n=1024 native}}`
  (the grammar is documented in CLAUDE.md and in the header of
  `web/site/src/results/lookup.mjs`).
  The remark plugin fills each from `results.json` at build time; **a placeholder whose
  key does not resolve fails the build**, like an unlisted link does.
- `docs/paper/results.md` introduces the method and each table; Astro components render
  tables and charts (time, GFLOP/s, speedup, thread scaling, native against browser)
  from the data, with the machine and date shown next to them and a note that browser
  timings are indicative.

### The playground (plan P2c)

**Placement (decided with the owner):** its own page, `/playground/`, linked from the
Results page and the navigation, and **not** a chapter. Enabling multithreading on GitHub
Pages needs a service worker and one reload; keeping that on a separate page means readers
of the paper never see a reload. The playground is therefore the only reading page that
registers the service worker (the output checker enforces that it does, and that no
chapter does).

- **Worker:** a Web Worker owns the wasm module and the thread pool (`min(cores, 8)`,
  fixed for the worker's life); the page never calls wasm directly. A run request streams
  back `ready`, one `result` per level (its times, hash and batch size), then `done`.
- **Recovery:** a wasm call cannot be interrupted and a panic in the pool hangs the
  caller, so Cancel, a timeout and an error all end the same way: terminate the worker and
  start a fresh one on the next run. Every run has a time budget derived from the size,
  the levels and the repeats.
- **Isolation state machine** (a pure, tested function): `crossOriginIsolated` uses the
  threaded build; otherwise, once per tab, load `coi-serviceworker` (which reloads the page
  once); if the page is still not isolated, or service workers are missing, fall back to
  the lite build with threads locked to 1 and a banner saying why. A browser without
  WebAssembly SIMD gets a message instead of a broken page.
- **Requests are clamped** in shared code used by both the page and the worker: sizes are
  64 to 1024 (powers of two), repeats 1, 3 or 5, threads up to the pool (8), cache blocks
  and tiles 1 to 1024. Nothing in the URL or the form can make the worker do unbounded work.
- **Timing:** a page that is not cross-origin isolated has a clock rounded to about a
  millisecond, so short runs are timed in batches of runs (at least 30 ms per sample) and
  divided; a time of zero never becomes an infinite throughput.
- **Output:** per level the median, throughput, speedup over level 0 and over the
  previous level, and a bar; the build in use (threaded with its pool, or single-threaded;
  instruction set and micro-tile); a "same answer" verdict that is true only if every
  selected level returned the same hash, and that also compares with the reference run's
  hash when the size matches; and the note that browser timings are indicative.
- **Gates:** `web/site/gate-c3.sh` drives the production build in headless Firefox on a
  page without isolation headers in three scenarios: threaded after the service worker
  enables isolation, the lite fallback with service workers disabled, and cancel and
  timeout recovery. HTTPS is enforced on Pages (it is required for the service worker).

## Plans

- **P2a, data:** the Bench type and wasm exports, the native bench example, the browser
  bench page and runner, the assembler with its tests, the orchestration script, and
  the first committed `results.json` from a full run.
- **P2b, results:** the placeholder mechanism in the plugin (with tests), the Results
  page (prose, tables, charts), the navigation entry, the output checker.
- **P2c, playground:** the worker and protocol, the isolation state machine and
  fallback, gates for the threaded and fallback paths, the page section.

## Risks

- Timing noise: run on an otherwise idle machine, record the environment, keep the
  median of five.
- A very slow level 0 in the browser at `n = 1024`: each browser build has one overall
  timeout, generous because the run is offline (the per-request timeouts belong to the playground, plan P2c).
- Results describe one machine; the Results page and the Discussion say so.
- `results.json` is committed data that changes only when someone re-runs the reference
  run; its commit message records why.
