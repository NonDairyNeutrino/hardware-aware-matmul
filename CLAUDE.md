# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A teaching-oriented Rust crate (`naive_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `matmul_levels.rs`; the crate name is `naive_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner`; `web/dev/` holds a stdlib-only dev server and a headless-Firefox page runner.

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
cd web/wasm && cargo test                       # native tests of the shared case generator
export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"   # CLI version must equal the =0.2.130 pin
./gate.sh g1|g2|probe [--no-build]              # build, then run a gate in headless Firefox; --no-build reuses pkg/
```

Always benchmark with `--release`. The docs deliberately contain no benchmark numbers.

Animations: `manim -ql anim/<file>.py <SceneClass>` (output lands in `anim/media/`, whose generated `Tex/`, `texts/`, and `partial_movie_files/` are untracked).

## Architecture

Levels: `naive` (0) → `threaded` (1) → `cache_friendly` (2) → `simd` (3) → `streaming` (4). Each module's doc comment is a chapter of the "story" and is `include_str!`'d from `docs/levels/*.md` (and `lib.rs` from `docs/introduction.md`), so **prose lives in Markdown, not in the `.rs` files**. Edit `docs/` to change module docs; its code blocks are doctests.

**Core invariant:** every level returns bit-for-bit identical results, because each output element is summed in increasing-`k` order starting from zero. `tests/levels.rs` compares the raw bits (`to_bits`) of all five levels, on small-integer operands and on order-sensitive `rough_operands`, across several `BlockConfig` values. Any optimisation (reordering, blocking, vectorisation) must preserve per-element summation order — don't introduce reassociation, FMA changes, or split accumulators over `k`.

Levels reuse each other rather than being independent (see `docs/design/architecture.md`):
- `threaded.rs` owns `row_block_plan` (the row partition) and the row-block driver `multiply_by_row_blocks`, which builds one boxed job per block and hands the batch to a `Runner`. Levels 2 and 3 reuse the driver with a different kernel passed as a closure.
- `runner.rs` holds the `Runner` trait (`run(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>)`; it must run every job and return only when all are done) and `StdRunner` (`std::thread::scope`, the default; it traps on `wasm32-unknown-unknown`). Levels 1 to 3 each have `matmul_with_runner`; the plain functions delegate with `StdRunner`. A runner changes where jobs run, never what they compute. Level 4 has its own worker loop and takes no `Runner` yet. Its docs live in `docs/design/runner.md`, a module doc rather than a `design` page.
- `cache_friendly.rs` owns `axpy`, the default cache-block constants and `BlockConfig` (runtime cache-block sizes, also taken by `simd.rs` and `StreamConfig`).
- `simd.rs` holds the register-blocked micro-kernel (level 4 does *not* use it: `streaming/kernel.rs` is level 2's `axpy` kernel on flat buffers); vectorisation comes from the auto-vectoriser, not intrinsics (hence no `unsafe`). The micro-tile `MR`×`NR` is a compile-time constant.
- `streaming/` is split into partitioning vs kernel: `tile.rs` (`TileSource`/`TileSink` traits; `Matrix` implements `TileSource`; `MemorySink`), `file.rs` (`FileMatrix`, disk-backed, `cfg(any(unix, windows))`), `multiply.rs` (`StreamConfig`, `matmul_streaming`, `tile_plan`, work queue), and private `kernel.rs` (`accumulate_tile`, level 2/3's kernel on flat buffers). Peak buffer memory depends on tile shape × thread count, not matrix size.
- `matrix.rs` (row-major `Matrix`) and `error.rs` (`MatmulError`, shared dimension check) are used by every level.

## Docs layout

`lib.rs` declares `#[cfg(any(doc, doctest))] pub mod design / guide;`, whose submodules (`src/design/`, `src/guide/`) just `#![doc = include_str!(...)]` the Markdown pages under `docs/`. Only `design/architecture.md`, `guide/getting_started.md` and `guide/in_memory.md` exist; pages the older prose referred to (`out_of_core`, `custom_io`, `tuning`, `errors`, `cost_model`, `numerics`, `reference/*`) were never written and their links were removed. The source (five levels, `simd` = 3, `streaming` = 4) is authoritative.

## Notes

- Trunk branch is `trunk`; `Cargo.lock` is gitignored.
- `docs/superpowers/` holds specs, plans and findings for the website work. It is not product documentation (excluded from the package), so don't glob `docs/**`. Nightly and wasm dependencies live only in `web/wasm`; the core crate stays dependency-free, `forbid(unsafe_code)` and MSRV 1.73.
