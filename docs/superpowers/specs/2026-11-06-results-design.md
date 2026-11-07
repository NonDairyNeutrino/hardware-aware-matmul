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

As in the stage C spec: a Web Worker owns the wasm module; run requests stream one
result per level; every request has a timeout and, on timeout or Cancel, the worker is
terminated and a fresh one started; the isolation state machine uses the threaded
build when `crossOriginIsolated`, otherwise registers `coi-serviceworker` (reloading
once) and, if still not isolated, falls back to the lite build with threads capped at 1.
It lives at the bottom of the Results page, headed "run it on your machine", reports a
"same answer" indicator that is true only if every selected level returned the same
hash, and uses the Bench API above. Pages must be served over HTTPS (the Pages setting
"Enforce HTTPS") for the service worker to register.

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
