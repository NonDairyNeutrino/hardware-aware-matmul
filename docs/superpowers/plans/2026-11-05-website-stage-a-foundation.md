# Website Stage A: Crate and Docs Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task below is exactly one commit and ends with a **Commit boundary** note (files and a suggested message). Stage only the named files (never `git add -A` or `git add .`), use the suggested one-line message as given, and add **no** trailer, body, or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Make `naive_matmul` and its docs a sound base for the website: green CI, tests that can detect a summation-order change, public partition plans, and runtime cache-block sizes.

**Architecture:** Behaviour-preserving, additive changes to the core crate. The row-block partition and the level-4 tile grid become public functions that the drivers themselves call, so a website can show exactly what the code does. A `BlockConfig` (runtime cache-block sizes) is threaded through levels 2, 3 and 4 without touching summation order. Prose is corrected to five levels (0 to 4) and dead links are removed.

**Tech Stack:** Rust (stable, MSRV 1.73), no dependencies. GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-website-design.md`, section "Stage A".

## Global Constraints

- `naive_matmul` stays dependency-free, `#![forbid(unsafe_code)]`, MSRV 1.73 (no language or library features newer than 1.73).
- Every level returns bit-for-bit identical results: each output element is summed in increasing `k` order starting from zero. Do not introduce reassociation, FMA, or split accumulators over `k`.
- `docs/` is the single source of truth for prose; module docs are `include_str!`'d from it. Do not move prose into `.rs` files.
- New public API is additive. Existing `matmul` functions keep their signatures and results.
- `BlockConfig` sizes are `NonZeroUsize` (`step_by(0)` panics). Micro-tile size (`MR`, `NR`) stays a compile-time constant.
- Never glob `docs/**` in tooling; `docs/superpowers/` is not product documentation.
- Do not commit. The human commits.

## Task order and why

Tasks 1 to 4 make CI green and make the tests honest, so every later task is checked by something that can fail. Prose comes before the code that changes behaviour. Tasks 5 to 8 and 10 to 12 change code, each preserving behaviour and each verified by the strengthened tests from Task 3; Task 9 documents the result.

**Verification commands:** `cargo test` (unit, integration and doc tests, must exit 0 with no warnings in the output) and `cargo doc --no-deps` (must print no `warning:` lines once Task 2 is done).

---

### Task 1: Add the missing doc modules so `cargo test` passes

`lib.rs` declares `design`, `guide` and `reference` modules whose files do not exist, so `cargo test` fails in the doc-test phase (`error[E0583]: file not found for module`) and `rust.yml` is red on `trunk`. `docs/reference/` is empty, so the `reference` module is dropped; `design` and `guide` get one submodule per existing page, which also makes the `crate::design::architecture` and `crate::guide::*` links in the prose resolve.

**Files:**
- Create: `src/design.rs`, `src/design/architecture.rs`, `src/guide.rs`, `src/guide/getting_started.rs`, `src/guide/in_memory.rs`
- Modify: `src/lib.rs`

**Interfaces:**
- Produces: modules `design::architecture`, `guide::getting_started`, `guide::in_memory` (documentation only, compiled under `cfg(any(doc, doctest))`).

- [ ] **Step 1: Confirm the failure**

Run: `cargo test 2>&1 | grep -E "^error"`
Expected: three lines `error[E0583]: file not found for module` (for `design`, `guide`, `reference`), then `error: doctest failed`.

- [ ] **Step 2: Create the module files**

Create `src/design.rs`:

````rust
//! Design documentation: how the pieces fit together.

pub mod architecture;
````

Create `src/design/architecture.rs`:

````rust
#![doc = include_str!("../../docs/design/architecture.md")]
````

Create `src/guide.rs`:

````rust
//! Practical guides.

pub mod getting_started;
pub mod in_memory;
````

Create `src/guide/getting_started.rs`:

````rust
#![doc = include_str!("../../docs/guide/getting_started.md")]
````

Create `src/guide/in_memory.rs`:

````rust
#![doc = include_str!("../../docs/guide/in_memory.md")]
````

- [ ] **Step 3: Drop the `reference` module from `src/lib.rs`**

In `src/lib.rs`, replace (include the final line break):

````text
#[cfg(any(doc, doctest))]
pub mod guide;
#[cfg(any(doc, doctest))]
pub mod reference;

````

with:

````text
#[cfg(any(doc, doctest))]
pub mod guide;

````

- [ ] **Step 4: Verify**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|test result|FAILED"`
Expected: every `test result` line is `ok`, including a doc-test run of roughly 20 tests; no `warning`, `error` or `FAILED` lines.

**Commit boundary 1.** Files: the five new `src/design*`/`src/guide*` files and `src/lib.rs`. Suggested message: `add the missing design and guide doc modules; drop reference`.

---

### Task 2: Remove links to pages that do not exist

After Task 1, `cargo doc` reports 16 `unresolved link` warnings: the prose links to `guide::out_of_core`, `guide::custom_io`, `guide::tuning`, `guide::errors`, `design::cost_model`, `design::numerics`, `reference::limitations` and `reference::testing`, none of which exist. They are removed (not written); the stage C site build will fail on unresolved links, so they must go now. Pages can be re-added later with their links.

**Files:**
- Modify: `docs/introduction.md`, `docs/levels/naive.md`, `docs/levels/cache_friendly.md`, `docs/levels/simd.md`, `docs/levels/streaming.md`, `docs/guide/getting_started.md`, `docs/guide/in_memory.md`

- [ ] **Step 1: Confirm the warnings**

Run: `cargo doc --no-deps 2>&1 | grep -c "unresolved link"`
Expected: `16`

- [ ] **Step 2: Apply the edits**

In `docs/introduction.md`, replace:

````text
no fused multiply-add. See
[Limitations and roadmap](crate::reference::limitations) for what is missing.
````

with:

````text
no fused multiply-add. Each level's chapter says what it leaves undone.
````

In `docs/introduction.md`, replace (include the final line break):

````text
| Multiply matrices larger than RAM                | [`guide::out_of_core`](crate::guide::out_of_core) |

````

with nothing (delete it).

In `docs/introduction.md`, replace (include the final line break):

````text
| Plug in your own storage or consume results as they appear | [`guide::custom_io`](crate::guide::custom_io) |

````

with nothing (delete it).

In `docs/introduction.md`, replace (include the final line break):

````text
| Pick tile sizes and thread counts                | [`guide::tuning`](crate::guide::tuning)           |

````

with nothing (delete it).

In `docs/introduction.md`, replace (include the final line break):

````text
| Handle failures                                  | [`guide::errors`](crate::guide::errors)           |

````

with nothing (delete it).

In `docs/introduction.md`, replace (include the final line break):

````text
| Look up the file format, tests, limits, or terms | [`reference`]                                     |

````

with nothing (delete it).

In `docs/introduction.md`, replace:

````text
| [`guide`], [`design`], [`reference`] | The prose pages (visible in `cargo doc`)                |
````

with:

````text
| [`guide`], [`design`]  | The prose pages (visible in `cargo doc`)                              |
````

In `docs/levels/naive.md`, replace:

````text
so every level returns *exactly the same bits*. See
  [Numerical behavior](crate::design::numerics).
````

with:

````text
so every level returns *exactly the same bits*.
````

In `docs/levels/cache_friendly.md`, replace:

````text
only the two changes above. See
  [Limitations and roadmap](crate::reference::limitations).
````

with:

````text
only the two changes above.
````

In `docs/levels/simd.md`, replace:

````text
(`f64::mul_add` would be the way; see the
[roadmap](crate::reference::limitations)). The test suite
````

with:

````text
(`f64::mul_add` would be the way). The test suite
````

In `docs/levels/streaming.md`, replace:

````text
The whole
trade-off is derived in the [cost model](crate::design::cost_model) and
explained practically in [tuning](crate::guide::tuning).
````

with:

````text
The whole
trade-off is controlled by [`StreamConfig::with_tile_shape`].
````

In `docs/levels/streaming.md`, replace:

````text
For matrices on disk, see [Streaming from and to disk](crate::guide::out_of_core).
For your own data sources, see [Custom sources and sinks](crate::guide::custom_io).
````

with:

````text
For matrices on disk, see [`FileMatrix`](crate::streaming::FileMatrix); for
your own data sources, implement [`TileSource`] and [`TileSink`].
````

In `docs/levels/streaming.md`, replace (include the final line break):

````text
For what remains undone, see [Limitations and roadmap](crate::reference::limitations).


````

with nothing (delete it).

In `docs/levels/streaming.md`, replace:

````text
[`StreamConfig::peak_buffer_bytes`]: crate::streaming::StreamConfig::peak_buffer_bytes
````

with:

````text
[`StreamConfig::peak_buffer_bytes`]: crate::streaming::StreamConfig::peak_buffer_bytes
[`StreamConfig::with_tile_shape`]: crate::streaming::StreamConfig::with_tile_shape
````

In `docs/guide/getting_started.md`, replace (include the final line break):

````text
See [Testing](crate::reference::testing).


````

with nothing (delete it).

In `docs/guide/getting_started.md`, replace:

````text
- Matrices too big for RAM:
  [Streaming from and to disk](crate::guide::out_of_core).
````

with:

````text
- Matrices too big for RAM: [`streaming`](crate::streaming) with
  [`FileMatrix`](crate::streaming::FileMatrix).
````

In `docs/guide/in_memory.md`, replace:

````text
with a smaller [`with_tile_shape`](crate::streaming::StreamConfig::with_tile_shape);
see [Choosing tile sizes and threads](crate::guide::tuning).
````

with:

````text
with a smaller [`with_tile_shape`](crate::streaming::StreamConfig::with_tile_shape).
````

- [ ] **Step 3: Verify**

Run: `touch src/lib.rs && cargo doc --no-deps 2>&1 | grep -c "^warning"`
Expected: `0`

Run: `cargo test 2>&1 | grep -E "FAILED|^error"`
Expected: no output.

**Commit boundary 2.** Files: the seven `docs/` pages above. Suggested message: `remove links to documentation pages that do not exist`.

---

### Task 3: Make the cross-level tests able to fail

`tests/levels.rs` uses small-integer operands "so every sum is exact", so a change in summation order would still pass. It also omits `simd::matmul`, and `assert_eq!` on `f64` treats `-0.0 == 0.0`. This task adds `simd`, a second operand set of mixed-magnitude values that is sensitive to order, and compares raw bits. A guard test proves the new operands have teeth.

These tests pass immediately, because the code already preserves order; they are regression guards, not red-then-green tests. Their power is demonstrated by `rough_operands_are_sensitive_to_summation_order`, which fails if the operands cannot distinguish a reversed `k` loop.

**Files:**
- Modify: `tests/levels.rs`

**Interfaces:**
- Produces (test-local helpers used by Tasks 10 to 12): `rough_operands(m, n, p) -> (Matrix, Matrix)`, `bits(&Matrix) -> Vec<u64>`, `assert_same_bits(got: &Matrix, want: &Matrix, context: &str)`.

- [ ] **Step 1: Apply the edits**

In `tests/levels.rs`, replace:

````text
//! results are bit-for-bit identical. These tests assert exact equality.
````

with:

````text
//! results are bit-for-bit identical. These tests compare the raw bits of
//! every element, on operands chosen so that any change in summation order
//! would show.
````

In `tests/levels.rs`, replace:

````text
use naive_matmul::{cache_friendly, naive, streaming, threaded, DimensionMismatch, MatmulError, Matrix};
````

with:

````text
use naive_matmul::{cache_friendly, naive, simd, streaming, threaded, DimensionMismatch, MatmulError, Matrix};
````

In `tests/levels.rs`, replace:

````text
/// The product computed at every level, labelled by module name.
///
/// Level 3 is run with small tiles
````

with:

````text
/// Operands with entries of very different magnitudes, so nearly every partial
/// sum rounds. Regrouping or reordering the additions of an output element
/// changes its bits, which the small integers above could never reveal.
fn rough_operands(m: usize, n: usize, p: usize) -> (Matrix, Matrix) {
    let mut state = 0x9E37_79B9_7F4A_7C15_u64;
    let mut next = move || {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let unit = (state >> 11) as f64 / (1_u64 << 53) as f64; // in [0, 1)
        let exponent = (state >> 60) as i32 - 8; // -8 ..= 7
        (unit - 0.5) * 2.0_f64.powi(exponent)
    };
    let a = Matrix::from_fn(m, n, |_, _| next());
    let b = Matrix::from_fn(n, p, |_, _| next());
    (a, b)
}

/// The raw bits of every element, so `-0.0` and `0.0` (or two NaNs) differ.
fn bits(m: &Matrix) -> Vec<u64> {
    m.as_slice().iter().map(|x| x.to_bits()).collect()
}

fn assert_same_bits(got: &Matrix, want: &Matrix, context: &str) {
    assert_eq!((got.rows(), got.cols()), (want.rows(), want.cols()), "{context}: shape");
    assert_eq!(bits(got), bits(want), "{context}");
}

/// Guards this file's own power: if summing in decreasing `k` gave the same
/// bits, no test using these operands could detect a reordering.
#[test]
fn rough_operands_are_sensitive_to_summation_order() {
    let (a, b) = rough_operands(8, 64, 8);
    let forward = naive::matmul(&a, &b).unwrap();
    let backward = Matrix::from_fn(8, 8, |i, j| {
        let mut sum = 0.0;
        for k in (0..64).rev() {
            sum += a[(i, k)] * b[(k, j)];
        }
        sum
    });
    assert_ne!(bits(&forward), bits(&backward));
}

/// The product computed at every level, labelled by module name.
///
/// Level 4 is run with small tiles
````

In `tests/levels.rs`, replace:

````text
        ("cache_friendly", cache_friendly::matmul(a, b, t).unwrap()),
        ("streaming (default tiles)"
````

with:

````text
        ("cache_friendly", cache_friendly::matmul(a, b, t).unwrap()),
        ("simd", simd::matmul(a, b, t).unwrap()),
        ("streaming (default tiles)"
````

In `tests/levels.rs`, replace:

````text
    for (m, n, p) in shapes {
        let (a, b) = sample_operands(m, n, p);
        for threads in [1, 3, 8] {
            let results = product_at_every_level(&a, &b, threads);
            let reference = &results[0].1;
            for (level, c) in &results[1..] {
                assert_eq!(c, reference, "{level}, shape {m}x{n}x{p}, {threads} thread(s)");
            }
        }
    }
````

with:

````text
    for (m, n, p) in shapes {
        let operand_sets = [
            ("integer", sample_operands(m, n, p)),
            ("rough", rough_operands(m, n, p)),
        ];
        for (kind, (a, b)) in &operand_sets {
            for threads in [1, 3, 8] {
                let results = product_at_every_level(a, b, threads);
                let reference = &results[0].1;
                for (level, c) in &results[1..] {
                    let context = format!("{level}, {kind} operands, shape {m}x{n}x{p}, {threads} thread(s)");
                    assert_same_bits(c, reference, &context);
                }
            }
        }
    }
````

In `tests/levels.rs`, replace (include the final line break):

````text
    assert_eq!(cache_friendly::matmul(&a, &b, nz(16)).unwrap(), reference);

````

with:

````text
    assert_eq!(cache_friendly::matmul(&a, &b, nz(16)).unwrap(), reference);
    assert_eq!(simd::matmul(&a, &b, nz(16)).unwrap(), reference);

````

In `tests/levels.rs`, replace (include the final line break):

````text
        assert_eq!(shape(&cache_friendly::matmul(&a, &b, t).unwrap()), (m, p));

````

with:

````text
        assert_eq!(shape(&cache_friendly::matmul(&a, &b, t).unwrap()), (m, p));
        assert_eq!(shape(&simd::matmul(&a, &b, t).unwrap()), (m, p));

````

In `tests/levels.rs`, replace (include the final line break):

````text
    assert_eq!(cache_friendly::matmul(&a, &b, t).unwrap_err(), expected);

````

with:

````text
    assert_eq!(cache_friendly::matmul(&a, &b, t).unwrap_err(), expected);
    assert_eq!(simd::matmul(&a, &b, t).unwrap_err(), expected);

````

- [ ] **Step 2: Verify in debug and release**

Run: `cargo test --test levels && cargo test --release --test levels`
Expected: both runs end `test result: ok. 9 passed` (8 original-style tests plus the guard), including `rough_operands_are_sensitive_to_summation_order`.

Run (optional, exercises wider vectors): `RUSTFLAGS="-C target-cpu=native" cargo test --release --test levels`
Expected: `test result: ok.`

**Commit boundary 3.** File: `tests/levels.rs`. Suggested message: `test all five levels bit-for-bit on order-sensitive operands`.

---

### Task 4: Correct the level numbering and false claims in the prose

The chapters say "Level 0 of 3" … "Level 3 of 3" (streaming) while `simd.md` says "Level 3 of 4"; `threaded.md` says "Level 3 uses a work queue" (it is level 4); `simd.md` claims level 4 reuses the micro-kernel (it uses level 2's `axpy` kernel, see `src/streaming/kernel.rs`); the guides count four levels. This task runs after Task 3 because the claim "all five levels agree" is only true once `simd` is in the cross-level test.

**Files:**
- Modify: `docs/levels/naive.md`, `docs/levels/threaded.md`, `docs/levels/cache_friendly.md`, `docs/levels/simd.md`, `docs/levels/streaming.md`, `docs/guide/getting_started.md`, `docs/guide/in_memory.md`

- [ ] **Step 1: Apply the edits**

In `docs/levels/naive.md`, replace:

````text
**Level 0 of 3.**
````

with:

````text
**Level 0 of 4.**
````

In `docs/levels/naive.md`, replace:

````text
is `3·n²·8` bytes. Level 3
   removes this limit.
````

with:

````text
is `3·n²·8` bytes. Level 4
   removes this limit.
````

In `docs/levels/cache_friendly.md`, replace:

````text
**Level 2 of 3.**
````

with:

````text
**Level 2 of 4.**
````

In `docs/levels/simd.md`, replace:

````text
removes that assumption, and it reuses this
level's micro-kernel as its inner loop.
````

with:

````text
removes that assumption. It computes its tiles with level 2's
`axpy` kernel, not with this level's micro-kernel.
````

In `docs/levels/streaming.md`, replace:

````text
**Level 3 of 3.**
````

with:

````text
**Level 4 of 4.**
````

In `docs/levels/streaming.md`, replace:

````text
Levels 0 to 2 need
````

with:

````text
Levels 0 to 3 need
````

In `docs/levels/streaming.md`, replace:

````text
| `streaming` (3) |
````

with:

````text
| `streaming` (4) |
````

In `docs/levels/streaming.md`, replace:

````text
Level 3 adds a
layer
````

with:

````text
Level 4 adds a
layer
````

In `docs/levels/streaming.md`, replace:

````text
Level 3 earns
  its keep
````

with:

````text
Level 4 earns
  its keep
````

In `docs/guide/getting_started.md`, replace:

````text
runs level 3 on matrices stored in files
````

with:

````text
runs level 4 on matrices stored in files
````

In `docs/guide/getting_started.md`, replace:

````text
checks all four levels
agree)
````

with:

````text
checks all five levels
agree)
````

In `docs/guide/getting_started.md`, replace:

````text
The four implementations are the modules `naive`, `threaded`,
`cache_friendly`, and `streaming`, and each
````

with:

````text
The five implementations are the modules `naive`, `threaded`,
`cache_friendly`, `simd`, and `streaming`, and each
````

In `docs/guide/getting_started.md`, replace:

````text
times all four levels on the same problem
````

with:

````text
times all five levels on the same problem
````

In `docs/guide/in_memory.md`, replace:

````text
If your matrices fit in memory, you have three implementations to choose from.
````

with:

````text
If your matrices fit in memory, you have five implementations to choose from.
````

In `docs/guide/in_memory.md`, replace (include the final line break):

````text
| The fastest in-memory product                      | [`cache_friendly::matmul`](crate::cache_friendly::matmul) |

````

with:

````text
| The fastest in-memory product                      | [`simd::matmul`](crate::simd::matmul)            |
| Cache blocking without the vector work             | [`cache_friendly::matmul`](crate::cache_friendly::matmul) |

````

In `docs/guide/in_memory.md`, replace:

````text
All four return **bit-identical results**
````

with:

````text
All five return **bit-identical results**
````

In `docs/guide/in_memory.md`, replace:

````text
[`naive`](crate::naive), [`threaded`](crate::threaded), and
[`cache_friendly`](crate::cache_friendly) can fail
````

with:

````text
[`naive`](crate::naive), [`threaded`](crate::threaded),
[`cache_friendly`](crate::cache_friendly), and [`simd`](crate::simd) can fail
````

In `docs/guide/in_memory.md`, replace:

````text
[`threaded`](crate::threaded) and [`cache_friendly`](crate::cache_friendly)
split the output *rows*
````

with:

````text
[`threaded`](crate::threaded), [`cache_friendly`](crate::cache_friendly), and
[`simd`](crate::simd) split the output *rows*
````

In `docs/guide/in_memory.md`, replace:

````text
tuned BLAS will beat all four levels
````

with:

````text
tuned BLAS will beat all five levels
````

In `docs/levels/threaded.md`, replace:

````text
**Level 1 of 3.**
````

with:

````text
**Level 1 of 4.**
````

In `docs/levels/threaded.md`, replace:

````text
waiting for it. Level 3 uses a work queue instead.
````

with:

````text
waiting for it. Level 4 uses a work queue instead.
````

- [ ] **Step 2: Verify**

Run: `grep -rn "of 3\.\|four levels\|four implementations\|all four" docs/introduction.md docs/levels docs/guide`
Expected: no output. (`docs/design/architecture.md` is rewritten in Task 9.)

Run: `touch src/lib.rs && cargo doc --no-deps 2>&1 | grep -c "^warning"; cargo test 2>&1 | grep -E "FAILED|^error"`
Expected: `0`, then no output.

**Commit boundary 4.** Files: the seven `docs/` pages above. Suggested message: `fix level numbering and the streaming/micro-kernel claim in the docs`.

---

### Task 5: Report `simd128` in `target_vector_isa()`

On `wasm32` with the `simd128` feature, `target_vector_isa()` falls through to "none (scalar code)" even though the compiler vectorises. The site will show this string. `NR` is already 4 on wasm (no `avx`), which is correct for 128-bit vectors. This can only be exercised on a wasm target; on native it is a compile-time `cfg!` branch that is never taken, so the check is that everything still builds and the docs are right.

**Files:**
- Modify: `src/simd.rs`, `docs/levels/simd.md`

- [ ] **Step 1: Apply the edits**

In `src/simd.rs`, replace:

````text
    } else if cfg!(target_feature = "neon") {
        "NEON"
    } else {
````

with:

````text
    } else if cfg!(target_feature = "neon") {
        "NEON"
    } else if cfg!(target_feature = "simd128") {
        "WASM SIMD128"
    } else {
````

In `docs/levels/simd.md`, replace:

````text
| SSE2 (baseline `x86_64`), NEON (`aarch64`) | 128 bits | 2 |
````

with:

````text
| SSE2 (baseline `x86_64`), NEON (`aarch64`), SIMD128 (WebAssembly, when enabled) | 128 bits | 2 |
````

In `docs/levels/simd.md`, replace:

````text
// e.g. "SSE2", "AVX2", "NEON"
````

with:

````text
// e.g. "SSE2", "AVX2", "NEON", "WASM SIMD128"
````

- [ ] **Step 2: Verify**

Run: `cargo test 2>&1 | grep -E "FAILED|^error"`
Expected: no output.

- [ ] **Step 3 (human, optional): Check the wasm build**

The wasm target is not installed by default. Run `! rustup target add wasm32-unknown-unknown`, then `cargo check --lib --target wasm32-unknown-unknown` (expected: `Finished`) and `RUSTFLAGS="-C target-feature=+simd128" cargo check --lib --target wasm32-unknown-unknown`. Task 14 adds the first of these to CI.

**Commit boundary 5.** Files: `src/simd.rs`, `docs/levels/simd.md`. Suggested message: `report SIMD128 as the vector ISA on wasm`.

---

### Task 6: Level 2 uses the shared row-block driver

`cache_friendly::matmul` carries its own copy of the thread driver that `threaded::multiply_by_row_blocks` already provides (and level 3 already uses). Merging them leaves one driver, which Tasks 7 and 10 then change once instead of twice. Pure refactor: no behaviour change.

**Files:**
- Modify: `src/cache_friendly.rs`

- [ ] **Step 1: Apply the edit**

In `src/cache_friendly.rs`, replace:

````text
use std::num::NonZeroUsize;
use std::thread;

use crate::error::{check_inner_dimensions, DimensionMismatch};
use crate::matrix::Matrix;
````

with:

````text
use std::num::NonZeroUsize;

use crate::error::DimensionMismatch;
use crate::matrix::Matrix;
use crate::threaded::multiply_by_row_blocks;
````

In `src/cache_friendly.rs`, replace:

````text
    let (m, _, p) = check_inner_dimensions((a.rows(), a.cols()), (b.rows(), b.cols()))?;

    // Zero-initialised, because the kernel accumulates into it.
    let mut c = Matrix::zeros(m, p);
    if c.as_slice().is_empty() {
        // Nothing to compute; also avoids `chunks_mut(0)`, which panics.
        return Ok(c);
    }

    let rows_per_block = m.div_ceil(threads.get());
    let block_len = rows_per_block * p;

    thread::scope(|scope| {
        for (block_idx, c_block) in c.as_mut_slice().chunks_mut(block_len).enumerate() {
            let first_row = block_idx * rows_per_block;
            scope.spawn(move || multiply_row_block(a, b, first_row, c_block));
        }
    });

    Ok(c)
}
````

with:

````text
    multiply_by_row_blocks(a, b, threads, multiply_row_block)
}
````

- [ ] **Step 2: Verify**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|FAILED"`
Expected: no output (in particular no `unused import` warning).

**Commit boundary 6.** File: `src/cache_friendly.rs`. Suggested message: `run level 2 through the shared row-block driver`.

---

### Task 7: A public `row_block_plan` that the driver calls

The row partition is two inline lines in the driver. Extracting it as `pub fn row_block_plan` and making the driver iterate over its result means the website describes what the code does, not a copy of it. Safe disjoint output slices now come from `split_at_mut` driven by the plan instead of `chunks_mut`.

**Files:**
- Modify: `src/threaded.rs`

**Interfaces:**
- Produces: `pub fn row_block_plan(rows: usize, threads: NonZeroUsize) -> Vec<Range<usize>>` in `naive_matmul::threaded`. Blocks are in row order, non-empty, at most `threads` of them, and cover `0..rows` exactly once; `rows == 0` gives `vec![]`.

- [ ] **Step 1: Write the failing tests**

In `src/threaded.rs`, replace:

````text
    #[test]
    fn more_threads_than_rows() {
````

with:

````text
    #[test]
    fn row_block_plan_has_a_short_last_block() {
        assert_eq!(row_block_plan(10, nz(4)), vec![0..3, 3..6, 6..9, 9..10]);
        assert_eq!(row_block_plan(7, nz(3)), vec![0..3, 3..6, 6..7]);
    }

    #[test]
    fn row_block_plan_has_fewer_blocks_than_threads_when_rows_run_out() {
        assert_eq!(row_block_plan(2, nz(16)), vec![0..1, 1..2]);
        assert_eq!(row_block_plan(5, nz(4)), vec![0..2, 2..4, 4..5]);
    }

    #[test]
    fn row_block_plan_of_no_rows_is_empty() {
        assert!(row_block_plan(0, nz(4)).is_empty());
    }

    #[test]
    fn row_block_plan_covers_every_row_exactly_once() {
        for rows in 0..40 {
            for threads in 1..=9 {
                let plan = row_block_plan(rows, nz(threads));
                assert!(plan.len() <= threads);
                let mut next_row = 0;
                for block in &plan {
                    assert_eq!(block.start, next_row, "rows={rows}, threads={threads}");
                    assert!(!block.is_empty());
                    next_row = block.end;
                }
                assert_eq!(next_row, rows, "rows={rows}, threads={threads}");
            }
        }
    }

    #[test]
    fn more_threads_than_rows() {
````

- [ ] **Step 2: Run them to see the failure**

Run: `cargo test --lib threaded 2>&1 | grep -E "^error"`
Expected: `error[E0425]: cannot find function `row_block_plan` in this scope` (several times).

- [ ] **Step 3: Implement the function and use it in the driver**

In `src/threaded.rs`, replace (include the final line break):

````text
use std::num::NonZeroUsize;
use std::thread;

````

with:

````text
use std::num::NonZeroUsize;
use std::ops::Range;
use std::thread;

````

In `src/threaded.rs`, replace:

````text
/// The signature of a kernel that [`multiply_by_row_blocks`] can drive.
````

with:

````text
/// Divides `rows` output rows into the contiguous blocks that [`matmul`] (and
/// levels 2 and 3) give to their threads.
///
/// The rows are cut into at most `threads` blocks of equal size; the last block
/// may be smaller. If there are fewer rows than threads, there are fewer blocks
/// than threads, and zero rows give no blocks at all. The blocks are returned
/// in row order and together cover `0..rows` exactly once.
///
/// This is the function the drivers themselves call, so it describes what the
/// code does rather than a copy of it.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::threaded::row_block_plan;
///
/// let plan = row_block_plan(10, NonZeroUsize::new(4).unwrap());
/// assert_eq!(plan, vec![0..3, 3..6, 6..9, 9..10]);
/// ```
pub fn row_block_plan(rows: usize, threads: NonZeroUsize) -> Vec<Range<usize>> {
    if rows == 0 {
        return Vec::new();
    }
    let rows_per_block = rows.div_ceil(threads.get());
    (0..rows)
        .step_by(rows_per_block)
        .map(|first| first..(first + rows_per_block).min(rows))
        .collect()
}

/// The signature of a kernel that [`multiply_by_row_blocks`] can drive.
````

In `src/threaded.rs`, replace:

````text
    let rows_per_block = m.div_ceil(threads.get());
    let block_len = rows_per_block * p;

    thread::scope(|scope| {
        for (block_idx, c_block) in c.as_mut_slice().chunks_mut(block_len).enumerate() {
            let first_row = block_idx * rows_per_block;
            scope.spawn(move || kernel(a, b, first_row, c_block));
        }
    });
````

with:

````text
    thread::scope(|scope| {
        let mut remaining = c.as_mut_slice();
        for block in row_block_plan(m, threads) {
            let (c_block, rest) = std::mem::take(&mut remaining).split_at_mut(block.len() * p);
            remaining = rest;
            let first_row = block.start;
            scope.spawn(move || kernel(a, b, first_row, c_block));
        }
    });
````

- [ ] **Step 4: Verify**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: all `ok`, no warnings; the `threaded` unit tests now include four `row_block_plan_*` tests and one doc test for `row_block_plan`.

**Commit boundary 7.** File: `src/threaded.rs`. Suggested message: `expose row_block_plan and drive threads from it`.

---

### Task 8: A public `tile_plan` for level 4

Level 4's geometry lives in a private `Plan` built inline in `matmul_streaming`, and the tile-index decode is buried in `compute_output_tile`. This task gives `Plan` a constructor and two accessors (`tile`, `depth_slices`) that the driver now uses, and a public `tile_plan` that returns the same geometry without multiplying. There is deliberately **no** thread-to-tile mapping: workers claim tiles from an atomic counter, so the plan lists tiles in numbering order only.

**Files:**
- Modify: `src/streaming/multiply.rs`, `src/streaming/mod.rs`

**Interfaces:**
- Produces, all in `naive_matmul::streaming`:
  - `pub struct OutputTile { pub rows: Range<usize>, pub cols: Range<usize> }`
  - `pub struct TilePlan { pub tiles: Vec<OutputTile>, pub depth_slices: Vec<Range<usize>> }`
  - `pub fn tile_plan(m: usize, n: usize, p: usize, config: &StreamConfig) -> TilePlan` (`m` rows of `A`/`C`, `n` shared dimension, `p` columns of `B`/`C`; an empty product has no tiles).
- Produces (private): `Plan::new(m, n, p, &StreamConfig)`, `Plan::tile(index) -> OutputTile`, `Plan::depth_slices() -> impl Iterator<Item = Range<usize>>`.

- [ ] **Step 1: Write the failing tests**

In `src/streaming/multiply.rs`, replace:

````text
    #[test]
    #[should_panic(expected = "non-zero")]
````

with:

````text
    #[test]
    fn tile_plan_numbers_tiles_row_major() {
        let config = StreamConfig::new(nz(1)).with_tile_shape(2, 3, 5);
        let plan = tile_plan(4, 5, 6, &config);
        let tile = |rows, cols| OutputTile { rows, cols };
        assert_eq!(
            plan.tiles,
            vec![tile(0..2, 0..3), tile(0..2, 3..6), tile(2..4, 0..3), tile(2..4, 3..6)]
        );
        assert_eq!(plan.depth_slices, vec![0..5]);
    }

    #[test]
    fn tile_plan_clamps_edge_tiles_and_depth_slices() {
        let config = StreamConfig::new(nz(1)).with_tile_shape(4, 4, 3);
        let plan = tile_plan(5, 7, 5, &config);
        assert_eq!(plan.tiles.len(), 4);
        assert_eq!(plan.tiles[3], OutputTile { rows: 4..5, cols: 4..5 });
        assert_eq!(plan.depth_slices, vec![0..3, 3..6, 6..7]);
    }

    #[test]
    fn tile_plan_covers_every_output_element_exactly_once() {
        let shapes = [(5, 7, 9, (2, 4, 3)), (1, 1, 1, (256, 256, 256)), (10, 10, 10, (10, 10, 10)), (7, 0, 5, (3, 3, 3))];
        for (m, n, p, (r, q, d)) in shapes {
            let config = StreamConfig::new(nz(2)).with_tile_shape(r, q, d);
            let plan = tile_plan(m, n, p, &config);
            let mut seen = vec![0_u8; m * p];
            for tile in &plan.tiles {
                for i in tile.rows.clone() {
                    for j in tile.cols.clone() {
                        seen[i * p + j] += 1;
                    }
                }
            }
            assert!(seen.iter().all(|&count| count == 1), "{m}x{n}x{p}");
            let depth: usize = plan.depth_slices.iter().map(|slice| slice.len()).sum();
            assert_eq!(depth, n, "{m}x{n}x{p}");
        }
    }

    #[test]
    fn tile_plan_of_an_empty_product_has_no_tiles() {
        let config = StreamConfig::new(nz(1));
        assert!(tile_plan(0, 3, 4, &config).tiles.is_empty());
        assert!(tile_plan(4, 3, 0, &config).tiles.is_empty());
    }

    #[test]
    #[should_panic(expected = "non-zero")]
````

- [ ] **Step 2: Run them to see the failure**

Run: `cargo test --lib streaming::multiply 2>&1 | grep -E "^error"`
Expected: `error[E0425]: cannot find function `tile_plan` in this scope` and `error[E0422]`/`E0433` for `OutputTile`.

- [ ] **Step 3: Implement the plan and make the driver use it**

In `src/streaming/multiply.rs`, replace:

````text
use std::num::NonZeroUsize;
use std::sync::atomic
````

with:

````text
use std::num::NonZeroUsize;
use std::ops::Range;
use std::sync::atomic
````

In `src/streaming/multiply.rs`, replace:

````text
/// One worker's reusable tile buffers.
````

with:

````text
impl Plan {
    /// Resolves the geometry of an `m × n` by `n × p` product. `m` and `p`
    /// must be non-zero.
    fn new(m: usize, n: usize, p: usize, config: &StreamConfig) -> Self {
        let (tile_rows, tile_cols, tile_depth) = config.tile_shape();
        let tile_rows = tile_rows.min(m);
        let tile_cols = tile_cols.min(p);
        let tile_depth = tile_depth.min(n).max(1); // `n` may be 0.
        let tiles_per_row = p.div_ceil(tile_cols);
        let total_tiles = m.div_ceil(tile_rows) * tiles_per_row;
        Self {
            m,
            n,
            p,
            tile_rows,
            tile_cols,
            tile_depth,
            tiles_per_row,
            total_tiles,
        }
    }

    /// Returns the rows and columns covered by output tile `tile_index`.
    ///
    /// Tiles are numbered row-major over the grid, and `tile_index` must be
    /// below `total_tiles`.
    fn tile(&self, tile_index: usize) -> OutputTile {
        let row = (tile_index / self.tiles_per_row) * self.tile_rows;
        let col = (tile_index % self.tiles_per_row) * self.tile_cols;
        OutputTile {
            rows: row..(row + self.tile_rows).min(self.m),
            cols: col..(col + self.tile_cols).min(self.p),
        }
    }

    /// Returns the slices of the shared dimension streamed past each tile.
    fn depth_slices(&self) -> impl Iterator<Item = Range<usize>> + '_ {
        (0..self.n)
            .step_by(self.tile_depth)
            .map(|start| start..(start + self.tile_depth).min(self.n))
    }
}

/// One output tile of the grid that [`matmul_streaming`] works through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputTile {
    /// The rows of `C` (and of `A`) the tile covers.
    pub rows: Range<usize>,
    /// The columns of `C` (and of `B`) the tile covers.
    pub cols: Range<usize>,
}

/// The geometry of a streaming multiplication: which tiles exist and which
/// slices of the shared dimension are streamed past each one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilePlan {
    /// The output tiles, numbered row-major over the grid. Workers claim them
    /// in this order from a shared counter, so which worker computes which tile
    /// is decided at run time and is not part of the plan.
    pub tiles: Vec<OutputTile>,
    /// The slices of the shared dimension read for every tile, in order.
    pub depth_slices: Vec<Range<usize>>,
}

/// Describes how [`matmul_streaming`] would tile an `m × n` by `n × p`
/// product under `config`, without multiplying anything.
///
/// It is built from the same code the multiplication uses, so it is exactly
/// the tiling that will run. An empty product (`m` or `p` zero) has no tiles.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::streaming::{tile_plan, StreamConfig};
///
/// let config = StreamConfig::new(NonZeroUsize::new(2).unwrap()).with_tile_shape(2, 3, 4);
/// let plan = tile_plan(4, 6, 6, &config);
/// assert_eq!(plan.tiles.len(), 4); // a 2 x 2 grid of 2 x 3 tiles
/// assert_eq!(plan.depth_slices, vec![0..4, 4..6]);
/// ```
pub fn tile_plan(m: usize, n: usize, p: usize, config: &StreamConfig) -> TilePlan {
    if m == 0 || p == 0 {
        return TilePlan {
            tiles: Vec::new(),
            depth_slices: Vec::new(),
        };
    }
    let plan = Plan::new(m, n, p, config);
    TilePlan {
        tiles: (0..plan.total_tiles).map(|index| plan.tile(index)).collect(),
        depth_slices: plan.depth_slices().collect(),
    }
}

/// One worker's reusable tile buffers.
````

In `src/streaming/multiply.rs`, replace (include the final line break):

````text
    let row = (tile_index / plan.tiles_per_row) * plan.tile_rows;
    let col = (tile_index % plan.tiles_per_row) * plan.tile_cols;
    let rows = plan.tile_rows.min(plan.m - row);
    let cols = plan.tile_cols.min(plan.p - col);

````

with:

````text
    let tile = plan.tile(tile_index);
    let (row, col) = (tile.rows.start, tile.cols.start);
    let (rows, cols) = (tile.rows.len(), tile.cols.len());

````

In `src/streaming/multiply.rs`, replace (include the final line break):

````text
    for depth_start in (0..plan.n).step_by(plan.tile_depth) {
        let depth = plan.tile_depth.min(plan.n - depth_start);

````

with:

````text
    for slice in plan.depth_slices() {
        let (depth_start, depth) = (slice.start, slice.len());

````

In `src/streaming/multiply.rs`, replace:

````text
    let (tile_rows, tile_cols, tile_depth) = config.tile_shape();
    let tile_rows = tile_rows.min(m);
    let tile_cols = tile_cols.min(p);
    let tile_depth = tile_depth.min(n).max(1); // `n` may be 0.
    let tiles_per_row = p.div_ceil(tile_cols);
    let total_tiles = m.div_ceil(tile_rows) * tiles_per_row;
    let plan = Plan {
        m,
        n,
        p,
        tile_rows,
        tile_cols,
        tile_depth,
        tiles_per_row,
        total_tiles,
    };

    let workers = config.threads().min(total_tiles);
````

with:

````text
    let plan = Plan::new(m, n, p, config);

    let workers = config.threads().min(plan.total_tiles);
````

In `src/streaming/mod.rs`, replace:

````text
pub use multiply::{matmul, matmul_streaming, StreamConfig};
````

with:

````text
pub use multiply::{matmul, matmul_streaming, tile_plan, OutputTile, StreamConfig, TilePlan};
````

- [ ] **Step 4: Verify**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: all `ok`, no warnings; four new `tile_plan_*` unit tests and one `tile_plan` doc test pass, and every pre-existing streaming test is unchanged.

**Commit boundary 8.** Files: `src/streaming/multiply.rs`, `src/streaming/mod.rs`. Suggested message: `expose tile_plan; build the level-4 driver's geometry from it`.

---

### Task 9: Rewrite the architecture page for five levels

`docs/design/architecture.md` still describes four implementations with `streaming` as level 3, omits `simd`, and draws a diagram to match. The rewrite documents the code as it is after Tasks 5 to 8 (the shared row-block driver, `threaded::row_block_plan`, `streaming::tile_plan`), which is why it comes after them rather than with the other prose fixes.

**Files:**
- Modify (replace entire contents): `docs/design/architecture.md`

- [ ] **Step 1: Replace the file**

Overwrite the whole file with:

````markdown
# One problem, five implementations

The crate is organised as a ladder. Each rung is a complete, working
implementation of matrix multiplication, and each reuses the ideas of the one
below it, so the code can be read in order.

```text
 0 naive  ─►  1 threaded  ─►  2 cache_friendly  ─►  3 simd
 the loop     + row blocks    + i-k-j kernel         + register-blocked
              + scoped        + cache blocks            micro-kernel
                threads         (axpy)

              2 cache_friendly  ─►  4 streaming
              its axpy kernel       + tiles, sources, sinks,
              and cache blocks        dynamic work queue
```

Reading it as a chain of reuse:

| Level | Reuses from below | Adds |
|-------|-------------------|------|
| 0 `naive`          | (nothing)                                  | The triple loop |
| 1 `threaded`       | Level 0's loop, as the per-thread kernel   | Row-block partitioning (`row_block_plan`), scoped threads |
| 2 `cache_friendly` | Level 1's partitioning and threading       | A new kernel: `i-k-j` order, `axpy`, cache blocks |
| 3 `simd`           | Level 1's partitioning and threading; level 2's `axpy` and cache blocks | A register-blocked micro-kernel for the innermost step |
| 4 `streaming`      | Level 2's `axpy` and cache blocks          | Tiles, the source/sink traits, a work queue |

Shared by all levels: [`Matrix`](crate::Matrix), the dimension check, and the
error types.

# Modules

| Module                      | Public?  | Contents |
|-----------------------------|----------|----------|
| `matrix`                    | yes      | `Matrix`: dense row-major `f64` storage, used by every level. |
| `error`                     | yes      | `MatmulError`, `DimensionMismatch`, and the shared shape check. |
| `naive`                     | yes      | Level 0. |
| `threaded`                  | yes      | Level 1, `row_block_plan`, and the row-block driver that levels 2 and 3 reuse. |
| `cache_friendly`            | yes      | Level 2, including `axpy`, `BlockConfig`, and the default cache-block constants used by levels 3 and 4. |
| `simd`                      | yes      | Level 3: the register-blocked micro-kernel and `micro_tile_shape`. |
| `streaming`                 | yes      | Level 4 and its submodules (below). |
| `streaming::tile`           | yes      | `TileSource`, `TileSink`, `MemorySink`; `Matrix` implements `TileSource`. |
| `streaming::file`           | yes\*    | `FileMatrix`, a disk-backed source and sink. \*Unix and Windows only. |
| `streaming::multiply`       | yes      | `matmul_streaming`, `StreamConfig`, `tile_plan`, `matmul`. |
| `streaming::kernel`         | no       | `accumulate_tile`: level 2's kernel on flat buffers. |

# Separation of concerns

Every level splits its work the same way, and the split is what lets one level
build on another:

- **Partitioning** decides *which part of the output* a unit of work covers
  (all of it, a block of rows, or a tile) and who runs it.
- **The kernel** does the arithmetic for one unit of work. It only reads inputs
  and writes its own output slice, and knows nothing about threads.

In level 1 the kernel is the level-0 loop. In levels 2 and 3 only the kernel
changes. In level 4 the partitioning changes (tiles, work queue, sources and
sinks) and the kernel is level 2's, adapted to flat buffers. Because the pieces
are independent, each level's difference from its predecessor is small.

The partition is an ordinary function: `threaded::row_block_plan` for levels 1
to 3 and `streaming::tile_plan` for level 4. The drivers call the same
functions, so a plan describes exactly what will run. For level 4 the plan lists
the tiles in the order they are numbered; which worker computes which tile is
decided at run time, because workers claim tiles from a shared counter.

# Data flow in level 4

```text
   TileSource A                                      TileSink C
   ┌─────────┐                                       ┌─────────┐
   │ A strip │──read_tile──►  a_buf (R×D) ──┐        │         │
   └─────────┘                              ├─► accumulate_tile
   TileSource B                             │        │   ▲     │
   ┌─────────┐                              │   c_buf (R×Q)    │
   │ B strip │──read_tile──►  b_buf (D×Q) ──┘        │   │     │
   └─────────┘      repeat for each depth slice      │   └─write_tile (once)
                                                     └─────────┘
```

The pair `a_buf`/`b_buf` is refilled for each slice of the shared dimension.
`c_buf` is zeroed at the start of a tile, accumulates across all slices, and is
written out once at the end. All three buffers are then reused for the next
tile claimed by the same worker.

# Why traits instead of closures or enums

`TileSource` and `TileSink` are traits because the set of backends is open:
users plug in generated data, mapped files, network stores. Two properties make
the traits cheap to use:

- Both require `Sync`, which is exactly what lets a shared reference cross into
  worker threads. Nothing else about the backends is constrained.
- `matmul_streaming` is generic over `A: TileSource + ?Sized`, so it
  monomorphises for concrete types (no virtual call per tile in the common
  case) while still accepting `&dyn TileSource` when you want runtime
  polymorphism.

# Why `streaming::matmul` wraps the streaming path

Within level 4 there is exactly one algorithm. `streaming::matmul` builds a
`MemorySink`, calls `matmul_streaming`, and unwraps the sink, rather than
maintaining a second, in-memory implementation. The in-memory and out-of-core
paths therefore cannot drift apart, and the tests that exercise one exercise
the other. The price is one extra copy of each tile, which is why
[`simd`](crate::simd), not `streaming::matmul`, is the recommended choice for
data that fits in memory.

# Design principles

- **Imperative style throughout.** Explicit `for` loops that mutate
  accumulators and output slices, rather than iterator-adaptor chains. The
  algorithms are loop nests, and the code reads like one.
- **No `unsafe`.** Disjoint mutable access is achieved by ownership: slices from
  `split_at_mut` in levels 1 to 3, per-worker buffers in level 4. Disjoint
  access to the output of level 4 is the sink's responsibility.
- **No dependencies.** Scoped threads, atomics, and positional file I/O are all
  in `std`.
- **Panics for bugs, `Result` for the world.** I/O can fail legitimately and is
  reported as an error. Misusing an API (wrong buffer length, out-of-bounds
  tile) is a programming error and panics.
- **One result, many speeds.** Every level returns the same bits, so levels can
  be swapped freely and checked against each other.
````

- [ ] **Step 2: Verify**

Run: `grep -c "four\|level 3\b" docs/design/architecture.md`
Expected: `0`. (The page now says "five implementations", numbers `streaming` as level 4, and only mentions `level 3` as `3 simd`.)

Run: `touch src/lib.rs && cargo doc --no-deps 2>&1 | grep -c "^warning"; cargo test --doc 2>&1 | grep -E "test result|FAILED"`
Expected: `0`, then `test result: ok.`

**Commit boundary 9.** File: `docs/design/architecture.md`. Suggested message: `rewrite the architecture page for five levels`.

---

### Task 10: Runtime `BlockConfig`: the driver takes closures, level 2 uses it

Cache-block sizes are constants (`TILE_K = 32`, `TILE_J = 64`). `BlockConfig` makes them runtime values, `NonZeroUsize` because `step_by(0)` panics. The shared driver's kernel parameter is a bare `fn` pointer and cannot carry a config, so it becomes a generic `Fn + Sync` closure. Level 2 gains `matmul_with_config`; `matmul` delegates with the defaults, so existing callers and results are untouched. The integration test compares raw bits against `naive` for degenerate (1 x 1), odd, default and oversized block sizes on order-sensitive operands.

**Files:**
- Modify: `src/threaded.rs`, `src/cache_friendly.rs`, `tests/levels.rs`

**Interfaces:**
- Produces: `naive_matmul::cache_friendly::BlockConfig` with `new(tile_k: NonZeroUsize, tile_j: NonZeroUsize)`, `tile_k() -> usize`, `tile_j() -> usize`, and `Default` (32, 64); derives `Debug, Clone, Copy, PartialEq, Eq`.
- Produces: `cache_friendly::matmul_with_config(a: &Matrix, b: &Matrix, threads: NonZeroUsize, block: &BlockConfig) -> Result<Matrix, DimensionMismatch>`.
- Changes (crate-private): `threaded::multiply_by_row_blocks<K>(a, b, threads, kernel: K)` where `K: Fn(&Matrix, &Matrix, usize, &mut [f64]) + Sync`.

- [ ] **Step 1: Write the failing test**

In `tests/levels.rs`, replace (include the final line break):

````text
use naive_matmul::streaming::StreamConfig;

````

with:

````text
use naive_matmul::cache_friendly::BlockConfig;
use naive_matmul::streaming::StreamConfig;

````

In `tests/levels.rs`, replace:

````text
#[test]
fn every_level_treats_the_identity_as_neutral() {
````

with:

````text
/// Cache-block sizes from degenerate (1 x 1) through odd sizes to larger than
/// any test matrix.
fn block_configs() -> Vec<BlockConfig> {
    [(1, 1), (3, 5), (7, 2), (32, 64), (1000, 1000)]
        .iter()
        .map(|&(tile_k, tile_j)| BlockConfig::new(nz(tile_k), nz(tile_j)))
        .collect()
}

#[test]
fn block_configs_never_change_the_bits() {
    for (m, n, p) in [(1, 1, 1), (9, 13, 11), (37, 23, 41), (70, 75, 133)] {
        let (a, b) = rough_operands(m, n, p);
        let reference = naive::matmul(&a, &b).unwrap();
        for block in block_configs() {
            for threads in [1, 3] {
                let t = nz(threads);
                let context = |level: &str| format!("{level}, {block:?}, shape {m}x{n}x{p}, {threads} thread(s)");
                let c2 = cache_friendly::matmul_with_config(&a, &b, t, &block).unwrap();
                assert_same_bits(&c2, &reference, &context("cache_friendly"));
            }
        }
    }
}

#[test]
fn every_level_treats_the_identity_as_neutral() {
````

- [ ] **Step 2: Run it to see the failure**

Run: `cargo test --test levels 2>&1 | grep -E "^error"`
Expected: `error[E0432]: unresolved import `naive_matmul::cache_friendly::BlockConfig``.

- [ ] **Step 3: Implement**

In `src/threaded.rs`, replace (include the final line break):

````text
/// The signature of a kernel that [`multiply_by_row_blocks`] can drive.
///
/// A kernel fills (or accumulates into) `c_block`, the rows of the output
/// starting at row `first_row`, reading `a` and `b`. The block is
/// zero-initialised by the driver, so both overwriting and accumulating kernels
/// produce the plain product.
pub(crate) type RowBlockKernel = fn(&Matrix, &Matrix, usize, &mut [f64]);


````

with nothing (delete it).

In `src/threaded.rs`, replace (include the final line break):

````text
/// Splits the output rows across `threads` scoped threads, running `kernel`
/// on each block.

````

with:

````text
/// Splits the output rows across `threads` scoped threads, running `kernel`
/// on each block.
///
/// `kernel(a, b, first_row, c_block)` fills (or accumulates into) `c_block`, the
/// rows of the output starting at row `first_row`, reading `a` and `b`. The
/// block is zero-initialised by the driver, so both overwriting and
/// accumulating kernels produce the plain product. The kernel is a closure so
/// that it can carry tuning parameters such as
/// [`BlockConfig`](crate::cache_friendly::BlockConfig).

````

In `src/threaded.rs`, replace (include the final line break):

````text
pub(crate) fn multiply_by_row_blocks(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    kernel: RowBlockKernel,
) -> Result<Matrix, DimensionMismatch> {

````

with:

````text
pub(crate) fn multiply_by_row_blocks<K>(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    kernel: K,
) -> Result<Matrix, DimensionMismatch>
where
    K: Fn(&Matrix, &Matrix, usize, &mut [f64]) + Sync,
{

````

In `src/threaded.rs`, replace:

````text
    thread::scope(|scope| {
        let mut remaining
````

with:

````text
    // Every thread shares one kernel by reference.
    let kernel = &kernel;

    thread::scope(|scope| {
        let mut remaining
````

In `src/cache_friendly.rs`, replace:

````text
/// Computes `y += alpha * x` element-wise over two equal-length slices.
````

with:

````text
/// Cache-block sizes for the kernels of levels 2, 3, and 4.
///
/// A cache block is a `tile_k × tile_j` piece of `B`: `tile_k` values of the
/// shared dimension by `tile_j` columns. It is walked for every row of the
/// output block while it is hot in cache. Neither size can be zero, so the
/// blocking loops always make progress.
///
/// The default is `32 × 64` (16 KiB of `f64`). Any sizes give the same bits:
/// blocking changes which products are *computed* together, never the order in
/// which one output element's products are *added*.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::cache_friendly::BlockConfig;
///
/// let default = BlockConfig::default();
/// assert_eq!((default.tile_k(), default.tile_j()), (32, 64));
///
/// let small = BlockConfig::new(NonZeroUsize::new(8).unwrap(), NonZeroUsize::new(16).unwrap());
/// assert_eq!((small.tile_k(), small.tile_j()), (8, 16));
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockConfig {
    tile_k: NonZeroUsize,
    tile_j: NonZeroUsize,
}

impl BlockConfig {
    /// Creates a configuration with the given block sizes.
    pub fn new(tile_k: NonZeroUsize, tile_j: NonZeroUsize) -> Self {
        Self { tile_k, tile_j }
    }

    /// Returns the number of shared-dimension values per block.
    pub fn tile_k(&self) -> usize {
        self.tile_k.get()
    }

    /// Returns the number of columns of `B` and `C` per block.
    pub fn tile_j(&self) -> usize {
        self.tile_j.get()
    }
}

impl Default for BlockConfig {
    /// The default blocks: 32 values of the shared dimension by 64 columns.
    fn default() -> Self {
        Self::new(
            NonZeroUsize::new(TILE_K).expect("default block size is non-zero"),
            NonZeroUsize::new(TILE_J).expect("default block size is non-zero"),
        )
    }
}

/// Computes `y += alpha * x` element-wise over two equal-length slices.
````

In `src/cache_friendly.rs`, replace (include the final line break):

````text
/// Loop structure, outermost first: block of `k`, block of `j`, row of the

````

with:

````text
/// The cache-block sizes come from `block`.
///
/// Loop structure, outermost first: block of `k`, block of `j`, row of the

````

In `src/cache_friendly.rs`, replace (include the final line break):

````text
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64]) {
    let n = a.cols();
    let p = b.cols();

    for k_start in (0..n).step_by(TILE_K) {
        let k_end = (k_start + TILE_K).min(n);

        for j_start in (0..p).step_by(TILE_J) {
            let j_end = (j_start + TILE_J).min(p);

````

with:

````text
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64], block: &BlockConfig) {
    let n = a.cols();
    let p = b.cols();

    for k_start in (0..n).step_by(block.tile_k()) {
        let k_end = (k_start + block.tile_k()).min(n);

        for j_start in (0..p).step_by(block.tile_j()) {
            let j_end = (j_start + block.tile_j()).min(p);

````

In `src/cache_friendly.rs`, replace:

````text
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(a, b, threads, multiply_row_block)
}
````

with:

````text
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    matmul_with_config(a, b, threads, &BlockConfig::default())
}

/// Like [`matmul`], with explicit cache-block sizes.
///
/// Results are bit-for-bit identical to [`matmul`] for every `block`; only the
/// speed changes.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::cache_friendly::{matmul_with_config, BlockConfig};
/// use naive_matmul::Matrix;
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let one = NonZeroUsize::new(1).unwrap();
/// let c = matmul_with_config(&a, &b, one, &BlockConfig::new(one, one))?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), naive_matmul::DimensionMismatch>(())
/// ```
pub fn matmul_with_config(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    block: &BlockConfig,
) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(a, b, threads, |a, b, first_row, c_block| {
        multiply_row_block(a, b, first_row, c_block, block)
    })
}
````

In `src/cache_friendly.rs`, replace:

````text
        multiply_row_block(&a, &b, 1, &mut block);
````

with:

````text
        multiply_row_block(&a, &b, 1, &mut block, &BlockConfig::default());
````

In `src/cache_friendly.rs`, replace:

````text
        multiply_row_block(&a, &b, 0, &mut block);
````

with:

````text
        multiply_row_block(&a, &b, 0, &mut block, &BlockConfig::default());
````

- [ ] **Step 4: Verify**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: all `ok`, no warnings; `block_configs_never_change_the_bits` passes, as do the `BlockConfig` and `matmul_with_config` doc tests.

Run: `touch src/lib.rs && cargo doc --no-deps 2>&1 | grep -c "^warning"`
Expected: `0`

**Commit boundary 10.** Files: `src/threaded.rs`, `src/cache_friendly.rs`, `tests/levels.rs`. Suggested message: `add BlockConfig and runtime block sizes for level 2`.

---

### Task 11: `BlockConfig` for level 3

Same change for the register-blocked level: `accumulate_tile` takes a `&BlockConfig`, and `simd::matmul_with_config` is added. The micro-tile (`MR`, `NR`) stays a compile-time constant because it sets array dimensions in the kernel; only the cache blocks around it become adjustable.

**Files:**
- Modify: `src/simd.rs`, `tests/levels.rs`

**Interfaces:**
- Consumes: `cache_friendly::BlockConfig` (Task 10).
- Produces: `simd::matmul_with_config(a: &Matrix, b: &Matrix, threads: NonZeroUsize, block: &BlockConfig) -> Result<Matrix, DimensionMismatch>`.
- Changes (crate-private): `simd::accumulate_tile(c, a, b, depth, cols, block: &BlockConfig)`.

- [ ] **Step 1: Extend the failing test**

In `tests/levels.rs`, replace (include the final line break):

````text
                assert_same_bits(&c2, &reference, &context("cache_friendly"));

````

with:

````text
                assert_same_bits(&c2, &reference, &context("cache_friendly"));
                let c3 = simd::matmul_with_config(&a, &b, t, &block).unwrap();
                assert_same_bits(&c3, &reference, &context("simd"));

````

- [ ] **Step 2: Run it to see the failure**

Run: `cargo test --test levels 2>&1 | grep -E "^error"`
Expected: `error[E0425]: cannot find function `matmul_with_config` in module `simd``.

- [ ] **Step 3: Implement**

In `src/simd.rs`, replace:

````text
use crate::cache_friendly::{axpy, TILE_J, TILE_K};
````

with:

````text
use crate::cache_friendly::{axpy, BlockConfig};
````

In `src/simd.rs`, replace:

````text
/// Edges (fewer than `MR` rows left, or fewer than `NR` columns left in a
/// cache block) fall back to `axpy`.
pub(crate) fn accumulate_tile(c: &mut [f64], a: &[f64], b: &[f64], depth: usize, cols: usize) {
````

with:

````text
/// Edges (fewer than `MR` rows left, or fewer than `NR` columns left in a
/// cache block) fall back to `axpy`. The cache-block sizes come from `block`.
pub(crate) fn accumulate_tile(
    c: &mut [f64],
    a: &[f64],
    b: &[f64],
    depth: usize,
    cols: usize,
    block: &BlockConfig,
) {
````

In `src/simd.rs`, replace (include the final line break):

````text
    for k_start in (0..depth).step_by(TILE_K) {
        let ks = k_start..(k_start + TILE_K).min(depth);

        for j_start in (0..cols).step_by(TILE_J) {
            let js = j_start..(j_start + TILE_J).min(cols);

````

with:

````text
    for k_start in (0..depth).step_by(block.tile_k()) {
        let ks = k_start..(k_start + block.tile_k()).min(depth);

        for j_start in (0..cols).step_by(block.tile_j()) {
            let js = j_start..(j_start + block.tile_j()).min(cols);

````

In `src/simd.rs`, replace:

````text
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64]) {
    let n = a.cols();
    let p = b.cols();
    let rows = c_block.len() / p;
    let a_block = &a.as_slice()[first_row * n..(first_row + rows) * n];
    accumulate_tile(c_block, a_block, b.as_slice(), n, p);
}
````

with:

````text
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64], block: &BlockConfig) {
    let n = a.cols();
    let p = b.cols();
    let rows = c_block.len() / p;
    let a_block = &a.as_slice()[first_row * n..(first_row + rows) * n];
    accumulate_tile(c_block, a_block, b.as_slice(), n, p, block);
}
````

In `src/simd.rs`, replace:

````text
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(a, b, threads, multiply_row_block)
}
````

with:

````text
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    matmul_with_config(a, b, threads, &BlockConfig::default())
}

/// Like [`matmul`], with explicit cache-block sizes.
///
/// The micro-tile shape stays fixed at compile time (see [`micro_tile_shape`]);
/// only the cache blocks around it are adjustable. Results are bit-for-bit
/// identical to [`matmul`] for every `block`.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::cache_friendly::BlockConfig;
/// use naive_matmul::{simd, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let one = NonZeroUsize::new(1).unwrap();
/// let c = simd::matmul_with_config(&a, &b, one, &BlockConfig::new(one, one))?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), naive_matmul::DimensionMismatch>(())
/// ```
pub fn matmul_with_config(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    block: &BlockConfig,
) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(a, b, threads, |a, b, first_row, c_block| {
        multiply_row_block(a, b, first_row, c_block, block)
    })
}
````

In `src/simd.rs`, replace (include the final line break):

````text
mod tests {
    use super::*;

````

with:

````text
mod tests {
    use super::*;
    use crate::cache_friendly::{TILE_J, TILE_K};

````

In `src/simd.rs`, replace:

````text
                    let mut c = vec![0.0; rows * cols];
                    accumulate_tile(&mut c, &a, &b, depth, cols);
````

with:

````text
                    let mut c = vec![0.0; rows * cols];
                    accumulate_tile(&mut c, &a, &b, depth, cols, &BlockConfig::default());
````

In `src/simd.rs`, replace:

````text
        let mut c = vec![100.0; rows * cols];
        accumulate_tile(&mut c, &a, &b, depth, cols);
````

with:

````text
        let mut c = vec![100.0; rows * cols];
        accumulate_tile(&mut c, &a, &b, depth, cols, &BlockConfig::default());
````

- [ ] **Step 4: Verify**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: all `ok`, no warnings; `block_configs_never_change_the_bits` now checks `simd` too.

**Commit boundary 11.** Files: `src/simd.rs`, `tests/levels.rs`. Suggested message: `add runtime cache-block sizes to level 3`.

---

### Task 12: `BlockConfig` for level 4

`StreamConfig` gains a `BlockConfig` (default: level 2's sizes), the private `Plan` carries it, and the flat-buffer kernel in `streaming/kernel.rs` uses it. This is where `CLAUDE.md`'s claim that level 4 reuses the micro-kernel is wrong: that file is level 2's `axpy` kernel, which is why `BlockConfig` lives in `cache_friendly`.

**Files:**
- Modify: `src/streaming/kernel.rs`, `src/streaming/multiply.rs`, `tests/levels.rs`

**Interfaces:**
- Consumes: `cache_friendly::BlockConfig` (Task 10), `Plan::new` (Task 8).
- Produces: `StreamConfig::with_block_config(self, block: BlockConfig) -> Self` and `StreamConfig::block_config(&self) -> BlockConfig`. `StreamConfig` still derives `Debug, Clone, Copy, PartialEq, Eq`.
- Changes (crate-private): `streaming::kernel::accumulate_tile(c, a, b, depth, cols, block: &BlockConfig)`.

- [ ] **Step 1: Extend the failing test**

In `tests/levels.rs`, replace (include the final line break):

````text
                assert_same_bits(&c3, &reference, &context("simd"));

````

with:

````text
                assert_same_bits(&c3, &reference, &context("simd"));

                let config = StreamConfig::new(t).with_tile_shape(16, 24, 20).with_block_config(block);
                let sink = streaming::MemorySink::new(m, p);
                streaming::matmul_streaming(&a, &b, &sink, &config).unwrap();
                assert_same_bits(&sink.into_matrix(), &reference, &context("streaming"));

````

- [ ] **Step 2: Run it to see the failure**

Run: `cargo test --test levels 2>&1 | grep -E "^error"`
Expected: `error[E0599]: no method named `with_block_config` found for struct `StreamConfig``.

- [ ] **Step 3: Implement**

In `src/streaming/kernel.rs`, replace:

````text
use crate::cache_friendly::{axpy, TILE_J, TILE_K};
````

with:

````text
use crate::cache_friendly::{axpy, BlockConfig};
````

In `src/streaming/kernel.rs`, replace:

````text
//! one difference: it works on three flat, contiguous tile buffers instead of
//! on whole `Matrix` values. It reuses level 2's `axpy` inner loop and its
//! cache-block constants unchanged.
````

with:

````text
//! one difference: it works on three flat, contiguous tile buffers instead of
//! on whole `Matrix` values. It reuses level 2's `axpy` inner loop and takes
//! its cache-block sizes from a [`BlockConfig`] (default: level 2's constants).
````

In `src/streaming/kernel.rs`, replace:

````text
/// to build up a full product.
pub(crate) fn accumulate_tile(c: &mut [f64], a: &[f64], b: &[f64], depth: usize, cols: usize) {
````

with:

````text
/// to build up a full product. The cache-block sizes come from `block`.
pub(crate) fn accumulate_tile(
    c: &mut [f64],
    a: &[f64],
    b: &[f64],
    depth: usize,
    cols: usize,
    block: &BlockConfig,
) {
````

In `src/streaming/kernel.rs`, replace (include the final line break):

````text
    for k_start in (0..depth).step_by(TILE_K) {
        let k_end = (k_start + TILE_K).min(depth);

        for j_start in (0..cols).step_by(TILE_J) {
            let j_end = (j_start + TILE_J).min(cols);

````

with:

````text
    for k_start in (0..depth).step_by(block.tile_k()) {
        let k_end = (k_start + block.tile_k()).min(depth);

        for j_start in (0..cols).step_by(block.tile_j()) {
            let j_end = (j_start + block.tile_j()).min(cols);

````

In `src/streaming/kernel.rs`, replace:

````text
        accumulate_tile(&mut c, &a, &b, 3, 2);
````

with:

````text
        accumulate_tile(&mut c, &a, &b, 3, 2, &BlockConfig::default());
````

In `src/streaming/kernel.rs`, replace:

````text
        accumulate_tile(&mut c, &[1.0, 2.0], &[3.0, 4.0], 2, 1);
````

with:

````text
        accumulate_tile(&mut c, &[1.0, 2.0], &[3.0, 4.0], 2, 1, &BlockConfig::default());
````

In `src/streaming/multiply.rs`, replace:

````text
use crate::error::{check_inner_dimensions, MatmulError};
use crate::matrix::Matrix;
````

with:

````text
use crate::cache_friendly::BlockConfig;
use crate::error::{check_inner_dimensions, MatmulError};
use crate::matrix::Matrix;
````

In `src/streaming/multiply.rs`, replace:

````text
    tile_cols: NonZeroUsize,
    tile_depth: NonZeroUsize,
}

impl StreamConfig {
````

with:

````text
    tile_cols: NonZeroUsize,
    tile_depth: NonZeroUsize,
    block: BlockConfig,
}

impl StreamConfig {
````

In `src/streaming/multiply.rs`, replace:

````text
            tile_depth: tile,
        }
    }
````

with:

````text
            tile_depth: tile,
            block: BlockConfig::default(),
        }
    }
````

In `src/streaming/multiply.rs`, replace:

````text
    /// Returns the number of worker threads.
````

with:

````text
    /// Sets the cache-block sizes used by the kernel inside each tile.
    ///
    /// They are independent of the tile shape: the tile shape decides how much
    /// data each worker holds, the cache blocks decide how the kernel walks it.
    /// Results are bit-for-bit identical for every choice.
    ///
    /// # Examples
    ///
    /// ```
    /// use std::num::NonZeroUsize;
    /// use naive_matmul::cache_friendly::BlockConfig;
    /// use naive_matmul::streaming::StreamConfig;
    ///
    /// let one = NonZeroUsize::new(1).unwrap();
    /// let block = BlockConfig::new(NonZeroUsize::new(8).unwrap(), NonZeroUsize::new(16).unwrap());
    /// let config = StreamConfig::new(one).with_block_config(block);
    /// assert_eq!(config.block_config(), block);
    /// ```
    pub fn with_block_config(mut self, block: BlockConfig) -> Self {
        self.block = block;
        self
    }

    /// Returns the cache-block sizes used by the kernel inside each tile.
    pub fn block_config(&self) -> BlockConfig {
        self.block
    }

    /// Returns the number of worker threads.
````

In `src/streaming/multiply.rs`, replace:

````text
    /// Total number of output tiles.
    total_tiles: usize,
}
````

with:

````text
    /// Total number of output tiles.
    total_tiles: usize,
    /// Cache-block sizes for the kernel.
    block: BlockConfig,
}
````

In `src/streaming/multiply.rs`, replace:

````text
            tiles_per_row,
            total_tiles,
        }
    }
````

with:

````text
            tiles_per_row,
            total_tiles,
            block: config.block_config(),
        }
    }
````

In `src/streaming/multiply.rs`, replace:

````text
        accumulate_tile(c_tile, a_tile, b_tile, depth, cols);
````

with:

````text
        accumulate_tile(c_tile, a_tile, b_tile, depth, cols, &plan.block);
````

In `src/streaming/multiply.rs`, replace (include the final line break):

````text
        assert_eq!(config.tile_shape(), (256, 256, 256));

````

with:

````text
        assert_eq!(config.tile_shape(), (256, 256, 256));
        assert_eq!(config.block_config(), BlockConfig::default());

````

- [ ] **Step 4: Verify everything**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: all `ok`, no warnings.

Run: `cargo test --release 2>&1 | grep -E "FAILED|^error"; cargo clippy --all-targets 2>&1 | grep -E "^(warning|error)"`
Expected: no output from either.

Run: `touch src/lib.rs && cargo doc --no-deps 2>&1 | grep -c "^warning"`
Expected: `0`

**Commit boundary 12.** Files: `src/streaming/kernel.rs`, `src/streaming/multiply.rs`, `tests/levels.rs`. Suggested message: `add runtime cache-block sizes to level 4 via StreamConfig`.

---

### Task 13: Make README and CLAUDE.md match the code

The README still says "four implementation modules", describes three prose modules and pages that were never written, and says level 4 reuses the micro-kernel. `CLAUDE.md` carries a "Known issue" section that Task 1 resolved and several statements this plan changed or found false.

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Apply the README edits**

In `README.md`, replace:

````text
The four implementation modules are the story:
````

with:

````text
The five implementation modules are the story:
````

In `README.md`, replace:

````text
and what it costs. Three further modules hold the other pages:
````

with:

````text
and what it costs. Two further modules hold the other pages:
````

In `README.md`, replace (include the final line break):

````text
| `naive_matmul::guide`     | Getting started, in-memory and out-of-core use, custom sources and sinks, tuning, errors |
| `naive_matmul::design`    | How the levels build on each other, cost model, concurrency, numerics  |
| `naive_matmul::reference` | On-disk file format, testing, limitations and roadmap, glossary        |

````

with:

````text
| `naive_matmul::guide`     | Getting started, and using the levels on in-memory matrices            |
| `naive_matmul::design`    | How the levels build on each other                                     |

````

In `README.md`, replace:

````text
├── simd.rs              level 3 (the micro-kernel; level 4 reuses it)
````

with:

````text
├── simd.rs              level 3 (the register-blocked micro-kernel)
````

In `README.md`, replace:

````text
├── guide.rs, design.rs, reference.rs   include the Markdown pages (docs/doctests only)
````

with:

````text
├── guide.rs, design.rs                 include the Markdown pages (docs/doctests only)
````

In `README.md`, replace (include the final line break):

````text
├── guide/               getting_started, in_memory, out_of_core, custom_io, tuning, errors
├── design/              architecture, cost_model, concurrency, numerics
└── reference/           file_format, testing, limitations, glossary

````

with:

````text
├── guide/               getting_started, in_memory
└── design/              architecture

````

- [ ] **Step 2: Apply the CLAUDE.md edits**

In `CLAUDE.md`, replace:

````text
- `threaded.rs` owns the row-block partitioning + scoped-thread driver, which levels 2 and 3 reuse with a different kernel.
````

with:

````text
- `threaded.rs` owns `row_block_plan` (the row partition) and the scoped-thread driver, which levels 2 and 3 reuse with a different kernel passed as a closure.
````

In `CLAUDE.md`, replace:

````text
- `cache_friendly.rs` owns `axpy` and the cache-block size constants, reused by `simd.rs` and `streaming`.
````

with:

````text
- `cache_friendly.rs` owns `axpy`, the default cache-block constants and `BlockConfig` (runtime cache-block sizes, also taken by `simd.rs` and `StreamConfig`).
````

In `CLAUDE.md`, replace:

````text
- `simd.rs` holds the register-blocked micro-kernel that level 4 reuses; vectorisation comes from the auto-vectoriser, not intrinsics (hence no `unsafe`).
````

with:

````text
- `simd.rs` holds the register-blocked micro-kernel (level 4 does *not* use it: `streaming/kernel.rs` is level 2's `axpy` kernel on flat buffers); vectorisation comes from the auto-vectoriser, not intrinsics (hence no `unsafe`). The micro-tile `MR`×`NR` is a compile-time constant.
````

In `CLAUDE.md`, replace:

````text
`multiply.rs` (`StreamConfig`, `matmul_streaming`, work queue)
````

with:

````text
`multiply.rs` (`StreamConfig`, `matmul_streaming`, `tile_plan`, work queue)
````

In `CLAUDE.md`, replace:

````text
`tests/levels.rs` asserts exact equality across all levels.
````

with:

````text
`tests/levels.rs` compares the raw bits (`to_bits`) of all five levels, on small-integer operands and on order-sensitive `rough_operands`, across several `BlockConfig` values.
````

In `CLAUDE.md`, replace:

````text
## Known issue

`lib.rs` declares `#[cfg(any(doc, doctest))] pub mod design / guide / reference;`, but `src/design.rs`, `src/guide.rs`, `src/reference.rs` do not exist yet, and `docs/reference/` is empty (only `design/architecture.md`, `guide/getting_started.md`, `guide/in_memory.md` exist). Normal `cargo build`/`cargo test` skip these, but `cargo doc` and `cargo test --doc` will fail to compile until they're added (they should just `#![doc = include_str!(...)]` the Markdown pages). The README and `architecture.md` also describe a "four implementations / level 3 = streaming" numbering and pages (`cost_model`, `concurrency`, `numerics`, etc.) that predate/exceed what is on disk; the source (five levels, `simd` = 3) is authoritative.
````

with:

````text
## Docs layout

`lib.rs` declares `#[cfg(any(doc, doctest))] pub mod design / guide;`, whose submodules (`src/design/`, `src/guide/`) just `#![doc = include_str!(...)]` the Markdown pages under `docs/`. Only `design/architecture.md`, `guide/getting_started.md` and `guide/in_memory.md` exist; pages the older prose referred to (`out_of_core`, `custom_io`, `tuning`, `errors`, `cost_model`, `numerics`, `reference/*`) were never written and their links were removed. The source (five levels, `simd` = 3, `streaming` = 4) is authoritative.
````

- [ ] **Step 3: Verify**

Run: `grep -n "reference\|four\|reuses it" README.md CLAUDE.md`
Expected: no line mentions a `reference` module, "four" implementations, or level 4 reusing the micro-kernel. (A match on the word "reference" in the sense of "reference implementation" is fine.)

Run: `cargo test 2>&1 | grep -E "FAILED|^error"`
Expected: no output (the README is the crate's `readme`; its Rust code block is not compiled, but this confirms nothing else broke).

**Commit boundary 13.** Files: `README.md`, `CLAUDE.md`. Suggested message: `bring README and CLAUDE.md in line with the five-level code`.

---

### Task 14: CI jobs for the minimum Rust version and for wasm32

Spec A6: the MSRV (1.73) is currently untested because `rust.yml` runs only `stable`, and the website needs the library to compile for `wasm32-unknown-unknown`. The existing `build` job is left exactly as it is; two jobs are added.

**Files:**
- Modify (replace entire contents): `.github/workflows/rust.yml`

- [ ] **Step 1: Replace the file**

````yaml
name: Rust

on:
  push:
    branches: [ "trunk" ]
  pull_request:
    branches: [ "trunk" ]

env:
  CARGO_TERM_COLOR: always

jobs:
  build:

    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v4
    - name: Build
      run: cargo build --verbose
    - name: Run tests
      run: cargo test --verbose

  # The crate promises Rust 1.73 (Cargo.toml `rust-version`); build with exactly
  # that toolchain so new public API cannot silently need something newer.
  msrv:

    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@master
      with:
        toolchain: "1.73"
    - name: Build with the minimum supported Rust version
      run: cargo build --verbose

  # The website runs the library as WebAssembly. Keep it compiling for wasm32.
  wasm-check:

    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
      with:
        targets: wasm32-unknown-unknown
    - name: Check the library for wasm32
      run: cargo check --lib --verbose --target wasm32-unknown-unknown
````

- [ ] **Step 2: Validate the YAML locally**

Run: `python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/rust.yml')); print(sorted(d['jobs']))"`
Expected: `['build', 'msrv', 'wasm-check']` (if PyYAML is not installed, skip; GitHub validates on push).

- [ ] **Step 3 (human): Check both jobs for real**

Locally (optional): `! rustup toolchain install 1.73 && cargo +1.73 build` (expected: `Finished`), and `! rustup target add wasm32-unknown-unknown && cargo check --lib --target wasm32-unknown-unknown` (expected: `Finished`). Otherwise the first push to a branch shows the result. **If either job fails, stop and report the error**; the likely cause is a post-1.73 feature in the new code (for the MSRV job) or a std API unavailable on wasm32 (for the wasm job). Do not change the job to hide it.

**Commit boundary 14.** File: `.github/workflows/rust.yml`. Suggested message: `ci: build on the MSRV toolchain and check the wasm32 target`.

---

### Task 15: Repo hygiene for the website directories

Spec A7. The published crate should not include the site, animations or workflows; the root `Cargo.lock` ignore must not swallow the wrapper crate's lockfile (stage C tracks `web/wasm/Cargo.lock`); and the Python-template `lib/` ignore rule silently matches `web/site/src/lib/` at any depth, so it is anchored to the repo root. The `web/` directory does not exist yet; these rules are inert until it does.

**Files:**
- Modify: `Cargo.toml`, `.gitignore`

- [ ] **Step 1: Apply the edits**

In `Cargo.toml`, replace (include the final line break):

````text
readme = "README.md"

````

with:

````text
readme = "README.md"
exclude = ["web/", "anim/", ".github/", "docs/superpowers/"]

````

In `.gitignore`, replace (include the final line break):

````text
lib/
lib64/

````

with:

````text
/lib/
/lib64/

````

In `.gitignore`, replace:

````text
anim/media/videos/**/partial_movie_files
````

with:

````text
anim/media/videos/**/partial_movie_files

# Website (see docs/superpowers/specs/2026-11-05-website-design.md)
node_modules/
.astro/
web/wasm/pkg/
!web/wasm/Cargo.lock
````

- [ ] **Step 2: Verify the ignore rules**

Run each of these; the exit status is what matters (`0` = ignored, `1` = not ignored):

```bash
git check-ignore -q web/site/src/lib/x.ts;   echo $?   # expect 1 (a source directory named lib/ is NOT ignored)
git check-ignore -q web/wasm/Cargo.lock;     echo $?   # expect 1 (the wrapper's lockfile is tracked)
git check-ignore -q Cargo.lock;              echo $?   # expect 0 (the crate's own lockfile is still ignored)
git check-ignore -q web/wasm/pkg/x.js;       echo $?   # expect 0
git check-ignore -q web/site/node_modules/x; echo $?   # expect 0
git check-ignore -q web/site/.astro/x;       echo $?   # expect 0
```

- [ ] **Step 3: Verify the package contents**

Run: `cargo package --list --allow-dirty 2>/dev/null | grep -c "superpowers\|\.github\|^web/\|^anim/"`
Expected: `0`

Run: `cargo package --list --allow-dirty 2>/dev/null | grep -c "docs/levels/naive.md"`
Expected: `1` (the docs are `include_str!`'d, so they must stay in the package).

**Commit boundary 15.** Files: `Cargo.toml`, `.gitignore`. Suggested message: `exclude site and media from the package; fix ignore rules for web/`.

---

## Self-review against the spec (Stage A)

| Spec item | Task |
|---|---|
| A1 Make CI green (doc modules, drop `reference`) | 1 (plus 2 for dead links, 13 for CLAUDE.md) |
| A2 Fix stale prose | 4, 9 (and the false claims in 12/13) |
| A3 Invariant tests that can fail | 3, extended in 10 to 12 |
| A4 Public plan functions | 7 (`row_block_plan`), 8 (`tile_plan`) |
| A5 Runtime `BlockConfig`, merge level 2's driver, closure kernel, micro-tile stays const | 6, 10, 11, 12 |
| A6 `simd128`, MSRV job, wasm32 check | 5, 14 |
| A7 Repo hygiene | 15 |

**Deliberate decisions to review:**
- `row_block_plan` is public in `naive_matmul::threaded` and `tile_plan`/`TilePlan`/`OutputTile` in `naive_matmul::streaming`; `BlockConfig` is public in `naive_matmul::cache_friendly` (not re-exported at the crate root).
- The architecture page is rewritten in Task 9, after the code it describes exists, rather than with the other prose fixes in Task 4.
- `reference` was dropped rather than written; the guide and architecture pages stay out of the site's v1 (spec stage C).
- The `streaming.md` chapter keeps comparing against level 2 on purpose: level 4 reuses level 2's kernel.

## What comes next

Stage C (the Astro site on stable, single-threaded WASM) needs its own plan once this is merged. The runner trait and `*_with_runner` entry points (needed only for threads in the browser) belong to stage B.
