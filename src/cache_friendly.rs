#![doc = include_str!("../docs/levels/cache_friendly.md")]

use std::num::NonZeroUsize;

use crate::error::DimensionMismatch;
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};
use crate::threaded::multiply_by_row_blocks;

/// Number of `k` values (rows of `b`) processed per cache block.
///
/// With [`TILE_J`], a cache block of `b` is `32 * 64 * 8 = 16 KiB`, leaving
/// room in a typical 32 KiB L1 data cache for the active segments of `a` and
/// `c`. These are reasonable defaults, not tuned constants; the best values
/// depend on the CPU.
pub(crate) const TILE_K: usize = 32;

/// Number of `j` values (columns of `b` and `c`) processed per cache block.
pub(crate) const TILE_J: usize = 64;

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
///
/// This is the innermost loop of every level from here on. Both slices are
/// contiguous and iterated in lockstep, so there are no bounds checks in the
/// loop body and the compiler is free to vectorise it. Extra elements of the
/// longer slice are ignored.
pub(crate) fn axpy(alpha: f64, x: &[f64], y: &mut [f64]) {
    for (y_j, &x_j) in y.iter_mut().zip(x) {
        *y_j += alpha * x_j;
    }
}

/// Accumulates a contiguous block of rows of the product `a * b`.
///
/// `c_block` is the portion of the output covering rows
/// `first_row .. first_row + c_block.len() / b.cols()`, stored row-major. The
/// function **adds** into `c_block` (`C += A·B`), so the caller zero-initialises
/// it to obtain the plain product. `b.cols()` must be non-zero.
///
/// The cache-block sizes come from `block`.
///
/// Loop structure, outermost first: block of `k`, block of `j`, row of the
/// output block, `k` within the block, then [`axpy`] over the `j` block.
/// Keeping the row loop inside the two block loops means the same block of `b`
/// is reused for every row while it is hot in cache.
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64], block: &BlockConfig) {
    let n = a.cols();
    let p = b.cols();

    for k_start in (0..n).step_by(block.tile_k()) {
        let k_end = (k_start + block.tile_k()).min(n);

        for j_start in (0..p).step_by(block.tile_j()) {
            let j_end = (j_start + block.tile_j()).min(p);

            for (offset, c_row) in c_block.chunks_exact_mut(p).enumerate() {
                let a_segment = &a.row(first_row + offset)[k_start..k_end];
                let c_segment = &mut c_row[j_start..j_end];

                for (k_offset, &a_ik) in a_segment.iter().enumerate() {
                    let b_segment = &b.row(k_start + k_offset)[j_start..j_end];
                    axpy(a_ik, b_segment, c_segment);
                }
            }
        }
    }
}

/// Multiplies `a` by `b` on `threads` threads, with a cache-friendly kernel.
///
/// Work is divided exactly as in [`threaded::matmul`](crate::threaded::matmul):
/// contiguous blocks of output rows, one scoped thread per block. What changed
/// is the kernel each thread runs: an `i-k-j` loop order plus cache blocking.
///
/// Results are bit-for-bit identical to [`naive::matmul`](crate::naive::matmul)
/// for any thread count, because every output element is still summed in
/// increasing `k` order.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::{cache_friendly, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let c = cache_friendly::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), naive_matmul::DimensionMismatch>(())
/// ```
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

#[cfg(test)]
mod tests {
    use super::*;

    fn nz(n: usize) -> NonZeroUsize {
        NonZeroUsize::new(n).unwrap()
    }

    #[test]
    fn axpy_accumulates() {
        let mut y = [1.0, 2.0, 3.0];
        axpy(2.0, &[10.0, 20.0, 30.0], &mut y);
        assert_eq!(y, [21.0, 42.0, 63.0]);
    }

    #[test]
    fn small_product_at_several_thread_counts() {
        let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
        for t in 1..=4 {
            let c = matmul(&a, &b, nz(t)).unwrap();
            assert_eq!(c.as_slice(), &[58.0, 64.0, 139.0, 154.0]);
        }
    }

    #[test]
    fn kernel_fills_only_its_block() {
        let a = Matrix::from_fn(4, 2, |i, j| (i + j) as f64);
        let b = Matrix::from_fn(2, 3, |i, j| (i * 3 + j) as f64);
        let full = matmul(&a, &b, nz(1)).unwrap();

        let mut block = vec![0.0; 2 * b.cols()];
        multiply_row_block(&a, &b, 1, &mut block, &BlockConfig::default());
        assert_eq!(block, full.as_slice()[b.cols()..3 * b.cols()]);
    }

    #[test]
    fn kernel_accumulates_into_existing_values() {
        let a = Matrix::new(1, 2, vec![1.0, 2.0]);
        let b = Matrix::new(2, 1, vec![3.0, 4.0]);
        let mut block = vec![100.0];
        multiply_row_block(&a, &b, 0, &mut block, &BlockConfig::default());
        assert_eq!(block, [111.0]);
    }

    #[test]
    fn rejects_mismatched_dimensions() {
        let err = matmul(&Matrix::zeros(2, 3), &Matrix::zeros(2, 3), nz(2)).unwrap_err();
        assert_eq!(err, DimensionMismatch { lhs: (2, 3), rhs: (2, 3) });
    }
}
