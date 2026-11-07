# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A teaching-oriented Rust crate (`hardware_aware_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `hardware-aware-matmul`; the crate name is `hardware_aware_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build; both wasm builds enable `+simd128`, so level 3 vectorises in the browser); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). The site is laid out as a paper: abstract (`docs/paper/abstract.md`, the landing page), introduction, methods (the levels), results, and later discussion and conclusion (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`); the Results page is generated from `web/site/src/data/results.json` by `web/site/src/results/` (lookup and renderers), its prose cites numbers only through `{{metric subject selectors}}` placeholders (`{{ms simd n=1024 native}}`, `{{env cpu}}`; also `{{env l1d|l2|l3|triad_max|peak_max}}`, the hardware probe's `{{triad t=N}}` (GB/s) and `{{peak t=N}}` (the rate of an arithmetic test loop, GFLOP/s), and `{{frac LEVEL ...}}`, a level's native throughput as a share of that rate; the full grammar is the header of `web/site/src/results/lookup.mjs`) that the remark plugin resolves, and one that does not resolve fails the build. Times print through `formatMs`: whole milliseconds below 10 s, seconds with one decimal from 10 s. A placeholder keeps a number current but not a sentence true: `web/site/src/results/claims.test.mjs` checks every ranking and margin the prose states in words against the committed `results.json`, so after a new reference run (`bench-reference.sh`) a failing claim there means the run flipped it: reword the prose (and the test), never the data. The site's `chapters` and `sectionTitles` in `site.config.mjs` give the order and the navigation groups, and it renders those pages from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `/playground/` (`web/site/src/playground/`) lets readers run the benchmark on their own machine: pure, unit-tested modules (`request.mjs` clamps every request and sets the time budget, `summary.mjs`, `isolation.mjs` decides threaded or lite, `batching.mjs` times short runs on a coarse clock, `controller.mjs` is the worker protocol with cancel and timeout by terminating the worker), `worker.js` (owns the wasm module), `ui.js`, `main.js` and `gate.js`; it is the ONLY reading page that registers the service worker (one reload, to enable threads), which is why it is an `extraPages` entry and not a chapter. After one playground visit the service worker (scope: the site root) also controls the chapter pages, though no chapter loads or registers it. `.github/workflows/pages.yml` builds the site on manual dispatch, on every push to `trunk` (which deploys it, unless the push only touches `docs/superpowers/`) and on pull requests (build only); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands

```sh
cargo build
cargo test                              # unit + integration + doc tests (CI runs build + test, plus an MSRV 1.73 build and a wasm32 library check)
cargo test --test levels                # one integration test file (tests/levels.rs or tests/streaming.rs)
cargo test <name>                       # single test by name substring
cargo run --release                     # `compare` bin (default-run): times all levels; args: [n] [threads]
cargo run --release -- 1024 8
cargo run --release --bin out_of_core   # level 4 on file-backed matrices
RUSTFLAGS="-C target-cpu=native" cargo run --release   # let level 3 auto-vectorise with all CPU features
```

```sh
# web/wasm only (pinned nightly; the core crate stays on stable / 1.73)
cd web/wasm && cargo test                       # native tests of the shared case generator and the plan JSON (add --features threads for the rayon tests)
./build-lite.sh                                 # stable, single-threaded build into pkg-lite/ (no nightly, no threads)
export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"   # CLI version must equal the =0.2.130 pin; build.sh and build-lite.sh (so every gate) default to this path when wasm-bindgen is not on PATH
./gate.sh g1|g2|probe|g5|lite [--no-build]      # build, then run a gate in headless Firefox; --no-build reuses pkg/ (pkg-lite/ for lite)
cargo run --release --example bench -- --sizes 512,1024   # the native half of the reference run (JSON on stdout; web/dev/bench-reference.sh runs everything)
./bench-browser.sh lite|threads OUT.json                  # one browser build of the reference run (needs pkg-lite/ or pkg/)
(cd ../site && ./gate-c3.sh [--no-build])       # the playground from the production build in three scenarios: threaded after the service worker enables isolation, the lite fallback with service workers disabled (FIREFOX_PREFS in web/dev/run_page.sh), and cancel/timeout recovery
(cd ../site && ./gate-c2.sh [--no-build])       # the step-through element from the production build, on a page with no isolation and no service worker
(cd ../site && ./gate-g3.sh [--no-build])       # Astro production build (Node in Docker) served under /hardware-aware-matmul/ with no isolation headers; coi-serviceworker supplies them
```

```sh
# from the repo root
python3 -I web/dev/test_results.py              # unit tests of the results assembler
web/dev/bench-reference.sh                      # the reference run (idle machine; SIZES/THREADS/REPEATS/OUT env for rehearsals)
web/dev/node.sh site npm test                   # unit tests of the prose plugin, the step-through's model, the results lookup and renderers and the playground modules (request clamping, summary, isolation decision, batching, worker controller)
web/dev/node.sh site npm run build              # the site into web/site/dist (needs ./build-lite.sh and FEATURES=threads ./build.sh first, and public/expected.json for the gate page; the gate scripts do all three)
web/dev/node.sh site npm run check              # checks the built site (no crate::, one <h1>, chapters never load or register the service worker, demos match site.config.mjs, chapters without a demo load no script; the playground page must load the service worker script and the Results prose must link it, chapters must not)
```

Always benchmark with `--release`. Benchmark numbers never appear in prose by hand: only as generated data, `web/site/src/data/results.json`, written by the reference run `web/dev/bench-reference.sh` (native plus headless Firefox, lite and threaded; run by hand on an otherwise idle machine, then commit the file) and refused by `web/dev/results.py` unless every run produced the same result hash. The reference run also runs `cargo run --release --example hw_probe -- --threads 1,2,4,8` (root `examples/hw_probe.rs`: STREAM-style triad bandwidth and register-only no-FMA peak GFLOP/s per thread count, as one JSON object) and `results.py` records it as the optional `environment.hardware`, plus the optional `environment.caches` read from Linux sysfs; older files have neither and still validate. The wasm bench API (`bench_prepare`/`bench_multiply`/`bench_hash`, over `cases::Bench`) times the multiplication alone.

Animations: `manim -ql anim/<file>.py <SceneClass>` (output lands in `anim/media/`, whose generated `Tex/`, `texts/`, and `partial_movie_files/` are untracked).

## Architecture

Levels: `naive` (0) → `threaded` (1) → `cache_friendly` (2) → `simd` (3) → `streaming` (4). Each module's doc comment is a chapter of the "story" and is `include_str!`'d from `docs/levels/*.md` (and `lib.rs` from `docs/introduction.md`), so **prose lives in Markdown, not in the `.rs` files**. Edit `docs/` to change module docs; its code blocks are doctests.

**Core invariant:** every level returns bit-for-bit identical results, because each output element is summed in increasing-`k` order starting from zero. `tests/levels.rs` compares the raw bits (`to_bits`) of all five levels, on small-integer operands and on order-sensitive `rough_operands`, across several `BlockConfig` values. Any optimisation (reordering, blocking, vectorisation) must preserve per-element summation order — don't introduce reassociation, FMA changes, or split accumulators over `k`.

Levels reuse each other rather than being independent (see `docs/design/architecture.md`):
- `threaded.rs` owns `row_block_plan` (the row partition) and the row-block driver `multiply_by_row_blocks`, which builds one boxed job per block and hands the batch to a `Runner`. Levels 2 and 3 reuse the driver with a different kernel passed as a closure.
- `runner.rs` holds the `Runner` trait (`run(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>)`; it must run every job and return only when all are done) and `StdRunner` (`std::thread::scope`, the default; it traps on `wasm32-unknown-unknown`). Levels 1 to 3 each have `matmul_with_runner` (one job per row block) and level 4 has `matmul_streaming_with_runner` (one job per worker, each claiming tiles from a shared counter); the plain functions delegate with `StdRunner`. A runner changes where jobs run, never what they compute. Its docs live in `docs/design/runner.md`, a module doc rather than a `design` page.
- `cache_friendly.rs` owns `axpy`, the default cache-block constants and `BlockConfig` (runtime cache-block sizes, also taken by `simd.rs` and `StreamConfig`).
- `simd.rs` holds the register-blocked micro-kernel (level 4 does *not* use it: `streaming/kernel.rs` is level 2's `axpy` kernel on flat buffers); vectorisation comes from the auto-vectoriser, not intrinsics (hence no `unsafe`). The micro-tile `MR`×`NR` is a compile-time constant.
- `streaming/` is split into partitioning vs kernel: `tile.rs` (`TileSource`/`TileSink` traits; `Matrix` implements `TileSource`; `MemorySink`), `file.rs` (`FileMatrix`, disk-backed, `cfg(any(unix, windows))`), `multiply.rs` (`StreamConfig`, `matmul_streaming`, `tile_plan`, work queue), and private `kernel.rs` (`accumulate_tile`, level 2/3's kernel on flat buffers). Peak buffer memory depends on tile shape × thread count, not matrix size.
- `matrix.rs` (row-major `Matrix`) and `error.rs` (`MatmulError`, shared dimension check) are used by every level.

## Docs layout

`lib.rs` declares `#[cfg(any(doc, doctest))] pub mod design / guide;`, whose submodules (`src/design/`, `src/guide/`) just `#![doc = include_str!(...)]` the Markdown pages under `docs/`. Only `design/architecture.md`, `guide/getting_started.md` and `guide/in_memory.md` exist; pages the older prose referred to (`out_of_core`, `custom_io`, `tuning`, `errors`, `cost_model`, `numerics`, `reference/*`) were never written and their links were removed. The source (five levels, `simd` = 3, `streaming` = 4) is authoritative.

## Notes

- Trunk branch is `trunk`; `Cargo.lock` is gitignored.
- `docs/paper/` holds the paper's own pages (abstract, introduction, results, discussion and conclusion; their figures are `{{...}}` placeholders filled from `results.json`, never typed); the site renders them but rustdoc does not include them. The site's Introduction is `docs/paper/introduction.md`; `docs/introduction.md` is the crate's rustdoc front page and is not rendered on the site. `docs/superpowers/` holds specs, plans and findings for the website work. It is not product documentation (excluded from the package), so don't glob `docs/**`. Astro caches rendered docs in `web/site/node_modules/.astro` keyed by the Markdown, not by the plugin, so `npm run build` clears it first (a plugin change would otherwise be silently ignored). Nightly and wasm dependencies live only in `web/wasm`; the core crate stays dependency-free, `forbid(unsafe_code)` and MSRV 1.73.
