//! Browser wrapper around `hardware_aware_matmul` (stage B spike).
//!
//! Everything here runs inside a Web Worker. With the `threads` feature the thread
//! pool comes from `wasm-bindgen-rayon` and [`RayonRunner`] hands the crate's jobs
//! to it. Without it (the stable build) [`InlineRunner`] runs them one after
//! another on the calling thread.

pub mod cases;
pub mod plan;

use hardware_aware_matmul::runner::{Runner, StdRunner};
#[cfg(feature = "threads")]
use rayon::prelude::*;
use std::cell::RefCell;

use wasm_bindgen::prelude::*;

#[cfg(feature = "threads")]
pub use wasm_bindgen_rayon::init_thread_pool;

/// Runs every job on the calling thread, one after another. The runner of the
/// stable build, which has no threads.
pub struct InlineRunner;

impl Runner for InlineRunner {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        for job in jobs {
            job();
        }
    }
}

/// Runs each job on the rayon pool.
#[cfg(feature = "threads")]
pub struct RayonRunner;

#[cfg(feature = "threads")]
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
#[cfg(feature = "threads")]
#[wasm_bindgen]
pub fn sum_squares(n: u32) -> u64 {
    (0..u64::from(n)).into_par_iter().map(|x| x * x % 1_000_003).sum()
}

/// Gate G1 probe: the number of threads in the rayon pool.
#[cfg(feature = "threads")]
#[wasm_bindgen]
pub fn pool_threads() -> usize {
    rayon::current_num_threads()
}

/// Gate G2: the bit hash of a level's product (0 to 5), with its work on the pool.
#[cfg(feature = "threads")]
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

/// The partition of a small product at `level` (0 to 5), as JSON: row blocks for
/// levels 0 to 4, output tiles in claim order for level 5. See [`plan`].
///
/// Display sizes only: `rows`, `inner`, `cols` and the tile edges are at most 64
/// and `threads` at most 8. Bad arguments return an error.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn partition_plan(
    level: u32,
    rows: usize,
    inner: usize,
    cols: usize,
    threads: usize,
    tile_rows: usize,
    tile_cols: usize,
    tile_depth: usize,
) -> Result<String, JsError> {
    plan::partition_plan_json(level, rows, inner, cols, threads, tile_rows, tile_cols, tile_depth)
        .map_err(|e| JsError::new(&e))
}

thread_local! {
    /// The prepared operands and last result of the benchmark API below. Only the calling
    /// thread touches it; the rayon workers of the threaded build never do.
    static BENCH: RefCell<cases::Bench> = RefCell::new(cases::Bench::new());
}

/// The runner the benchmark API uses: the rayon pool in the threaded build, the calling
/// thread in the lite build.
#[cfg(feature = "threads")]
fn bench_runner() -> RayonRunner {
    RayonRunner
}

#[cfg(not(feature = "threads"))]
fn bench_runner() -> InlineRunner {
    InlineRunner
}

/// Benchmark API, step 1: builds the `n × n` operands (`n` in 1 to 2048) so that the
/// timed calls do not include generating them.
#[wasm_bindgen]
pub fn bench_prepare(n: usize) -> Result<(), JsError> {
    BENCH.with(|bench| bench.borrow_mut().prepare(n)).map_err(|e| JsError::new(&e))
}

/// Benchmark API, step 2: multiplies the prepared operands at `level` (0 to 5) and keeps
/// the result. This is the call a page times. `tile_k`/`tile_j` are the cache blocks of
/// levels 2 to 5 and the three `tile_*` sizes the output tile of level 5.
#[wasm_bindgen]
pub fn bench_multiply(
    level: u32,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
    tile_rows: usize,
    tile_cols: usize,
    tile_depth: usize,
) -> Result<(), JsError> {
    let runner = bench_runner();
    BENCH
        .with(|bench| {
            bench.borrow_mut().multiply(
                level,
                threads,
                tile_k,
                tile_j,
                (tile_rows, tile_cols, tile_depth),
                &runner,
            )
        })
        .map_err(|e| JsError::new(&e))
}

/// Benchmark API, step 3: the bit hash of the last result, so a page can check that every
/// level gave the same answer without hashing inside the timed region.
#[wasm_bindgen]
pub fn bench_hash() -> Result<String, JsError> {
    BENCH.with(|bench| bench.borrow().hash()).map_err(|e| JsError::new(&e))
}

/// The build's vector instruction set, micro-tile shape and whether it has threads,
/// as JSON.
#[wasm_bindgen]
pub fn env_info() -> String {
    plan::env_info_json()
}

/// Gate G5 probe: allocates and touches `mib` MiB of memory.
///
/// Shows where the module's memory cap bites. A failed allocation aborts the
/// module (`panic=abort`), which the page sees as a `RuntimeError`.
#[wasm_bindgen]
pub fn memory_probe(mib: usize) -> Result<u64, JsError> {
    let bytes = mib
        .checked_mul(1024 * 1024)
        .ok_or_else(|| JsError::new("size overflows usize"))?;
    let mut buffer = vec![0_u8; bytes];
    for index in (0..buffer.len()).step_by(4096) {
        buffer[index] = 1;
    }
    Ok(buffer.iter().step_by(4096).map(|&byte| u64::from(byte)).sum())
}

/// Gate G5 probe: a job on the pool panics. With `panic=abort` this traps.
#[cfg(feature = "threads")]
#[wasm_bindgen]
pub fn panic_probe() {
    let jobs: Vec<Box<dyn FnOnce() + Send>> = vec![Box::new(|| panic!("probe panic"))];
    RayonRunner.run(jobs);
}

/// The same case with every level run on the calling thread. The stable build's
/// `run_case`: `threads` is still the number of jobs, run one after another.
#[cfg(not(feature = "threads"))]
#[wasm_bindgen]
pub fn run_case(
    level: u32,
    n: usize,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
) -> Result<String, JsError> {
    cases::run_hash(level, n, threads, tile_k, tile_j, &InlineRunner).map_err(|e| JsError::new(&e))
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

#[cfg(test)]
mod inline_tests {
    use super::*;
    use crate::cases::run_hash;

    #[test]
    fn inline_runner_gives_the_same_hash_as_the_std_runner() {
        for level in 1..=5 {
            for threads in [1, 3] {
                let std = run_hash(level, 48, threads, 32, 64, &StdRunner).unwrap();
                let inline = run_hash(level, 48, threads, 32, 64, &InlineRunner).unwrap();
                assert_eq!(std, inline, "level {level}, {threads} threads");
            }
        }
    }
}

#[cfg(all(test, feature = "threads"))]
mod tests {
    use super::*;
    use crate::cases::run_hash;

    #[test]
    fn rayon_runner_gives_the_same_hash_as_the_std_runner() {
        for level in 1..=4 {
            for threads in [1, 3] {
                let std = run_hash(level, 48, threads, 32, 64, &StdRunner).unwrap();
                let rayon = run_hash(level, 48, threads, 32, 64, &RayonRunner).unwrap();
                assert_eq!(std, rayon, "level {level}, {threads} threads");
            }
        }
    }

    #[test]
    #[should_panic(expected = "boom")]
    fn rayon_runner_propagates_a_job_panic() {
        let jobs: Vec<Box<dyn FnOnce() + Send>> = vec![Box::new(|| panic!("boom"))];
        RayonRunner.run(jobs);
    }
}
