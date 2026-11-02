#![doc = include_str!("../docs/levels/cache_friendly.md")]

use std::num::NonZeroUsize;
use std::thread;

use crate::error::{check_inner_dimensions, DimensionMismatch};
use crate::matrix::Matrix;

/// Number of `k` values (rows of `b`) processed per cache block.
///
/// With [`TILE_J`], a cache block of `b` is `32 * 64 * 8 = 16 KiB`, leaving
/// room in a typical 32 KiB L1 data cache for the active segments of `a` and
/// `c`. These are reasonable defaults, not tuned constants; the best values
/// depend on the CPU.
pub(crate) const TILE_K: usize = 32;

/// Number of `j` values (columns of `b` and `c`) processed per cache block.
pub(crate) const TILE_J: usize = 64;

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
/// Loop structure, outermost first: block of `k`, block of `j`, row of the
/// output block, `k` within the block, then [`axpy`] over the `j` block.
/// Keeping the row loop inside the two block loops means the same block of `b`
/// is reused for every row while it is hot in cache.
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64]) {
    let n = a.cols();
    let p = b.cols();

    for k_start in (0..n).step_by(TILE_K) {
        let k_end = (k_start + TILE_K).min(n);

        for j_start in (0..p).step_by(TILE_J) {
            let j_end = (j_start + TILE_J).min(p);

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
    let (m, _, p) = check_inner_dimensions((a.rows(), a.cols()), (b.rows(), b.cols()))?;

    // Zero-initialised, because the kernel accumulates into it.
    let mut c = Matrix::zeros(m, p);
    if c.as_slice().is_empty() {
        // Nothing to compute; also avoids `chunks_mut(0)`, which panics.
        return Ok(c);
    }

    let rows_per_block = m.div_ceil(threads.get());
    let block_len = rows_per_block * p;

    thread::scope(|scope| {
        for (block_idx, c_block) in c.as_mut_slice().chunks_mut(block_len).enumerate() {
            let first_row = block_idx * rows_per_block;
            scope.spawn(move || multiply_row_block(a, b, first_row, c_block));
        }
    });

    Ok(c)
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
        multiply_row_block(&a, &b, 1, &mut block);
        assert_eq!(block, full.as_slice()[b.cols()..3 * b.cols()]);
    }

    #[test]
    fn kernel_accumulates_into_existing_values() {
        let a = Matrix::new(1, 2, vec![1.0, 2.0]);
        let b = Matrix::new(2, 1, vec![3.0, 4.0]);
        let mut block = vec![100.0];
        multiply_row_block(&a, &b, 0, &mut block);
        assert_eq!(block, [111.0]);
    }

    #[test]
    fn rejects_mismatched_dimensions() {
        let err = matmul(&Matrix::zeros(2, 3), &Matrix::zeros(2, 3), nz(2)).unwrap_err();
        assert_eq!(err, DimensionMismatch { lhs: (2, 3), rhs: (2, 3) });
    }
}
