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
