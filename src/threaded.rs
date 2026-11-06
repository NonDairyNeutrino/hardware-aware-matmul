#![doc = include_str!("../docs/levels/threaded.md")]

use std::num::NonZeroUsize;
use std::ops::Range;

use crate::error::{check_inner_dimensions, DimensionMismatch};
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};

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

/// Divides `rows` output rows into the contiguous blocks that [`matmul`] (and
/// levels 2 and 3) give to their threads.
///
/// The rows are cut into at most `threads` blocks of equal size; the last block
/// may be smaller. If there are fewer rows than threads, there are fewer blocks
/// than threads, and zero rows give no blocks at all. The blocks are returned
/// in row order and together cover `0..rows` exactly once.
///
/// This is the function the drivers themselves call, so it describes what the
/// code does rather than a copy of it.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use hardware_aware_matmul::threaded::row_block_plan;
///
/// let plan = row_block_plan(10, NonZeroUsize::new(4).unwrap());
/// assert_eq!(plan, vec![0..3, 3..6, 6..9, 9..10]);
/// ```
pub fn row_block_plan(rows: usize, threads: NonZeroUsize) -> Vec<Range<usize>> {
    if rows == 0 {
        return Vec::new();
    }
    let rows_per_block = rows.div_ceil(threads.get());
    (0..rows)
        .step_by(rows_per_block)
        .map(|first| first..(first + rows_per_block).min(rows))
        .collect()
}

/// Splits the output rows into jobs for a [`Runner`], running `kernel` on each
/// block.
///
/// `kernel(a, b, first_row, c_block)` fills (or accumulates into) `c_block`, the
/// rows of the output starting at row `first_row`, reading `a` and `b`. The
/// block is zero-initialised by the driver, so both overwriting and
/// accumulating kernels produce the plain product. The kernel is a closure so
/// that it can carry tuning parameters such as
/// [`BlockConfig`](crate::cache_friendly::BlockConfig).
///
/// This is the whole of the parallel structure shared by levels 1, 2, and 3:
/// they differ only in the kernel they pass in. The rows of the result are
/// divided into at most `threads` contiguous blocks of equal size (the last may
/// be smaller). Each block becomes one job handed to `runner`; if there are
/// fewer rows than `threads` there are fewer jobs.
pub(crate) fn multiply_by_row_blocks<K, R>(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    kernel: K,
    runner: &R,
) -> Result<Matrix, DimensionMismatch>
where
    K: Fn(&Matrix, &Matrix, usize, &mut [f64]) + Sync,
    R: Runner + ?Sized,
{
    let (m, _, p) = check_inner_dimensions((a.rows(), a.cols()), (b.rows(), b.cols()))?;

    // Zero-initialised, because some kernels accumulate into it.
    let mut c = Matrix::zeros(m, p);
    if c.as_slice().is_empty() {
        // Nothing to compute; also avoids `chunks_mut(0)`, which panics.
        return Ok(c);
    }

    // Every thread shares one kernel by reference.
    let kernel = &kernel;

    // One job per row block; the runner decides where and when each one runs.
    let mut jobs: Vec<Box<dyn FnOnce() + Send + '_>> = Vec::new();
    let mut remaining = c.as_mut_slice();
    for block in row_block_plan(m, threads) {
        let (c_block, rest) = std::mem::take(&mut remaining).split_at_mut(block.len() * p);
        remaining = rest;
        let first_row = block.start;
        jobs.push(Box::new(move || kernel(a, b, first_row, c_block)));
    }
    runner.run(jobs);

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
/// use hardware_aware_matmul::{threaded, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let c = threaded::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), hardware_aware_matmul::DimensionMismatch>(())
/// ```
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    matmul_with_runner(a, b, threads, &StdRunner)
}

/// Like [`matmul`], with the row blocks executed by `runner`.
///
/// [`matmul`] uses [`StdRunner`]. Results are bit-for-bit identical for every
/// runner. See the [`runner`](crate::runner) module for an example.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
pub fn matmul_with_runner<R: Runner + ?Sized>(
    a: &Matrix,
    b: &Matrix,
    threads: NonZeroUsize,
    runner: &R,
) -> Result<Matrix, DimensionMismatch> {
    multiply_by_row_blocks(a, b, threads, multiply_row_block, runner)
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
    fn row_block_plan_has_a_short_last_block() {
        assert_eq!(row_block_plan(10, nz(4)), vec![0..3, 3..6, 6..9, 9..10]);
        assert_eq!(row_block_plan(7, nz(3)), vec![0..3, 3..6, 6..7]);
    }

    #[test]
    fn row_block_plan_has_fewer_blocks_than_threads_when_rows_run_out() {
        assert_eq!(row_block_plan(2, nz(16)), vec![0..1, 1..2]);
        assert_eq!(row_block_plan(5, nz(4)), vec![0..2, 2..4, 4..5]);
    }

    #[test]
    fn row_block_plan_of_no_rows_is_empty() {
        assert!(row_block_plan(0, nz(4)).is_empty());
    }

    #[test]
    fn row_block_plan_covers_every_row_exactly_once() {
        for rows in 0..40 {
            for threads in 1..=9 {
                let plan = row_block_plan(rows, nz(threads));
                assert!(plan.len() <= threads);
                let mut next_row = 0;
                for block in &plan {
                    assert_eq!(block.start, next_row, "rows={rows}, threads={threads}");
                    assert!(!block.is_empty());
                    next_row = block.end;
                }
                assert_eq!(next_row, rows, "rows={rows}, threads={threads}");
            }
        }
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
