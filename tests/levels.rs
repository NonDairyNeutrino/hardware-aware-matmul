//! Cross-level tests: every implementation must produce exactly the same
//! result as the naive one, for every shape and thread count.
//!
//! The levels differ in *how* they compute, never in *what* they compute: each
//! output element is summed in increasing `k` order starting from zero, so the
//! results are bit-for-bit identical. These tests compare the raw bits of
//! every element, on operands chosen so that any change in summation order
//! would show.

use std::num::NonZeroUsize;

use std::sync::atomic::{AtomicUsize, Ordering};

use hardware_aware_matmul::cache_friendly::BlockConfig;
use hardware_aware_matmul::runner::{Runner, StdRunner};
use hardware_aware_matmul::threaded::row_block_plan;
use hardware_aware_matmul::streaming::StreamConfig;
use hardware_aware_matmul::{cache_friendly, naive, simd, streaming, threaded, DimensionMismatch, MatmulError, Matrix};

fn nz(n: usize) -> NonZeroUsize {
    NonZeroUsize::new(n).unwrap()
}

/// Operands whose entries are small integers, so every sum is exact.
fn sample_operands(m: usize, n: usize, p: usize) -> (Matrix, Matrix) {
    let a = Matrix::from_fn(m, n, |i, j| ((i * 3 + j) % 7) as f64 - 3.0);
    let b = Matrix::from_fn(n, p, |i, j| ((i + 5 * j) % 11) as f64 - 5.0);
    (a, b)
}

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
/// Level 4 is run with small tiles so that even modest matrices are split into
/// several tiles and several depth slices.
fn product_at_every_level(a: &Matrix, b: &Matrix, threads: usize) -> Vec<(&'static str, Matrix)> {
    let t = nz(threads);
    let small_tiles = StreamConfig::new(t).with_tile_shape(16, 24, 20);
    let sink = streaming::MemorySink::new(a.rows(), b.cols());
    streaming::matmul_streaming(a, b, &sink, &small_tiles).unwrap();

    vec![
        ("naive", naive::matmul(a, b).unwrap()),
        ("threaded", threaded::matmul(a, b, t).unwrap()),
        ("cache_friendly", cache_friendly::matmul(a, b, t).unwrap()),
        ("simd", simd::matmul(a, b, t).unwrap()),
        ("streaming (default tiles)", streaming::matmul(a, b, t).unwrap()),
        ("streaming (small tiles)", sink.into_matrix()),
    ]
}

#[test]
fn every_level_computes_the_hand_checked_product() {
    let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
    let expected = Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]);
    for threads in 1..=4 {
        for (level, c) in product_at_every_level(&a, &b, threads) {
            assert_eq!(c, expected, "{level}, {threads} thread(s)");
        }
    }
}

#[test]
fn every_level_agrees_with_naive_on_awkward_shapes() {
    // Shapes larger than, and not multiples of, every block and tile size in
    // the crate, plus degenerate 1-wide cases.
    let shapes = [(1, 1, 1), (1, 9, 1), (9, 1, 9), (37, 23, 41), (64, 64, 64), (70, 75, 133)];
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
}

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
                let c3 = simd::matmul_with_config(&a, &b, t, &block).unwrap();
                assert_same_bits(&c3, &reference, &context("simd"));

                let config = StreamConfig::new(t).with_tile_shape(16, 24, 20).with_block_config(block);
                let sink = streaming::MemorySink::new(m, p);
                streaming::matmul_streaming(&a, &b, &sink, &config).unwrap();
                assert_same_bits(&sink.into_matrix(), &reference, &context("streaming"));
            }
        }
    }
}

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
fn streaming_runners_never_change_the_bits() {
    for (m, n, p) in [(1, 1, 1), (9, 13, 11), (37, 23, 41), (70, 75, 133)] {
        let (a, b) = rough_operands(m, n, p);
        let reference = naive::matmul(&a, &b).unwrap();
        for threads in [1, 3, 8] {
            for (rows, cols, depth) in [(16, 24, 20), (1, 1, 1), (1000, 1000, 1000)] {
                let config = StreamConfig::new(nz(threads)).with_tile_shape(rows, cols, depth);
                let context = |runner: &str| {
                    format!("streaming, {runner}, tiles {rows}x{cols}x{depth}, shape {m}x{n}x{p}, {threads} thread(s)")
                };

                let inline = CountingInline::new();
                let sink = streaming::MemorySink::new(m, p);
                streaming::matmul_streaming_with_runner(&a, &b, &sink, &config, &inline).unwrap();
                assert_same_bits(&sink.into_matrix(), &reference, &context("inline"));
                let jobs_expected = threads.min(streaming::tile_plan(m, n, p, &config).tiles.len());
                assert_eq!(inline.jobs(), jobs_expected, "{}", context("job count"));

                let sink = streaming::MemorySink::new(m, p);
                streaming::matmul_streaming_with_runner(&a, &b, &sink, &config, &StdRunner).unwrap();
                assert_same_bits(&sink.into_matrix(), &reference, &context("std"));
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
        let config = StreamConfig::new(nz(4));
        streaming::matmul_streaming_with_runner(&a, &b, &streaming::MemorySink::new(m, p), &config, &inline).unwrap();
        assert_eq!(inline.jobs(), 0, "shape {m}x{n}x{p}");
    }
}

#[test]
fn every_level_treats_the_identity_as_neutral() {
    let a = Matrix::from_fn(5, 5, |i, j| (i * 5 + j) as f64);
    let identity = Matrix::from_fn(5, 5, |i, j| if i == j { 1.0 } else { 0.0 });
    for (level, c) in product_at_every_level(&a, &identity, 3) {
        assert_eq!(c, a, "{level}");
    }
}

#[test]
fn more_threads_than_rows() {
    let (a, b) = sample_operands(2, 4, 3);
    let reference = naive::matmul(&a, &b).unwrap();
    assert_eq!(threaded::matmul(&a, &b, nz(16)).unwrap(), reference);
    assert_eq!(cache_friendly::matmul(&a, &b, nz(16)).unwrap(), reference);
    assert_eq!(simd::matmul(&a, &b, nz(16)).unwrap(), reference);
    assert_eq!(streaming::matmul(&a, &b, nz(16)).unwrap(), reference);
}

#[test]
fn empty_operands_give_empty_results() {
    let t = nz(4);
    for (m, n, p) in [(0, 3, 2), (2, 3, 0), (0, 3, 0)] {
        let (a, b) = (Matrix::zeros(m, n), Matrix::zeros(n, p));
        let shape = |c: &Matrix| (c.rows(), c.cols());
        assert_eq!(shape(&naive::matmul(&a, &b).unwrap()), (m, p));
        assert_eq!(shape(&threaded::matmul(&a, &b, t).unwrap()), (m, p));
        assert_eq!(shape(&cache_friendly::matmul(&a, &b, t).unwrap()), (m, p));
        assert_eq!(shape(&simd::matmul(&a, &b, t).unwrap()), (m, p));
        assert_eq!(shape(&streaming::matmul(&a, &b, t).unwrap()), (m, p));
    }
}

#[test]
fn zero_shared_dimension_gives_a_zero_matrix() {
    let (a, b) = (Matrix::zeros(2, 0), Matrix::zeros(0, 3));
    let expected = Matrix::zeros(2, 3);
    for (level, c) in product_at_every_level(&a, &b, 2) {
        assert_eq!(c, expected, "{level}");
    }
}

#[test]
fn every_level_rejects_mismatched_dimensions() {
    let (a, b) = (Matrix::zeros(2, 3), Matrix::zeros(2, 3));
    let expected = DimensionMismatch { lhs: (2, 3), rhs: (2, 3) };
    let t = nz(2);

    assert_eq!(naive::matmul(&a, &b).unwrap_err(), expected);
    assert_eq!(threaded::matmul(&a, &b, t).unwrap_err(), expected);
    assert_eq!(cache_friendly::matmul(&a, &b, t).unwrap_err(), expected);
    assert_eq!(simd::matmul(&a, &b, t).unwrap_err(), expected);
    assert!(matches!(
        streaming::matmul(&a, &b, t),
        Err(MatmulError::DimensionMismatch(e)) if e == expected
    ));
}
