//! Integration tests for the streaming level (level 3), exercising only the
//! public API: tile shapes, error propagation, and file-backed matrices.
//! `tests/levels.rs` checks that all five levels agree.

use std::io;
use std::num::NonZeroUsize;

use naive_matmul::runner::Runner;
use naive_matmul::streaming::{
    matmul, matmul_streaming, matmul_streaming_with_runner, MemorySink, StreamConfig, TileSource,
};
use naive_matmul::{DimensionMismatch, MatmulError, Matrix};

fn nz(n: usize) -> NonZeroUsize {
    NonZeroUsize::new(n).unwrap()
}

/// Straightforward `i-j-k` reference implementation.
fn reference_matmul(a: &Matrix, b: &Matrix) -> Matrix {
    let mut c = Matrix::zeros(a.rows(), b.cols());
    for i in 0..a.rows() {
        for j in 0..b.cols() {
            let mut sum = 0.0;
            for k in 0..a.cols() {
                sum += a[(i, k)] * b[(k, j)];
            }
            c.as_mut_slice()[i * b.cols() + j] = sum;
        }
    }
    c
}

/// Operands whose entries are small integers, so every sum is exact.
fn sample_operands(m: usize, n: usize, p: usize) -> (Matrix, Matrix) {
    let a = Matrix::from_fn(m, n, |i, j| ((i * 3 + j) % 7) as f64 - 3.0);
    let b = Matrix::from_fn(n, p, |i, j| ((i + 5 * j) % 11) as f64 - 5.0);
    (a, b)
}

#[test]
fn small_product() {
    let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
    let expected = Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]);
    for t in 1..=4 {
        assert_eq!(matmul(&a, &b, nz(t)).unwrap(), expected);
    }
}

#[test]
fn matches_single_threaded() {
    let a = Matrix::from_fn(37, 23, |i, j| (i * j) as f64 + 1.0);
    let b = Matrix::from_fn(23, 41, |i, j| (i + 2 * j) as f64);
    let serial = matmul(&a, &b, nz(1)).unwrap();
    assert_eq!(matmul(&a, &b, nz(8)).unwrap(), serial);
}

#[test]
fn more_threads_than_tiles() {
    let a = Matrix::from_fn(2, 2, |i, j| (i + j) as f64);
    let b = Matrix::from_fn(2, 2, |i, j| (i * j) as f64 + 1.0);
    assert_eq!(matmul(&a, &b, nz(16)).unwrap(), matmul(&a, &b, nz(1)).unwrap());
}

#[test]
fn identity_is_neutral() {
    let a = Matrix::from_fn(5, 5, |i, j| (i * 5 + j) as f64);
    let identity = Matrix::from_fn(5, 5, |i, j| if i == j { 1.0 } else { 0.0 });
    assert_eq!(matmul(&a, &identity, nz(3)).unwrap(), a);
}

#[test]
fn matches_reference_across_cache_tile_boundaries() {
    // Larger than, and not a multiple of, the kernel's internal cache tiles.
    let (a, b) = sample_operands(70, 75, 133);
    let expected = reference_matmul(&a, &b);
    for t in [1, 3, 8] {
        assert_eq!(matmul(&a, &b, nz(t)).unwrap(), expected);
    }
}

#[test]
fn empty_operands_give_empty_result() {
    let c = matmul(&Matrix::zeros(0, 3), &Matrix::zeros(3, 2), nz(4)).unwrap();
    assert_eq!((c.rows(), c.cols()), (0, 2));

    let c = matmul(&Matrix::zeros(2, 3), &Matrix::zeros(3, 0), nz(4)).unwrap();
    assert_eq!((c.rows(), c.cols()), (2, 0));
}

#[test]
fn zero_shared_dimension_gives_zero_matrix() {
    let c = matmul(&Matrix::zeros(2, 0), &Matrix::zeros(0, 3), nz(2)).unwrap();
    assert_eq!(c, Matrix::zeros(2, 3));
}

#[test]
fn rejects_mismatched_dimensions() {
    let a = Matrix::zeros(2, 3);
    let b = Matrix::zeros(2, 3);
    match matmul(&a, &b, nz(2)) {
        Err(MatmulError::DimensionMismatch(e)) => {
            assert_eq!(e, DimensionMismatch { lhs: (2, 3), rhs: (2, 3) });
        }
        other => panic!("expected a dimension mismatch, got {other:?}"),
    }
}

#[test]
fn streaming_matches_reference_for_awkward_tile_shapes() {
    let (a, b) = sample_operands(70, 75, 133);
    let expected = reference_matmul(&a, &b);

    // Includes 1x1x1 tiles, tiles that don't divide the dimensions, and
    // tiles larger than the matrices.
    let shapes = [(16, 24, 20), (1, 1, 1), (7, 200, 3), (1000, 1000, 1000)];
    for (rows, cols, depth) in shapes {
        for threads in [1, 3, 8] {
            let config = StreamConfig::new(nz(threads)).with_tile_shape(rows, cols, depth);
            let sink = MemorySink::new(70, 133);
            matmul_streaming(&a, &b, &sink, &config).unwrap();
            assert_eq!(
                sink.into_matrix(),
                expected,
                "tile shape {rows}x{cols}x{depth}, {threads} thread(s)"
            );
        }
    }
}

#[test]
fn streaming_rejects_wrong_output_shape() {
    let a = Matrix::zeros(2, 3);
    let b = Matrix::zeros(3, 4);
    let sink = MemorySink::new(2, 5);
    let config = StreamConfig::new(nz(1));
    assert!(matches!(
        matmul_streaming(&a, &b, &sink, &config),
        Err(MatmulError::OutputShapeMismatch { expected: (2, 4), actual: (2, 5) })
    ));
}

/// A source that always fails, to check that I/O errors propagate.
struct FailingSource;

impl TileSource for FailingSource {
    fn shape(&self) -> (usize, usize) {
        (8, 8)
    }

    fn read_tile(&self, _: usize, _: usize, _: usize, _: usize, _: &mut [f64]) -> io::Result<()> {
        Err(io::Error::new(io::ErrorKind::Other, "disk on fire"))
    }
}

#[test]
fn io_errors_propagate() {
    let b = Matrix::zeros(8, 8);
    let sink = MemorySink::new(8, 8);
    let config = StreamConfig::new(nz(4)).with_tile_shape(2, 2, 2);
    match matmul_streaming(&FailingSource, &b, &sink, &config) {
        Err(MatmulError::Io(e)) => assert!(e.to_string().contains("disk on fire")),
        other => panic!("expected an I/O error, got {other:?}"),
    }
}

/// Runs every job on the calling thread, one after another.
struct Inline;

impl Runner for Inline {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        for job in jobs {
            job();
        }
    }
}

#[test]
fn io_errors_propagate_through_any_runner() {
    let b = Matrix::zeros(8, 8);
    let sink = MemorySink::new(8, 8);
    let config = StreamConfig::new(nz(4)).with_tile_shape(2, 2, 2);
    match matmul_streaming_with_runner(&FailingSource, &b, &sink, &config, &Inline) {
        Err(MatmulError::Io(e)) => assert!(e.to_string().contains("disk on fire")),
        other => panic!("expected an I/O error, got {other:?}"),
    }
}

/// A source whose reads panic, to check that panics reach the caller.
struct PanickingSource;

impl TileSource for PanickingSource {
    fn shape(&self) -> (usize, usize) {
        (8, 8)
    }

    fn read_tile(&self, _: usize, _: usize, _: usize, _: usize, _: &mut [f64]) -> io::Result<()> {
        panic!("boom");
    }
}

#[test]
#[should_panic(expected = "boom")]
fn a_panic_in_a_source_reaches_the_caller_of_an_inline_runner() {
    let b = Matrix::zeros(8, 8);
    let sink = MemorySink::new(8, 8);
    let config = StreamConfig::new(nz(2)).with_tile_shape(2, 2, 2);
    let _ = matmul_streaming_with_runner(&PanickingSource, &b, &sink, &config, &Inline);
}

#[cfg(any(unix, windows))]
mod file_backed {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::{env, fs, process};

    use super::*;
    use naive_matmul::streaming::FileMatrix;

    /// A unique temporary path that is deleted when dropped.
    struct TempPath(PathBuf);

    impl TempPath {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let id = COUNTER.fetch_add(1, Ordering::Relaxed);
            let name = format!("naive_matmul_test_{}_{tag}_{id}.bin", process::id());
            Self(env::temp_dir().join(name))
        }
    }

    impl Drop for TempPath {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    fn read_all(m: &FileMatrix) -> Matrix {
        let (rows, cols) = m.shape();
        let mut data = vec![0.0; rows * cols];
        m.read_tile(0, 0, rows, cols, &mut data).unwrap();
        Matrix::new(rows, cols, data)
    }

    #[test]
    fn tiles_round_trip_through_a_file() {
        let path = TempPath::new("roundtrip");
        let m = FileMatrix::create(&path.0, 4, 5).unwrap();
        m.fill_with(|i, j| (10 * i + j) as f64).unwrap();

        let mut tile = [0.0; 4];
        m.read_tile(1, 2, 2, 2, &mut tile).unwrap();
        assert_eq!(tile, [12.0, 13.0, 22.0, 23.0]);

        use naive_matmul::streaming::TileSink;
        m.write_tile(1, 2, 2, 2, &[-1.0, -2.0, -3.0, -4.0]).unwrap();
        m.read_tile(1, 2, 2, 2, &mut tile).unwrap();
        assert_eq!(tile, [-1.0, -2.0, -3.0, -4.0]);
    }

    #[test]
    fn open_rejects_a_file_of_the_wrong_length() {
        let path = TempPath::new("badlen");
        FileMatrix::create(&path.0, 3, 3).unwrap();
        let err = FileMatrix::open(&path.0, 4, 4).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
        assert!(FileMatrix::open(&path.0, 3, 3).is_ok());
    }

    #[test]
    fn file_backed_product_matches_in_memory_product() {
        let (m, n, p) = (45, 38, 51);
        let (a_mem, b_mem) = sample_operands(m, n, p);

        let (a_path, b_path, c_path) = (TempPath::new("a"), TempPath::new("b"), TempPath::new("c"));
        let a = FileMatrix::create(&a_path.0, m, n).unwrap();
        a.fill_with(|i, j| a_mem[(i, j)]).unwrap();
        let b = FileMatrix::create(&b_path.0, n, p).unwrap();
        b.fill_with(|i, j| b_mem[(i, j)]).unwrap();
        let c = FileMatrix::create(&c_path.0, m, p).unwrap();

        let config = StreamConfig::new(nz(4)).with_tile_shape(16, 16, 16);
        matmul_streaming(&a, &b, &c, &config).unwrap();

        assert_eq!(read_all(&c), reference_matmul(&a_mem, &b_mem));
    }
}
