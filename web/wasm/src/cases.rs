//! Deterministic test cases shared by the browser gates and the native tests.
//!
//! The same operands and hash are computed natively (with `StdRunner`) and in
//! the browser (with `RayonRunner`); the gates compare the two hashes.

use std::num::NonZeroUsize;

use hardware_aware_matmul::cache_friendly::{self, BlockConfig};
use hardware_aware_matmul::runner::Runner;
use hardware_aware_matmul::streaming::{self, MemorySink, StreamConfig};
use hardware_aware_matmul::{naive, packed, simd, threaded, Matrix};

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

/// The largest matrix edge the wasm wrapper accepts.
pub const MAX_N: usize = 2048;

/// The output-tile shape (rows, columns, depth) level 5 uses in the gate cases.
pub const GATE_TILE: (usize, usize, usize) = (64, 64, 64);

/// Multiplies `a` by `b` at `level` (0 = naive, 1 = threaded, 2 = cache_friendly,
/// 3 = simd, 4 = packed, 5 = streaming with the output tiles of the given `tile` shape).
///
/// Levels 1 to 5 run their work on `runner`; `tile_k` and `tile_j` are the cache
/// blocks of levels 2 to 5. Every argument is validated, so a bad one is an error and
/// never a panic.
#[allow(clippy::too_many_arguments)]
pub fn multiply<R: Runner + ?Sized>(
    level: u32,
    a: &Matrix,
    b: &Matrix,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
    tile: (usize, usize, usize),
    runner: &R,
) -> Result<Matrix, String> {
    let threads = NonZeroUsize::new(threads).ok_or("threads must be at least 1")?;
    let tile_k = NonZeroUsize::new(tile_k).ok_or("tile_k must be at least 1")?;
    let tile_j = NonZeroUsize::new(tile_j).ok_or("tile_j must be at least 1")?;
    if tile.0 == 0 || tile.1 == 0 || tile.2 == 0 {
        return Err("the tile shape must be at least 1 in every dimension".to_string());
    }
    let block = BlockConfig::new(tile_k, tile_j);
    match level {
        0 => naive::matmul(a, b).map_err(|e| e.to_string()),
        1 => threaded::matmul_with_runner(a, b, threads, runner).map_err(|e| e.to_string()),
        2 => cache_friendly::matmul_with_runner(a, b, threads, &block, runner)
            .map_err(|e| e.to_string()),
        3 => simd::matmul_with_runner(a, b, threads, &block, runner).map_err(|e| e.to_string()),
        4 => packed::matmul_with_runner(a, b, threads, &block, runner).map_err(|e| e.to_string()),
        5 => {
            let config = StreamConfig::new(threads)
                .with_tile_shape(tile.0, tile.1, tile.2)
                .with_block_config(block);
            let sink = MemorySink::new(a.rows(), b.cols());
            streaming::matmul_streaming_with_runner(a, b, &sink, &config, runner)
                .map_err(|e| e.to_string())?;
            Ok(sink.into_matrix())
        }
        other => Err(format!("level must be 0 to 5, got {other}")),
    }
}

/// Multiplies two `n × n` rough matrices at `level` (0 = naive, 1 = threaded,
/// 2 = cache_friendly, 3 = simd, 4 = packed, 5 = streaming with 64 × 64 × 64 tiles) and
/// returns the result's bit hash.
///
/// Levels 1 to 5 run their work on `runner`.
pub fn run_hash<R: Runner + ?Sized>(
    level: u32,
    n: usize,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
    runner: &R,
) -> Result<String, String> {
    if n == 0 || n > MAX_N {
        return Err(format!("n must be in 1..={MAX_N}, got {n}"));
    }
    let (a, b) = rough_operands(n, n, n);
    let c = multiply(level, &a, &b, threads, tile_k, tile_j, GATE_TILE, runner)?;
    Ok(bit_hash(&c))
}

/// Prepared operands and the last result, for timing the multiplication alone.
///
/// A benchmark builds the operands once (`prepare`), times as many `multiply` calls as
/// it likes, and hashes the stored result afterwards (`hash`), so neither the operand
/// generation nor the hashing sits inside the timed region. The timed call does include
/// storing the result (allocating the new result matrix and dropping the old one), the
/// same for every level.
#[derive(Default)]
pub struct Bench {
    operands: Option<(Matrix, Matrix)>,
    result: Option<Matrix>,
}

impl Bench {
    /// An empty bench: call [`Bench::prepare`] before multiplying.
    pub fn new() -> Self {
        Self::default()
    }

    /// Builds the `n × n` rough operands (`n` in `1..=MAX_N`) and drops any earlier
    /// result.
    pub fn prepare(&mut self, n: usize) -> Result<(), String> {
        if n == 0 || n > MAX_N {
            return Err(format!("n must be in 1..={MAX_N}, got {n}"));
        }
        self.result = None;
        self.operands = Some(rough_operands(n, n, n));
        Ok(())
    }

    /// Multiplies the prepared operands and stores the result. The previous result is
    /// dropped first, so a failed call leaves no result and [`Bench::hash`] then fails.
    pub fn multiply<R: Runner + ?Sized>(
        &mut self,
        level: u32,
        threads: usize,
        tile_k: usize,
        tile_j: usize,
        tile: (usize, usize, usize),
        runner: &R,
    ) -> Result<(), String> {
        self.result = None;
        let (a, b) = self.operands.as_ref().ok_or("call prepare before multiply")?;
        self.result = Some(multiply(level, a, b, threads, tile_k, tile_j, tile, runner)?);
        Ok(())
    }

    /// The bit hash of the stored result.
    pub fn hash(&self) -> Result<String, String> {
        self.result.as_ref().map(bit_hash).ok_or_else(|| "call multiply before hash".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hardware_aware_matmul::runner::StdRunner;

    #[test]
    fn every_level_has_the_naive_hash() {
        for n in [1, 7, 33, 64, 130] {
            let expected = run_hash(0, n, 1, 32, 64, &StdRunner).unwrap();
            for level in 1..=5 {
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
            for level in [2, 3, 4, 5] {
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
        assert!(run_hash(6, 8, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(9, 8, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(1, 0, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(1, 4096, 1, 32, 64, &StdRunner).is_err());
    }

    #[test]
    fn bench_gives_the_same_hash_as_run_hash_for_every_level() {
        let mut bench = Bench::new();
        bench.prepare(48).unwrap();
        for level in 0..=5 {
            for threads in [1, 3] {
                bench.multiply(level, threads, 32, 64, GATE_TILE, &StdRunner).unwrap();
                let expected = run_hash(level, 48, threads, 32, 64, &StdRunner).unwrap();
                assert_eq!(bench.hash().unwrap(), expected, "level {level}, {threads} threads");
            }
        }
    }

    #[test]
    fn the_level_five_tile_shape_does_not_change_the_hash() {
        let mut bench = Bench::new();
        bench.prepare(40).unwrap();
        bench.multiply(0, 1, 32, 64, GATE_TILE, &StdRunner).unwrap();
        let expected = bench.hash().unwrap();
        for tile in [(1, 1, 1), (7, 5, 3), (128, 128, 128)] {
            bench.multiply(5, 2, 32, 64, tile, &StdRunner).unwrap();
            assert_eq!(bench.hash().unwrap(), expected, "tile {tile:?}");
        }
    }

    #[test]
    fn bench_rejects_misuse_instead_of_panicking() {
        let mut bench = Bench::new();
        assert!(bench.multiply(1, 1, 32, 64, GATE_TILE, &StdRunner).is_err(), "before prepare");
        assert!(bench.hash().is_err(), "before multiply");
        assert!(bench.prepare(0).is_err());
        assert!(bench.prepare(MAX_N + 1).is_err());
        bench.prepare(8).unwrap();
        assert!(bench.hash().is_err(), "prepare drops the old result");
        assert!(bench.multiply(1, 0, 32, 64, GATE_TILE, &StdRunner).is_err());
        assert!(bench.multiply(2, 1, 0, 64, GATE_TILE, &StdRunner).is_err());
        assert!(bench.multiply(3, 1, 32, 0, GATE_TILE, &StdRunner).is_err());
        assert!(bench.multiply(5, 1, 32, 64, (0, 64, 64), &StdRunner).is_err());
        assert!(bench.multiply(5, 1, 32, 64, (64, 64, 0), &StdRunner).is_err());
        assert!(bench.multiply(6, 1, 32, 64, GATE_TILE, &StdRunner).is_err());
    }

    #[test]
    fn a_failed_multiply_leaves_no_stale_result() {
        let mut bench = Bench::new();
        bench.prepare(8).unwrap();
        bench.multiply(1, 1, 32, 64, GATE_TILE, &StdRunner).unwrap();
        assert!(bench.hash().is_ok());
        assert!(bench.multiply(1, 0, 32, 64, GATE_TILE, &StdRunner).is_err());
        assert!(bench.hash().is_err(), "the failed call must not leave the old result");
    }

    #[test]
    fn hash_is_stable() {
        // These pin the generator and the hash so the browser and native sides
        // agree.
        assert_eq!(run_hash(0, 64, 1, 32, 64, &StdRunner).unwrap(), "653a9b093a002dca");
        assert_eq!(run_hash(0, 256, 1, 32, 64, &StdRunner).unwrap(), "c3bc2df46a8aee26");
    }
}
