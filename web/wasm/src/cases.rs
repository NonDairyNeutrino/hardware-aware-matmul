//! Deterministic test cases shared by the browser gates and the native tests.
//!
//! The same operands and hash are computed natively (with `StdRunner`) and in
//! the browser (with `RayonRunner`); the gates compare the two hashes.

use std::num::NonZeroUsize;

use naive_matmul::cache_friendly::{self, BlockConfig};
use naive_matmul::runner::Runner;
use naive_matmul::streaming::{self, MemorySink, StreamConfig};
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
/// 2 = cache_friendly, 3 = simd, 4 = streaming with 64 × 64 × 64 tiles) and
/// returns the result's bit hash.
///
/// Levels 1 to 4 run their work on `runner`.
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
        0 => naive::matmul(&a, &b).map_err(|e| e.to_string())?,
        1 => threaded::matmul_with_runner(&a, &b, threads, runner).map_err(|e| e.to_string())?,
        2 => cache_friendly::matmul_with_runner(&a, &b, threads, &block, runner)
            .map_err(|e| e.to_string())?,
        3 => simd::matmul_with_runner(&a, &b, threads, &block, runner).map_err(|e| e.to_string())?,
        4 => {
            let config = StreamConfig::new(threads)
                .with_tile_shape(64, 64, 64)
                .with_block_config(block);
            let sink = MemorySink::new(n, n);
            streaming::matmul_streaming_with_runner(&a, &b, &sink, &config, runner)
                .map_err(|e| e.to_string())?;
            sink.into_matrix()
        }
        other => return Err(format!("level must be 0 to 4, got {other}")),
    };
    Ok(bit_hash(&c))
}

#[cfg(test)]
mod tests {
    use super::*;
    use naive_matmul::runner::StdRunner;

    #[test]
    fn every_level_has_the_naive_hash() {
        for n in [1, 7, 33, 64, 130] {
            let expected = run_hash(0, n, 1, 32, 64, &StdRunner).unwrap();
            for level in 1..=4 {
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
            for level in [2, 3, 4] {
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
        assert!(run_hash(5, 8, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(9, 8, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(1, 0, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(1, 4096, 1, 32, 64, &StdRunner).is_err());
    }

    #[test]
    fn hash_is_stable() {
        // These pin the generator and the hash so the browser and native sides
        // agree.
        assert_eq!(run_hash(0, 64, 1, 32, 64, &StdRunner).unwrap(), "653a9b093a002dca");
        assert_eq!(run_hash(0, 256, 1, 32, 64, &StdRunner).unwrap(), "c3bc2df46a8aee26");
    }
}
