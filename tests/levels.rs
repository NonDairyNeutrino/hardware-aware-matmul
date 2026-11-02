//! Cross-level tests: every implementation must produce exactly the same
//! result as the naive one, for every shape and thread count.
//!
//! The levels differ in *how* they compute, never in *what* they compute: each
//! output element is summed in increasing `k` order starting from zero, so the
//! results are bit-for-bit identical. These tests assert exact equality.

use std::num::NonZeroUsize;

use naive_matmul::streaming::StreamConfig;
use naive_matmul::{cache_friendly, naive, streaming, threaded, DimensionMismatch, MatmulError, Matrix};

fn nz(n: usize) -> NonZeroUsize {
    NonZeroUsize::new(n).unwrap()
}

/// Operands whose entries are small integers, so every sum is exact.
fn sample_operands(m: usize, n: usize, p: usize) -> (Matrix, Matrix) {
    let a = Matrix::from_fn(m, n, |i, j| ((i * 3 + j) % 7) as f64 - 3.0);
    let b = Matrix::from_fn(n, p, |i, j| ((i + 5 * j) % 11) as f64 - 5.0);
    (a, b)
}

/// The product computed at every level, labelled by module name.
///
/// Level 3 is run with small tiles so that even modest matrices are split into
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
        let (a, b) = sample_operands(m, n, p);
        for threads in [1, 3, 8] {
            let results = product_at_every_level(&a, &b, threads);
            let reference = &results[0].1;
            for (level, c) in &results[1..] {
                assert_eq!(c, reference, "{level}, shape {m}x{n}x{p}, {threads} thread(s)");
            }
        }
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
    assert!(matches!(
        streaming::matmul(&a, &b, t),
        Err(MatmulError::DimensionMismatch(e)) if e == expected
    ));
}
