# Stage B Spike, Part One: Worker Pool and the Real Crate (Gates G1 and G2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A` or `git add .`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Prove, with scripted headless-browser gates, that the real `naive_matmul` levels 1 to 3 can run on a thread pool in a browser and return bit-for-bit the native answer (gates G1 and G2 of the stage B spec), and keep the code that does it.

**Architecture:** A small public `Runner` trait in the core crate replaces the hard-wired `std::thread::scope` (which traps on `wasm32-unknown-unknown`). A separate wrapper crate `web/wasm` (pinned nightly, its own workspace) supplies a rayon-backed runner through `wasm-bindgen-rayon`. A standard-library-only Python server plus headless Firefox runs each gate and a script decides pass or fail.

**Tech Stack:** Rust stable 1.73+ for the core crate; `nightly-2025-11-15` with `rust-src` for the wrapper; `wasm-bindgen` crate and CLI `0.2.130`; `wasm-bindgen-rayon` 1.3; `rayon` 1.12; Firefox (headless); Python 3 standard library.

**Spec:** `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-design.md` (gates G1 and G2; this part does not cover G3 to G5).

## Global Constraints

- `naive_matmul` stays dependency-free, `#![forbid(unsafe_code)]`, MSRV 1.73 (no features newer than 1.73). The nightly toolchain and every wasm dependency live only in `web/wasm/`; the core crate must still build and test on stable and on 1.73.
- Every level returns bit-for-bit identical results: each output element is summed in increasing `k` order starting from zero. A runner changes where jobs run, never what they compute.
- New public API is additive. Existing `matmul` functions keep their signatures and results.
- `web/wasm` has an empty `[workspace]` table and a tracked `Cargo.lock`; `wasm-bindgen` is pinned with `=0.2.130` to match the installed CLI.
- Never glob `docs/**`; `docs/superpowers/` is not product documentation.
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- `rustup toolchain list` shows `nightly-2025-11-15` (with `rust-src` and the `wasm32-unknown-unknown` target) and `1.73`.
- The `wasm-bindgen` CLI 0.2.130 is at `$HOME/.cargo/bin/wasm-bindgen`. It may not be on `PATH`: in every shell that runs the gates, `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`.
- Firefox is installed (`firefox --version`). The gates run it headless with a throwaway profile.
- Use a separate target directory for builds if you like: `export CARGO_TARGET_DIR=...` is honoured by every script here.

## Verified beforehand

The code in this plan was built and run end to end on this machine before the plan was written: the core tests and checks pass (43 unit, 11 integration, 27 doc tests; clippy and rustdoc clean; builds on 1.73; `cargo check --target wasm32-unknown-unknown` passes), and the three gates pass in headless Firefox 159. If any step's result differs from what a step states, stop and report BLOCKED with the output.

---

### Task 1: A `Runner` trait for levels 1 to 3

`std::thread::scope` compiles for `wasm32-unknown-unknown` but traps when it runs (a probe in Task 3 shows this in a browser). The row-block jobs therefore go through a small trait: `StdRunner` keeps today's behaviour, any other executor can be passed to the new `*_with_runner` functions, and every existing function delegates with `StdRunner`. Level 4 has its own worker loop and is not changed here (stage B part two).

**Files:**
- Create: `src/runner.rs`, `docs/design/runner.md`
- Modify: `src/lib.rs`, `src/threaded.rs`, `src/cache_friendly.rs`, `src/simd.rs`, `tests/levels.rs`

**Interfaces:**
- Produces: `naive_matmul::runner::Runner` (`trait Runner: Sync { fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>); }`), `naive_matmul::runner::StdRunner` (unit struct, `Debug, Clone, Copy, Default, PartialEq, Eq`).
- Produces: `threaded::matmul_with_runner<R: Runner + ?Sized>(a, b, threads: NonZeroUsize, runner: &R) -> Result<Matrix, DimensionMismatch>`.
- Produces: `cache_friendly::matmul_with_runner` and `simd::matmul_with_runner`, both `<R: Runner + ?Sized>(a, b, threads: NonZeroUsize, block: &BlockConfig, runner: &R) -> Result<Matrix, DimensionMismatch>`.
- Changes (crate-private): `threaded::multiply_by_row_blocks<K, R>(a, b, threads, kernel: K, runner: &R)`.

- [ ] **Step 1: Write the failing tests**


In `tests/levels.rs`, replace (include the final line break):

````text
use naive_matmul::cache_friendly::BlockConfig;

````

with:

````text
use std::sync::atomic::{AtomicUsize, Ordering};

use naive_matmul::cache_friendly::BlockConfig;
use naive_matmul::runner::{Runner, StdRunner};
use naive_matmul::threaded::row_block_plan;

````

In `tests/levels.rs`, replace:

````text
#[test]
fn every_level_treats_the_identity_as_neutral() {
````

with:

````text
/// Runs every job on the calling thread, one after another, and counts them.
struct CountingInline {
    jobs: AtomicUsize,
}

impl CountingInline {
    fn new() -> Self {
        Self { jobs: AtomicUsize::new(0) }
    }

    fn jobs(&self) -> usize {
        self.jobs.load(Ordering::SeqCst)
    }
}

impl Runner for CountingInline {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        self.jobs.fetch_add(jobs.len(), Ordering::SeqCst);
        for job in jobs {
            job();
        }
    }
}

#[test]
fn runners_never_change_the_bits() {
    for (m, n, p) in [(1, 1, 1), (9, 13, 11), (37, 23, 41), (70, 75, 133)] {
        let (a, b) = rough_operands(m, n, p);
        let reference = naive::matmul(&a, &b).unwrap();
        for threads in [1, 3, 8] {
            let t = nz(threads);
            let jobs_expected = row_block_plan(m, t).len();
            let context = |level: &str, runner: &str| {
                format!("{level}, {runner}, shape {m}x{n}x{p}, {threads} thread(s)")
            };

            let inline = CountingInline::new();
            let c = threaded::matmul_with_runner(&a, &b, t, &inline).unwrap();
            assert_same_bits(&c, &reference, &context("threaded", "inline"));
            assert_eq!(inline.jobs(), jobs_expected, "{}", context("threaded", "job count"));
            let c = threaded::matmul_with_runner(&a, &b, t, &StdRunner).unwrap();
            assert_same_bits(&c, &reference, &context("threaded", "std"));

            for block in block_configs() {
                let inline = CountingInline::new();
                let c = cache_friendly::matmul_with_runner(&a, &b, t, &block, &inline).unwrap();
                assert_same_bits(&c, &reference, &context("cache_friendly", &format!("inline {block:?}")));
                assert_eq!(inline.jobs(), jobs_expected, "{}", context("cache_friendly", "job count"));

                let inline = CountingInline::new();
                let c = simd::matmul_with_runner(&a, &b, t, &block, &inline).unwrap();
                assert_same_bits(&c, &reference, &context("simd", &format!("inline {block:?}")));
                assert_eq!(inline.jobs(), jobs_expected, "{}", context("simd", "job count"));

                let c = simd::matmul_with_runner(&a, &b, t, &block, &StdRunner).unwrap();
                assert_same_bits(&c, &reference, &context("simd", &format!("std {block:?}")));
            }
        }
    }
}

#[test]
fn an_empty_product_hands_the_runner_no_jobs() {
    let block = BlockConfig::default();
    for (m, n, p) in [(0, 3, 2), (2, 3, 0), (0, 3, 0)] {
        let (a, b) = (Matrix::zeros(m, n), Matrix::zeros(n, p));
        let inline = CountingInline::new();
        threaded::matmul_with_runner(&a, &b, nz(4), &inline).unwrap();
        cache_friendly::matmul_with_runner(&a, &b, nz(4), &block, &inline).unwrap();
        simd::matmul_with_runner(&a, &b, nz(4), &block, &inline).unwrap();
        assert_eq!(inline.jobs(), 0, "shape {m}x{n}x{p}");
    }
}

#[test]
fn every_level_treats_the_identity_as_neutral() {
````

- [ ] **Step 2: Run them to see the failure**

Run: `cargo test --test levels 2>&1 | grep -E "^error"`
Expected: `error[E0432]: unresolved import `naive_matmul::runner`` and several `error[E0425]: cannot find function `matmul_with_runner`` (for `threaded`, `cache_friendly` and `simd`).

- [ ] **Step 3: Add the runner module and its docs**


Create `src/runner.rs`:

````rust
#![doc = include_str!("../docs/design/runner.md")]

/// Runs a batch of jobs to completion.
///
/// Levels 1 to 3 split the output rows into blocks and hand one job per block
/// to a `Runner`. A job borrows from the caller (`'env`), so `run` must not
/// return until every job has finished. Jobs are independent: they may run in
/// any order, on any threads, or one after another on the calling thread.
///
/// See the [module documentation](self) for an example.
pub trait Runner: Sync {
    /// Runs every job in `jobs`, returning only when all have finished.
    ///
    /// A panic inside a job must reach the caller of `run`, as with
    /// [`std::thread::scope`].
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>);
}

/// The default [`Runner`]: one scoped standard-library thread per job.
///
/// Every `matmul` function without a `_with_runner` suffix uses this. It does
/// not work on targets without operating-system threads, such as
/// `wasm32-unknown-unknown`; use another [`Runner`] there.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StdRunner;

impl Runner for StdRunner {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        std::thread::scope(|scope| {
            for job in jobs {
                scope.spawn(job);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn std_runner_runs_every_job_and_waits_for_them() {
        let done = AtomicUsize::new(0);
        let jobs: Vec<Box<dyn FnOnce() + Send + '_>> = (0..8)
            .map(|_| {
                let done = &done;
                Box::new(move || {
                    done.fetch_add(1, Ordering::SeqCst);
                }) as Box<dyn FnOnce() + Send + '_>
            })
            .collect();
        StdRunner.run(jobs);
        assert_eq!(done.load(Ordering::SeqCst), 8);
    }

    #[test]
    fn std_runner_lets_jobs_write_disjoint_borrowed_slices() {
        let mut data = vec![0_u32; 6];
        let jobs: Vec<Box<dyn FnOnce() + Send + '_>> = data
            .chunks_mut(2)
            .enumerate()
            .map(|(i, chunk)| {
                Box::new(move || chunk.fill(i as u32 + 1)) as Box<dyn FnOnce() + Send + '_>
            })
            .collect();
        StdRunner.run(jobs);
        assert_eq!(data, [1, 1, 2, 2, 3, 3]);
    }

    #[test]
    fn std_runner_with_no_jobs_returns_immediately() {
        StdRunner.run(Vec::new());
    }
}
````

Create `docs/design/runner.md`:

````markdown
# Running the row blocks on your own executor

Levels 1 to 3 split the output rows into blocks (see
[`row_block_plan`](crate::threaded::row_block_plan)) and compute each block as
an independent job. By default every job gets a scoped standard-library thread.
A [`Runner`] replaces that step, so the same kernels can run on a thread pool, in
a test, or on a target that has no operating-system threads.

[`StdRunner`] is the default. The `_with_runner` functions
([`threaded::matmul_with_runner`](crate::threaded::matmul_with_runner),
[`cache_friendly::matmul_with_runner`](crate::cache_friendly::matmul_with_runner),
[`simd::matmul_with_runner`](crate::simd::matmul_with_runner)) take any other.

A runner must run every job and return only when all have finished. It does not
change the answer: each job writes its own rows, so results are bit-for-bit
identical whichever runner executes them.

```rust
use std::num::NonZeroUsize;
use naive_matmul::runner::Runner;
use naive_matmul::{threaded, Matrix};

/// Runs every job on the calling thread, one after another.
struct Inline;

impl Runner for Inline {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        for job in jobs {
            job();
        }
    }
}

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let threads = NonZeroUsize::new(2).unwrap();
let c = threaded::matmul_with_runner(&a, &b, threads, &Inline)?;
assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
# Ok::<(), naive_matmul::DimensionMismatch>(())
```

Level 4 ([`streaming`](crate::streaming)) has its own worker loop and does not
use a `Runner` yet.
````

- [ ] **Step 4: Wire it into the crate and the three levels**

In `src/lib.rs`, replace (include the final line break):

````text
pub mod naive;
pub mod simd;
pub mod streaming;
pub mod threaded;

````

with:

````text
pub mod naive;
pub mod runner;
pub mod simd;
pub mod streaming;
pub mod threaded;

````

In `src/threaded.rs`, replace (include the final line break):

````text
use std::num::NonZeroUsize;
use std::ops::Range;
use std::thread;

use crate::error::{check_inner_dimensions, DimensionMismatch};
use crate::matrix::Matrix;

````

with:

````text
use std::num::NonZeroUsize;
use std::ops::Range;

use crate::error::{check_inner_dimensions, DimensionMismatch};
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};

````

In `src/threaded.rs`, replace:

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

with:

````text
pub(crate) fn multiply_by_row_blocks<K, R>(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    kernel: K,
    runner: &R,
) -> Result<Matrix, DimensionMismatch>
where
    K: Fn(&Matrix, &Matrix, usize, &mut [f64]) + Sync,
    R: Runner + ?Sized,
{
````

In `src/threaded.rs`, replace (include the final line break):

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

with:

````text
    // One job per row block; the runner decides where and when each one runs.
    let mut jobs: Vec<Box<dyn FnOnce() + Send + '_>> = Vec::new();
    let mut remaining = c.as_mut_slice();
    for block in row_block_plan(m, threads) {
        let (c_block, rest) = std::mem::take(&mut remaining).split_at_mut(block.len() * p);
        remaining = rest;
        let first_row = block.start;
        jobs.push(Box::new(move || kernel(a, b, first_row, c_block)));
    }
    runner.run(jobs);

````

In `src/threaded.rs`, replace:

````text
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(a, b, threads, multiply_row_block)
}
````

with:

````text
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    matmul_with_runner(a, b, threads, &StdRunner)
}

/// Like [`matmul`], with the row blocks executed by `runner`.
///
/// [`matmul`] uses [`StdRunner`]. Results are bit-for-bit identical for every
/// runner. See the [`runner`](crate::runner) module for an example.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
pub fn matmul_with_runner<R: Runner + ?Sized>(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    runner: &R,
) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(a, b, threads, multiply_row_block, runner)
}
````

In `src/cache_friendly.rs`, replace (include the final line break):

````text
use crate::matrix::Matrix;
use crate::threaded::multiply_by_row_blocks;

````

with:

````text
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};
use crate::threaded::multiply_by_row_blocks;

````

In `src/cache_friendly.rs`, replace:

````text
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

with:

````text
pub fn matmul_with_config(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    block: &BlockConfig,
) -> Result<Matrix, DimensionMismatch> {
    matmul_with_runner(a, b, threads, block, &StdRunner)
}

/// Like [`matmul_with_config`], with the row blocks executed by `runner`.
///
/// Results are bit-for-bit identical for every `block` and every runner. See
/// the [`runner`](crate::runner) module for an example.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
pub fn matmul_with_runner<R: Runner + ?Sized>(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    block: &BlockConfig,
    runner: &R,
) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(
        a,
        b,
        threads,
        |a, b, first_row, c_block| multiply_row_block(a, b, first_row, c_block, block),
        runner,
    )
}
````

In `src/simd.rs`, replace (include the final line break):

````text
use crate::matrix::Matrix;
use crate::threaded::multiply_by_row_blocks;

````

with:

````text
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};
use crate::threaded::multiply_by_row_blocks;

````

In `src/simd.rs`, replace:

````text
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

with:

````text
pub fn matmul_with_config(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    block: &BlockConfig,
) -> Result<Matrix, DimensionMismatch> {
    matmul_with_runner(a, b, threads, block, &StdRunner)
}

/// Like [`matmul_with_config`], with the row blocks executed by `runner`.
///
/// Results are bit-for-bit identical for every `block` and every runner. See
/// the [`runner`](crate::runner) module for an example.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
pub fn matmul_with_runner<R: Runner + ?Sized>(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    block: &BlockConfig,
    runner: &R,
) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(
        a,
        b,
        threads,
        |a, b, first_row, c_block| multiply_row_block(a, b, first_row, c_block, block),
        runner,
    )
}
````

- [ ] **Step 5: Verify**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: every `test result` is `ok`, no warnings. Counts: 43 unit (three new in `runner`), 11 integration in `levels` (two new), 14 streaming, 27 doc tests (the `runner` page adds one).

Run: `rm -rf target/doc && cargo doc --no-deps 2>&1 | grep -c "^warning"`
Expected: `0`

Run: `cargo clippy --all-targets 2>&1 | grep -E "^(warning|error)"; cargo +1.73 build 2>&1 | grep -E "^(warning|error)"; cargo check --lib --target wasm32-unknown-unknown 2>&1 | grep -E "^(warning|error)"`
Expected: no output from any of the three.

- [ ] **Step 6: Commit**

```bash
git add src/runner.rs docs/design/runner.md src/lib.rs src/threaded.rs src/cache_friendly.rs src/simd.rs tests/levels.rs
git commit -m "add Runner so the row blocks can run on any executor"
```

---

### Task 2: The wasm wrapper crate

A separate crate that depends on `naive_matmul` by path, adds the rayon-backed runner, and holds the shared test cases (a deterministic order-sensitive operand generator and a bit hash) so the browser and a native run compute the same thing. It builds on the pinned nightly; native `cargo test` for it also uses that nightly through `rust-toolchain.toml`.

The unit tests live in `cases.rs` with the code they cover, so they are written together in this task rather than red-then-green; the native test run in Step 3 is the check.

**Files:**
- Create: `web/wasm/Cargo.toml`, `web/wasm/rust-toolchain.toml`, `web/wasm/.cargo/config.toml`, `web/wasm/src/cases.rs`, `web/wasm/src/lib.rs`, `web/wasm/examples/expected.rs`, `web/wasm/Cargo.lock` (generated)

**Interfaces:**
- Consumes: `naive_matmul::runner::{Runner, StdRunner}`, `threaded/cache_friendly/simd::matmul_with_runner`, `BlockConfig` (Task 1 and stage A).
- Produces: `naive_matmul_web::cases::{rough_operands, bit_hash, run_hash}`; `naive_matmul_web::RayonRunner`; wasm exports `init_thread_pool`, `sum_squares`, `pool_threads`, `run_case`, `run_case_std`.

- [ ] **Step 1: Create the files**


Create `web/wasm/Cargo.toml`:

````toml
[package]
name = "naive_matmul_web"
version = "0.1.0"
edition = "2021"
description = "Browser wrapper around naive_matmul (stage B spike)"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

# Keep this crate out of any parent workspace: it builds on a pinned nightly
# and must never affect the core crate's stable build.
[workspace]

[features]
# Needed when the page loads the wasm module without a bundler.
no-bundler = ["wasm-bindgen-rayon/no-bundler"]

[dependencies]
naive_matmul = { path = "../.." }
rayon = "1.8"
wasm-bindgen = "=0.2.130"
wasm-bindgen-rayon = "1.2"
````

Create `web/wasm/rust-toolchain.toml`:

````toml
[toolchain]
channel = "nightly-2025-11-15"
components = ["rust-src"]
targets = ["wasm32-unknown-unknown"]
````

Create `web/wasm/.cargo/config.toml`:

````toml
# Flags for the wasm threads build. `-Z build-std=panic_abort,std` is passed on
# the command line by build.sh (it cannot live here: it would also apply to
# native `cargo test`, which has no --target).
[target.wasm32-unknown-unknown]
rustflags = [
    "-C", "target-feature=+atomics,+bulk-memory",
    "-C", "link-arg=--shared-memory",
    "-C", "link-arg=--max-memory=1073741824",
    "-C", "link-arg=--import-memory",
    "-C", "link-arg=--export=__wasm_init_tls",
    "-C", "link-arg=--export=__tls_size",
    "-C", "link-arg=--export=__tls_align",
    "-C", "link-arg=--export=__tls_base",
]
````

Create `web/wasm/src/cases.rs`:

````rust
//! Deterministic test cases shared by the browser gates and the native tests.
//!
//! The same operands and hash are computed natively (with `StdRunner`) and in
//! the browser (with `RayonRunner`); the gates compare the two hashes.

use std::num::NonZeroUsize;

use naive_matmul::cache_friendly::{self, BlockConfig};
use naive_matmul::runner::Runner;
use naive_matmul::{naive, simd, threaded, Matrix};

/// Operands with entries of very different magnitudes, so nearly every partial
/// sum rounds and any change in summation order changes the bits. This is the
/// generator from `tests/levels.rs` in the core crate.
pub fn rough_operands(m: usize, n: usize, p: usize) -> (Matrix, Matrix) {
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

/// FNV-1a over the raw bits of every element, as 16 hex digits.
pub fn bit_hash(matrix: &Matrix) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for value in matrix.as_slice() {
        hash ^= value.to_bits();
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Multiplies two `n × n` rough matrices at `level` (0 = naive, 1 = threaded,
/// 2 = cache_friendly, 3 = simd) and returns the result's bit hash.
///
/// Levels 1 to 3 run their row blocks on `runner`.
pub fn run_hash<R: Runner + ?Sized>(
    level: u32,
    n: usize,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
    runner: &R,
) -> Result<String, String> {
    let threads = NonZeroUsize::new(threads).ok_or("threads must be at least 1")?;
    let tile_k = NonZeroUsize::new(tile_k).ok_or("tile_k must be at least 1")?;
    let tile_j = NonZeroUsize::new(tile_j).ok_or("tile_j must be at least 1")?;
    if n == 0 || n > 2048 {
        return Err(format!("n must be in 1..=2048, got {n}"));
    }
    let block = BlockConfig::new(tile_k, tile_j);
    let (a, b) = rough_operands(n, n, n);
    let c = match level {
        0 => naive::matmul(&a, &b),
        1 => threaded::matmul_with_runner(&a, &b, threads, runner),
        2 => cache_friendly::matmul_with_runner(&a, &b, threads, &block, runner),
        3 => simd::matmul_with_runner(&a, &b, threads, &block, runner),
        other => return Err(format!("level must be 0 to 3, got {other}")),
    }
    .map_err(|e| e.to_string())?;
    Ok(bit_hash(&c))
}

#[cfg(test)]
mod tests {
    use super::*;
    use naive_matmul::runner::StdRunner;

    #[test]
    fn every_level_has_the_naive_hash() {
        for n in [1, 7, 33, 64] {
            let expected = run_hash(0, n, 1, 32, 64, &StdRunner).unwrap();
            for level in 1..=3 {
                for threads in [1, 3] {
                    let got = run_hash(level, n, threads, 32, 64, &StdRunner).unwrap();
                    assert_eq!(got, expected, "level {level}, n {n}, {threads} threads");
                }
            }
        }
    }

    #[test]
    fn block_sizes_do_not_change_the_hash() {
        let expected = run_hash(0, 40, 1, 32, 64, &StdRunner).unwrap();
        for (tile_k, tile_j) in [(1, 1), (7, 2), (1000, 1000)] {
            for level in [2, 3] {
                let got = run_hash(level, 40, 2, tile_k, tile_j, &StdRunner).unwrap();
                assert_eq!(got, expected, "level {level}, block {tile_k}x{tile_j}");
            }
        }
    }

    #[test]
    fn rejects_bad_parameters_instead_of_panicking() {
        assert!(run_hash(1, 8, 0, 32, 64, &StdRunner).is_err());
        assert!(run_hash(2, 8, 1, 0, 64, &StdRunner).is_err());
        assert!(run_hash(3, 8, 1, 32, 0, &StdRunner).is_err());
        assert!(run_hash(9, 8, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(1, 0, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(1, 4096, 1, 32, 64, &StdRunner).is_err());
    }

    #[test]
    fn hash_is_stable() {
        // Pins the generator and the hash so the browser and native sides agree.
        let (a, b) = rough_operands(3, 3, 3);
        let c = naive::matmul(&a, &b).unwrap();
        assert_eq!(bit_hash(&c), run_hash(0, 3, 1, 32, 64, &StdRunner).unwrap());
        assert_eq!(bit_hash(&c).len(), 16);
    }
}
````

Create `web/wasm/src/lib.rs`:

````rust
//! Browser wrapper around `naive_matmul` (stage B spike).
//!
//! Everything here runs inside a Web Worker. The thread pool comes from
//! `wasm-bindgen-rayon`; [`RayonRunner`] hands the crate's row-block jobs to it.

pub mod cases;

use naive_matmul::runner::{Runner, StdRunner};
use rayon::prelude::*;
use wasm_bindgen::prelude::*;

pub use wasm_bindgen_rayon::init_thread_pool;

/// Runs each job on the rayon pool.
pub struct RayonRunner;

impl Runner for RayonRunner {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        rayon::scope(|scope| {
            for job in jobs {
                scope.spawn(move |_| job());
            }
        });
    }
}

/// Gate G1 probe: a parallel sum that needs a working pool.
#[wasm_bindgen]
pub fn sum_squares(n: u32) -> u64 {
    (0..u64::from(n)).into_par_iter().map(|x| x * x % 1_000_003).sum()
}

/// Gate G1 probe: the number of threads in the rayon pool.
#[wasm_bindgen]
pub fn pool_threads() -> usize {
    rayon::current_num_threads()
}

/// Gate G2: the bit hash of a level's product, with its row blocks on the pool.
#[wasm_bindgen]
pub fn run_case(
    level: u32,
    n: usize,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
) -> Result<String, JsError> {
    cases::run_hash(level, n, threads, tile_k, tile_j, &RayonRunner).map_err(|e| JsError::new(&e))
}

/// The same case with the standard-library runner. Expected to fail on wasm
/// (this is the probe that shows why a `Runner` is needed); works natively.
#[wasm_bindgen]
pub fn run_case_std(
    level: u32,
    n: usize,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
) -> Result<String, JsError> {
    cases::run_hash(level, n, threads, tile_k, tile_j, &StdRunner).map_err(|e| JsError::new(&e))
}
````

Create `web/wasm/examples/expected.rs`:

````rust
//! Prints the expected hash for each matrix size as JSON, computed natively with
//! the naive level. The browser gates compare every level against these.

use naive_matmul::runner::StdRunner;
use naive_matmul_web::cases::run_hash;

fn main() {
    let sizes = [64_usize, 256, 512];
    let entries: Vec<String> = sizes
        .iter()
        .map(|&n| {
            let hash = run_hash(0, n, 1, 32, 64, &StdRunner).expect("valid case");
            format!("\"{n}\": \"{hash}\"")
        })
        .collect();
    println!("{{{}}}", entries.join(", "));
}
````

- [ ] **Step 2: Run the native tests**

Run (from `web/wasm`): `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: `test result: ok. 4 passed` for the library and `0 passed` for doc tests; no warnings. The first run downloads and builds the dependencies and creates `web/wasm/Cargo.lock`.

- [ ] **Step 3: Check the example prints the expected hashes**

Run (from `web/wasm`): `cargo run --release --example expected 2>/dev/null`
Expected exactly: `{"64": "653a9b093a002dca", "256": "c3bc2df46a8aee26", "512": "d1033dfddebffe59"}`

- [ ] **Step 4: Confirm the core crate is unaffected**

Run (from the repository root): `cargo test 2>&1 | grep -E "FAILED|^error"; cargo package --list --allow-dirty 2>/dev/null | grep -c "^web/"`
Expected: no output from the first command, then `0` (the `exclude` list keeps `web/` out of the published crate).

- [ ] **Step 5: Commit**

```bash
git add web/wasm/Cargo.toml web/wasm/Cargo.lock web/wasm/rust-toolchain.toml web/wasm/.cargo/config.toml web/wasm/src web/wasm/examples
git commit -m "add the wasm wrapper crate with the rayon runner"
```

If `git status` shows `web/wasm/Cargo.lock` as ignored, stop: the `!web/wasm/Cargo.lock` negation in `.gitignore` (stage A) is not working.

---

### Task 3: Headless browser gates

`build.sh` builds the threaded wasm and generates the JavaScript glue. `gate.sh` serves the page with cross-origin-isolation headers, opens it in headless Firefox, waits for the page to report, and exits non-zero unless the gate passes. Three gates: `g1` (the pool starts and runs a parallel sum), `g2` (22 cases: levels 0 to 3 at n = 256 and 512, 1/2/4 threads, plus two small block sizes, every result compared bit for bit with the native hash), and `probe` (informational: records that `StdRunner` traps in the browser).

The page loads the module in a Web Worker, as the real site will. `wasm-bindgen-rayon`'s `no-bundler` feature is on by default here (`FEATURES=no-bundler`): without a bundler its worker helper asks the server for the package directory and the pool never starts (observed during the prototype). A bundler build in stage B part two will use the default mode.

**Files:**
- Create: `web/dev/serve.py`, `web/dev/run_page.sh`, `web/wasm/build.sh`, `web/wasm/gate.sh`, `web/wasm/www/worker.js`, `web/wasm/www/gate.html`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the wrapper crate from Task 2 and its exports (`run_case`, `run_case_std`, `sum_squares`, `pool_threads`, `init_thread_pool` as `initThreadPool`).
- Produces: `web/wasm/gate.sh g1|g2|probe [--no-build]` (exit 0 = pass).

- [ ] **Step 1: Create the files**


Create `web/dev/serve.py`:

````python
"""Tiny static server for the browser gates (standard library only).

Serves the current directory with the cross-origin-isolation headers that
SharedArrayBuffer needs, and records the page's POST /report body to $REPORT.
Usage: python3 -I serve.py PORT   (run from the directory to serve)
"""
import http.server
import os
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode()
        with open(os.environ["REPORT"], "w") as report:
            report.write(body)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        log = os.environ.get("LOG")
        if log:
            with open(log, "a") as out:
                out.write((fmt % args) + "\n")


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
````

Create `web/dev/run_page.sh` (executable: `chmod +x`):

````bash
#!/usr/bin/env bash
# Serve ROOT, open URLPATH in headless Firefox, wait for the page to POST its
# report, then stop both. Prints nothing; the report is left in $REPORT.
# usage: run_page.sh ROOT URLPATH [TIMEOUT_SECONDS]      env: PORT, REPORT, LOG
set -u
ROOT=$1
URLPATH=$2
TIMEOUT=${3:-120}
PORT=${PORT:-8765}
HERE=$(cd "$(dirname "$0")" && pwd)
: "${REPORT:?set REPORT to the file the report is written to}"
rm -f "$REPORT"
export REPORT LOG

( cd "$ROOT" && exec python3 -I "$HERE/serve.py" "$PORT" ) &
SERVER=$!
PROFILE=$(mktemp -d)
firefox --headless --no-remote --profile "$PROFILE" "http://127.0.0.1:$PORT/$URLPATH" >/dev/null 2>&1 &
BROWSER=$!

for _ in $(seq 1 "$TIMEOUT"); do
  [ -f "$REPORT" ] && break
  sleep 1
done

kill "$BROWSER" "$SERVER" 2>/dev/null
sleep 1
kill -9 "$BROWSER" "$SERVER" 2>/dev/null
rm -rf "$PROFILE"
[ -f "$REPORT" ]
````

Create `web/wasm/build.sh` (executable: `chmod +x`):

````bash
#!/usr/bin/env bash
# Builds the wasm module with threads (pinned nightly via rust-toolchain.toml)
# and generates the JavaScript glue into pkg/.
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured (default: ./target)
#      FEATURES      cargo features (default: no-bundler)
set -euo pipefail
cd "$(dirname "$0")"
WASM_BINDGEN=${WASM_BINDGEN:-wasm-bindgen}
FEATURES=${FEATURES:-no-bundler}
TARGET_DIR=${CARGO_TARGET_DIR:-$PWD/target}
cargo build --release --target wasm32-unknown-unknown \
  --features "$FEATURES" -Z build-std=panic_abort,std
rm -rf pkg
"$WASM_BINDGEN" --target web --out-dir pkg \
  "$TARGET_DIR/wasm32-unknown-unknown/release/naive_matmul_web.wasm"
````

Create `web/wasm/gate.sh` (executable: `chmod +x`):

````bash
#!/usr/bin/env bash
# Runs one browser gate headlessly and exits non-zero unless it passes.
# usage: gate.sh g1|g2|probe [--no-build]
# `probe` is informational: it records whether the standard-library runner works
# in the browser (expected: it does not) and passes whenever the page ran.
# env: WASM_BINDGEN (path to the CLI), PORT (default 8765)
set -euo pipefail
cd "$(dirname "$0")"
GATE=${1:?usage: gate.sh g1|g2|probe [--no-build]}
[ "${2:-}" = "--no-build" ] || ./build.sh
mkdir -p target
if [ "$GATE" = g2 ]; then
  cargo run --release --example expected 2>/dev/null > www/expected.json
fi
export REPORT="$PWD/target/$GATE-report.json" LOG="$PWD/target/$GATE-server.log"
rm -f "$LOG"
./../dev/run_page.sh . "www/gate.html?gate=$GATE" "${TIMEOUT:-180}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I - "$REPORT" "$GATE" <<'PYEOF'
import json, sys
report = json.load(open(sys.argv[1]))
gate = sys.argv[2]
print(json.dumps({k: v for k, v in report.items() if k != "cases"}, indent=2))
problems = []
if not report.get("ok"):
    problems.append("page reported an error: " + str(report.get("error")))
if not report.get("isolated"):
    problems.append("page is not cross-origin isolated")
if report.get("pool_threads") != 4:
    problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))
if gate == "probe":
    print("StdRunner works in the browser: %r" % report.get("std_runner_works"))
if gate == "g1" and report.get("sum") != "2499487497200":
    problems.append("wrong parallel sum: %r" % report.get("sum"))
if gate == "g2":
    cases = report.get("cases", [])
    if len(cases) != 22:
        problems.append("expected 22 cases, got %d" % len(cases))
    for c in cases:
        flag = "ok " if c["ok"] else "BAD"
        print("%s level %d n %4d threads %d block %dx%d  %8.1f ms  %s" % (
            flag, c["level"], c["n"], c["threads"], c["tile_k"], c["tile_j"], c["ms"], c["hash"]))
        if not c["ok"]:
            problems.append("hash mismatch: %r" % c)
    def ms(level, n, t):
        return next(c["ms"] for c in cases if (c["level"], c["n"], c["threads"], c["tile_k"]) == (level, n, t, 32))
    for level in (1, 2, 3):
        print("speedup level %d n 512: 1 -> 4 threads = %.2fx (indicative only)" % (level, ms(level, 512, 1) / ms(level, 512, 4)))
if problems:
    print("GATE %s: FAIL" % gate.upper())
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("GATE %s: PASS" % gate.upper())
PYEOF
````

Create `web/wasm/www/worker.js`:

````javascript
// Runs a gate inside a Web Worker. The page posts { gate, threads, expected }.
import init, {
  initThreadPool,
  pool_threads,
  sum_squares,
  run_case,
  run_case_std,
} from '../pkg/naive_matmul_web.js';

function g2Cases() {
  const cases = [];
  for (const n of [256, 512]) {
    cases.push({ level: 0, n, threads: 1, tile_k: 32, tile_j: 64 });
    for (const level of [1, 2, 3]) {
      for (const threads of [1, 2, 4]) {
        cases.push({ level, n, threads, tile_k: 32, tile_j: 64 });
      }
    }
  }
  cases.push({ level: 3, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  cases.push({ level: 2, n: 256, threads: 4, tile_k: 1, tile_j: 1 });
  return cases;
}

self.onmessage = async (event) => {
  const { gate, threads, expected } = event.data;
  const out = {
    gate,
    isolated: self.crossOriginIsolated,
    cores: navigator.hardwareConcurrency,
  };
  try {
    await init();
    const started = performance.now();
    await initThreadPool(threads);
    out.pool_init_ms = performance.now() - started;
    out.pool_threads = pool_threads();

    if (gate === 'g1') {
      out.sum = String(sum_squares(5_000_000));
    } else if (gate === 'g2') {
      out.cases = [];
      for (const c of g2Cases()) {
        const t0 = performance.now();
        const hash = run_case(c.level, c.n, c.threads, c.tile_k, c.tile_j);
        out.cases.push({ ...c, hash, ms: performance.now() - t0, ok: hash === expected[String(c.n)] });
      }
    } else if (gate === 'probe') {
      // Runs last and on its own: a trap can leave the module unusable.
      try {
        out.std_hash = run_case_std(1, 64, 2, 32, 64);
        out.std_runner_works = true;
      } catch (e) {
        out.std_runner_works = false;
        out.std_error = String(e);
      }
    } else {
      throw new Error('unknown gate: ' + gate);
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
````

Create `web/wasm/www/gate.html`:

````html
<!doctype html>
<meta charset="utf-8">
<title>gate</title>
<script type="module">
  const gate = new URLSearchParams(location.search).get('gate');
  let expected = {};
  try { expected = await (await fetch('./expected.json')).json(); } catch (e) { /* g1 needs none */ }
  const worker = new Worker('./worker.js', { type: 'module' });
  const result = await new Promise((resolve) => {
    worker.onmessage = (event) => resolve(event.data);
    worker.onerror = (event) => resolve({ gate, ok: false, error: 'worker error: ' + event.message });
    worker.postMessage({ gate, threads: 4, expected });
  });
  await fetch('/report', { method: 'POST', body: JSON.stringify(result) });
  document.title = result.ok ? 'done' : 'failed';
</script>
````

- [ ] **Step 2: Ignore the generated expected-hash file**

In `.gitignore`, replace (include the final line break):

````text
web/wasm/pkg/

````

with:

````text
web/wasm/pkg/
web/wasm/www/expected.json

````

- [ ] **Step 3: Run the gates**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
./gate.sh g1            # builds (about 30 s on a cold cache), then runs the pool gate
./gate.sh g2 --no-build
./gate.sh probe --no-build
```

Expected: each ends with its last line `GATE G1: PASS`, `GATE G2: PASS`, `GATE PROBE: PASS`. `g1` prints a JSON summary with `"isolated": true`, `"pool_threads": 4` and `"sum": "2499487497200"`. `g2` prints 22 lines starting `ok ` (none `BAD`) and three `speedup` lines (indicative only; expect roughly 2x, not exactly). `probe` prints `StdRunner works in the browser: False` with `std_error` `RuntimeError: unreachable executed`.

If a gate fails, do not edit the gate to make it pass: stop and report BLOCKED with the full output. A hash mismatch is a real bug in a level or the runner.

- [ ] **Step 4: Verify the ignore rules**

```bash
git check-ignore -q web/wasm/www/expected.json; echo $?   # expect 0 (ignored)
git check-ignore -q web/wasm/pkg/x.js;          echo $?   # expect 0 (ignored)
git check-ignore -q web/wasm/Cargo.lock;        echo $?   # expect 1 (tracked)
git status --short                                         # only the files below are untracked or modified
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore web/dev web/wasm/build.sh web/wasm/gate.sh web/wasm/www/worker.js web/wasm/www/gate.html
git commit -m "add headless Firefox gates for the wasm wrapper"
```

---

### Task 4: Record the G1 and G2 results

The spike's output is a findings document. This task runs the three gates once more on the committed code and writes the document from the actual output.

**Files:**
- Create: `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md`

- [ ] **Step 1: Run the gates and keep the output**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
./gate.sh g1 2>&1 | tail -12
./gate.sh g2 --no-build 2>&1 | tail -30
./gate.sh probe --no-build 2>&1 | tail -14
```

All three must end in `PASS`. **If any does not, stop and report BLOCKED; do not write the document.**

- [ ] **Step 2: Write the findings document**

Create `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md` with the text below, with two substitutions and nothing else changed: replace the line `G2_OUTPUT` with the lines printed by the `g2` run that start with `ok ` or `speedup` (verbatim, in the order printed), and replace the line `PROBE_OUTPUT` with the two lines of the `probe` run that begin `"std_runner_works"` and `"std_error"` (verbatim). Also replace the browser row's value with the output of `firefox --version`.

````markdown
# Stage B findings, part one: gates G1 and G2

Spec: `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-design.md`.
Plan: `docs/superpowers/plans/2026-11-05-stage-b-spike-part-one.md`.
Gates G3 (production build on a Pages subpath), G4 (level 4) and G5 (limits)
are not covered here.

## Verdict

**G1 and G2 pass.** The real `naive_matmul` levels 1 to 3 run on a rayon thread
pool in a browser and return, bit for bit, the answer native Rust computes. The
fallback design (JavaScript splitting rows across plain Web Workers) is not
needed for these levels. The `Runner` trait is merged into the core crate.

## Environment

| Item | Value |
|---|---|
| Browser | Firefox (headless), the version printed by `firefox --version` |
| Rust nightly | `nightly-2025-11-15` (rustc 1.93.0-nightly, b6d7ff3aa 2025-11-14) |
| `wasm-bindgen` crate and CLI | `0.2.130` (pinned with `=`; the two must match) |
| `wasm-bindgen-rayon` | 1.3.0 |
| `rayon` | 1.12.0 |
| Machine | 8 hardware threads |

## The build recipe that works

- `rust-toolchain.toml`: the pinned nightly, component `rust-src`, target `wasm32-unknown-unknown`.
- Rust flags for the wasm target: `-C target-feature=+atomics,+bulk-memory` and the linker arguments `--shared-memory`, `--max-memory=1073741824`, `--import-memory`, and exports of `__wasm_init_tls`, `__tls_size`, `__tls_align`, `__tls_base`.
- `-Z build-std=panic_abort,std` is passed on the command line (in `build.sh`), not in `.cargo/config.toml`: a `[unstable] build-std` entry there would also apply to native `cargo test`, which has no `--target`.
- `wasm-bindgen --target web`. Only `cargo build` and the CLI are used; no `wasm-pack`.
- The compiler warns `unstable feature specified for -Ctarget-feature: atomics`; this is expected.
- Without a bundler the `no-bundler` feature of `wasm-bindgen-rayon` is required. Without it each pool worker requests the package directory (`GET /pkg/`) and the pool never starts.
- The page must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`); `web/dev/serve.py` sets both.

## G1: the pool starts and runs in parallel

Pass. In a Web Worker with `initThreadPool(4)`: `crossOriginIsolated` was true, the
pool had 4 threads, starting it took tens of milliseconds, and a parallel sum of
5,000,000 squares returned the same value as an independent Python computation
(`2499487497200`).

## G2: the real crate with threads gives the native answer

Pass. Levels 0 to 3 at n = 256 and 512 with 1, 2 and 4 threads, plus
`simd` with block 7x2 and `cache_friendly` with block 1x1 (22 cases), all return
the hash that native Rust computes with the naive level for the same
order-sensitive operands. Output of `./gate.sh g2 --no-build` from the run that
produced this record:

```text
G2_OUTPUT
```

Timings are indicative only (one browser, one machine, no warm-up); the gate is
about the bits.

## Probe: the standard-library runner in the browser

`StdRunner` (the default, built on `std::thread::scope`) does not work on
`wasm32-unknown-unknown`, even in the atomics build with a live pool: the call
traps with `RuntimeError: unreachable executed` (an unsupported thread spawn
aborting under `panic=abort`). This is why levels 1 to 3 need a `Runner`.

```text
PROBE_OUTPUT
```

## Consequences

- Stage C and D can use the real crate in the browser for levels 1 to 3 through `RayonRunner`.
- The wrapper crate (`web/wasm`) is the seed of the site's wasm module; its build needs the pinned nightly, the matching CLI, and isolation headers.
- Level 4 still has its own worker loop and needs the same treatment (gate G4).
- Not yet tested: a production bundle on a GitHub Pages subpath with `coi-serviceworker` (G3); level 4 (G4); memory limits, panic behaviour in a worker, pool start-up cost across sizes and pool resizing (G5); browsers other than Firefox.
````

- [ ] **Step 3: Verify**

Run: `grep -c "G2_OUTPUT\|PROBE_OUTPUT" docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md`
Expected: `0`

Run: `grep -c "^ok " docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md`
Expected: `22`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md
git commit -m "record stage B gate G1 and G2 results"
```

---

## After this plan

If all four tasks pass, the spike's central risk is retired: threads in the browser work for levels 1 to 3 and the answers are bit-exact. **Part two** (its own plan) covers the remaining gates:

- **G3**: the same demo from an Astro production build, served under `/matmul_levels.rs/` by a server that does not set the isolation headers, with `coi-serviceworker`. Needs Node and npm. Here `wasm-bindgen-rayon` is built in its default (bundler) mode: `FEATURES= ./build.sh`.
- **G4**: level 4 (`matmul_streaming`) through the runner, which needs its worker loop reworked to hand jobs to a `Runner`.
- **G5**: measured limits (largest `n` under the 1 GiB memory cap, what a panic in a worker does, pool start-up cost by size, whether the pool can be resized).

If a gate fails, the spec's fallback applies: G1 failing means the Web-Worker-per-row-block design; G2 failing on bits is a bug to fix before anything else.
