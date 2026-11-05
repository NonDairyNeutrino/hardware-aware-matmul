# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A teaching-oriented Rust crate (`naive_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `matmul_levels.rs`; the crate name is `naive_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels.

## Commands

```sh
cargo build
cargo test                              # unit + integration + doc tests (CI runs build + test only)
cargo test --test levels                # one integration test file (tests/levels.rs or tests/streaming.rs)
cargo test <name>                       # single test by name substring
cargo run --release                     # `compare` bin (default-run): times all levels; args: [n] [threads]
cargo run --release -- 1024 8
cargo run --release --bin out_of_core   # level 4 on file-backed matrices
RUSTFLAGS="-C target-cpu=native" cargo run --release   # let level 3 auto-vectorise with all CPU features
```

Always benchmark with `--release`. The docs deliberately contain no benchmark numbers.

Animations: `manim -ql anim/<file>.py <SceneClass>` (output lands in `anim/media/`, whose generated `Tex/`, `texts/`, and `partial_movie_files/` are untracked).

## Architecture

Levels: `naive` (0) → `threaded` (1) → `cache_friendly` (2) → `simd` (3) → `streaming` (4). Each module's doc comment is a chapter of the "story" and is `include_str!`'d from `docs/levels/*.md` (and `lib.rs` from `docs/introduction.md`), so **prose lives in Markdown, not in the `.rs` files**. Edit `docs/` to change module docs; its code blocks are doctests.

**Core invariant:** every level returns bit-for-bit identical results, because each output element is summed in increasing-`k` order starting from zero. `tests/levels.rs` asserts exact equality across all levels. Any optimisation (reordering, blocking, vectorisation) must preserve per-element summation order — don't introduce reassociation, FMA changes, or split accumulators over `k`.

Levels reuse each other rather than being independent (see `docs/design/architecture.md`):
- `threaded.rs` owns the row-block partitioning + scoped-thread driver, which levels 2 and 3 reuse with a different kernel.
- `cache_friendly.rs` owns `axpy` and the cache-block size constants, reused by `simd.rs` and `streaming`.
- `simd.rs` holds the register-blocked micro-kernel that level 4 reuses; vectorisation comes from the auto-vectoriser, not intrinsics (hence no `unsafe`).
- `streaming/` is split into partitioning vs kernel: `tile.rs` (`TileSource`/`TileSink` traits; `Matrix` implements `TileSource`; `MemorySink`), `file.rs` (`FileMatrix`, disk-backed, `cfg(any(unix, windows))`), `multiply.rs` (`StreamConfig`, `matmul_streaming`, work queue), and private `kernel.rs` (`accumulate_tile`, level 2/3's kernel on flat buffers). Peak buffer memory depends on tile shape × thread count, not matrix size.
- `matrix.rs` (row-major `Matrix`) and `error.rs` (`MatmulError`, shared dimension check) are used by every level.

## Known issue

`lib.rs` declares `#[cfg(any(doc, doctest))] pub mod design / guide / reference;`, but `src/design.rs`, `src/guide.rs`, `src/reference.rs` do not exist yet, and `docs/reference/` is empty (only `design/architecture.md`, `guide/getting_started.md`, `guide/in_memory.md` exist). Normal `cargo build`/`cargo test` skip these, but `cargo doc` and `cargo test --doc` will fail to compile until they're added (they should just `#![doc = include_str!(...)]` the Markdown pages). The README and `architecture.md` also describe a "four implementations / level 3 = streaming" numbering and pages (`cost_model`, `concurrency`, `numerics`, etc.) that predate/exceed what is on disk; the source (five levels, `simd` = 3) is authoritative.

## Notes

- Trunk branch is `trunk`; `Cargo.lock` is gitignored.
