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

/// Gate G2: the bit hash of a level's product (0 to 4), with its work on the pool.
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
#[wasm_bindgen]
pub fn panic_probe() {
    let jobs: Vec<Box<dyn FnOnce() + Send>> = vec![Box::new(|| panic!("probe panic"))];
    RayonRunner.run(jobs);
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
mod tests {
    use super::*;
    use crate::cases::run_hash;

    #[test]
    fn rayon_runner_gives_the_same_hash_as_the_std_runner() {
        for level in 1..=3 {
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
