# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. Commands and process are in
[`CONTRIBUTING.md`](CONTRIBUTING.md); the website's internals are in
[`web/README.md`](web/README.md). This file keeps only what you must know to avoid a
wrong change.

## What this is

A teaching-oriented Rust crate (`hardware_aware_matmul`, no dependencies,
`#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as
five levels of increasing performance. The repo directory is `hardware-aware-matmul`; the
crate name is `hardware_aware_matmul`.

- `src/`, `tests/`, `examples/`: the crate.
- `docs/`: Markdown that rustdoc includes (`levels/`, `guide/`, `design/`,
  `introduction.md`), the paper's own pages (`paper/`), and website plans and specs
  (`superpowers/`).
- `anim/`: Manim animations, one scene per level. Not part of the build.
- `web/`: browser tooling, excluded from the published crate. `web/wasm` wraps the
  levels for WebAssembly (separate crate, nightly pinned), `web/dev` is dev tooling, and
  `web/site` is the Astro site. Node runs only in Docker, through `web/dev/node.sh`.

## Core invariant

Every level returns bit-for-bit identical results, because each output element is summed in
increasing-`k` order starting from zero. `tests/levels.rs` compares the raw bits
(`to_bits`) of all five levels, on small-integer operands and on order-sensitive
`rough_operands`, across several `BlockConfig` values. Any optimisation must preserve
per-element summation order: don't introduce reassociation, FMA changes, or split
accumulators over `k`.

## Architecture

Levels: `naive` (0) → `threaded` (1) → `cache_friendly` (2) → `simd` (3) → `streaming` (4).
Levels reuse each other rather than being independent (see `docs/design/architecture.md`):

- `threaded.rs` owns `row_block_plan` (the row partition) and the row-block driver
  `multiply_by_row_blocks`, which builds one boxed job per block and hands the batch to a
  `Runner`. Levels 2 and 3 reuse the driver with a different kernel passed as a closure.
- `runner.rs` holds the `Runner` trait (`run(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>)`;
  it must run every job and return only when all are done) and `StdRunner`
  (`std::thread::scope`, the default; it traps on `wasm32-unknown-unknown`). Levels 1 to 3
  each have `matmul_with_runner` (one job per row block) and level 4 has
  `matmul_streaming_with_runner` (one job per worker, each claiming tiles from a shared
  counter); the plain functions delegate with `StdRunner`. A runner changes where jobs run,
  never what they compute. Its docs are `docs/design/runner.md`, a module doc rather than a
  `design` page.
- `cache_friendly.rs` owns `axpy`, the default cache-block constants and `BlockConfig`
  (runtime cache-block sizes, also taken by `simd.rs` and `StreamConfig`).
- `simd.rs` holds the register-blocked micro-kernel. Level 4 does *not* use it:
  `streaming/kernel.rs` is level 2's `axpy` kernel on flat buffers. Vectorisation comes from
  the auto-vectoriser, not intrinsics (hence no `unsafe`). The micro-tile `MR`×`NR` is a
  compile-time constant.
- `streaming/` splits partitioning from kernel: `tile.rs` (`TileSource`/`TileSink` traits;
  `Matrix` implements `TileSource`; `MemorySink`), `file.rs` (`FileMatrix`, disk-backed,
  `cfg(any(unix, windows))`), `multiply.rs` (`StreamConfig`, `matmul_streaming`,
  `tile_plan`, work queue), and private `kernel.rs` (`accumulate_tile`). Peak buffer memory
  depends on tile shape × thread count, not matrix size.
- `matrix.rs` (row-major `Matrix`) and `error.rs` (`MatmulError`, shared dimension check)
  are used by every level.

The wasm crate and the site depend on this shape: `web/wasm` calls the `_with_runner`
functions with its own runners. Nightly and wasm dependencies live only in `web/wasm`.

## Documentation rules

- **Prose lives in Markdown, not in the `.rs` files.** Each level module's doc comment is
  `include_str!`'d from `docs/levels/*.md` (`lib.rs` from `docs/introduction.md`). Edit
  `docs/` to change module docs; its code blocks are doctests.
- `lib.rs` declares `#[cfg(any(doc, doctest))] pub mod design / guide;`, whose submodules
  (`src/design/`, `src/guide/`) just `#![doc = include_str!(...)]` the pages under `docs/`.
  Only `design/architecture.md`, `guide/getting_started.md` and `guide/in_memory.md` exist.
  Don't link to pages that don't (`tuning`, `errors`, `numerics`, and so on).
- `docs/paper/` is the paper's own pages. The site renders them but rustdoc does not.
  Their figures are `{{...}}` placeholders filled from `results.json`, never typed.
  `docs/introduction.md` is the crate's rustdoc front page and is not on the site.
- `docs/superpowers/` holds specs, plans and findings for the website work. It is not
  product documentation (excluded from the package), so don't glob `docs/**`.
- **Benchmark numbers never appear in prose by hand.** They are generated data,
  `web/site/src/data/results.json`, written by `web/dev/bench-reference.sh` (run by hand on
  an idle machine) and refused by `web/dev/results.py` unless every run produced the same
  result hash. Paper prose cites them through `{{...}}` placeholders; a placeholder that
  doesn't resolve fails the build, and `claims.test.mjs` fails when a run flips a claim the
  prose states in words. Reword the prose when that happens, never the data.
- Always benchmark with `--release`.

## Website gotchas

- `site.config.mjs` holds the link-rewriting table (a rustdoc link not in it fails the
  build), `chapters`, `sectionTitles` and the `demos` list.
- Gate pages and the gate driver exist only in `GATE=1` builds. Production must never
  contain them (`npm run check` fails if it does).
- Only the playground registers the service worker, scoped to `playground/`. The root
  `coi-serviceworker.js` in production is a kill-switch for old registrations: keep it a few
  months, then delete it and its check. Details in `web/README.md`.
- Astro caches rendered docs by Markdown, not by plugin; `npm run build` clears the cache
  first, so a plugin change is not silently ignored.
- `WASM_BINDGEN_VERSION` in `.github/workflows/pages.yml` must track the `=0.2.130` pin in
  `web/wasm/Cargo.toml`.

## Notes

- Trunk branch is `trunk`; the root `Cargo.lock` is gitignored (`web/wasm/Cargo.lock` is
  tracked).
- Commit only when asked. Keep commits small, with short one-line messages.
