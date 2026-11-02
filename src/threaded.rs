#![doc = include_str!("../docs/levels/threaded.md")]

use std::num::NonZeroUsize;
use std::thread;

use crate::error::{check_inner_dimensions, DimensionMismatch};
use crate::matrix::Matrix;

/// Computes a contiguous block of rows of the product `a * b`.
///
/// `c_block` is the portion of the output covering rows
/// `first_row .. first_row + c_block.len() / b.cols()`, stored row-major. Its
/// length must be a multiple of `b.cols()`, and `b.cols()` must be non-zero.
///
/// The body is the same triple loop as [`naive::matmul`](crate::naive::matmul),
/// restricted to the rows in the block. It only reads `a` and `b` and only
/// writes `c_block`, so calls with non-overlapping blocks may run concurrently.
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64]) {
    for (offset, c_row) in c_block.chunks_exact_mut(b.cols()).enumerate() {
        let a_row = a.row(first_row + offset);
        for (j, c_ij) in c_row.iter_mut().enumerate() {
            let mut sum = 0.0;
            for (k, &a_ik) in a_row.iter().enumerate() {
                sum += a_ik * b[(k, j)];
            }
            *c_ij = sum;
        }
    }
}

/// The signature of a kernel that [`multiply_by_row_blocks`] can drive.
///
/// A kernel fills (or accumulates into) `c_block`, the rows of the output
/// starting at row `first_row`, reading `a` and `b`. The block is
/// zero-initialised by the driver, so both overwriting and accumulating kernels
/// produce the plain product.
pub(crate) type RowBlockKernel = fn(&Matrix, &Matrix, usize, &mut [f64]);

/// Splits the output rows across `threads` scoped threads, running `kernel`
/// on each block.
///
/// This is the whole of the parallel structure shared by levels 1, 2, and 3:
/// they differ only in the kernel they pass in. The rows of the result are
/// divided into at most `threads` contiguous blocks of equal size (the last may
/// be smaller). If there are fewer rows than threads, only as many threads as
/// there are non-empty blocks are spawned.
pub(crate) fn multiply_by_row_blocks(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    kernel: RowBlockKernel,
) -> Result<Matrix, DimensionMismatch> {
    let (m, _, p) = check_inner_dimensions((a.rows(), a.cols()), (b.rows(), b.cols()))?;

    // Zero-initialised, because some kernels accumulate into it.
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
            scope.spawn(move || kernel(a, b, first_row, c_block));
        }
    });

    Ok(c)
}

/// Multiplies `a` by `b`, splitting the output rows across `threads` threads.
///
/// The rows of the result are divided into at most `threads` contiguous
/// blocks of equal size (the last may be smaller), and each block is computed
/// by `multiply_row_block` on its own scoped thread. If there are fewer rows
/// than threads, only as many threads as there are non-empty blocks are
/// spawned.
///
/// Results are bit-for-bit identical to [`naive::matmul`](crate::naive::matmul)
/// for any thread count.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::{threaded, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let c = threaded::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), naive_matmul::DimensionMismatch>(())
/// ```
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(a, b, threads, multiply_row_block)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nz(n: usize) -> NonZeroUsize {
        NonZeroUsize::new(n).unwrap()
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

        // Rows 1..3 computed by the kernel alone must match the full result.
        let mut block = vec![0.0; 2 * b.cols()];
        multiply_row_block(&a, &b, 1, &mut block);
        assert_eq!(block, full.as_slice()[b.cols()..3 * b.cols()]);
    }

    #[test]
    fn more_threads_than_rows() {
        let a = Matrix::from_fn(2, 2, |i, j| (i + j) as f64);
        let b = Matrix::from_fn(2, 2, |i, j| (i * j) as f64 + 1.0);
        assert_eq!(matmul(&a, &b, nz(16)).unwrap(), matmul(&a, &b, nz(1)).unwrap());
    }

    #[test]
    fn rejects_mismatched_dimensions() {
        let err = matmul(&Matrix::zeros(2, 3), &Matrix::zeros(2, 3), nz(2)).unwrap_err();
        assert_eq!(err, DimensionMismatch { lhs: (2, 3), rhs: (2, 3) });
    }
}
