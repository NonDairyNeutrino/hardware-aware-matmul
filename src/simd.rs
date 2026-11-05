#![doc = include_str!("../docs/levels/simd.md")]

use std::num::NonZeroUsize;
use std::ops::Range;

use crate::cache_friendly::{axpy, BlockConfig};
use crate::error::DimensionMismatch;
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};
use crate::threaded::multiply_by_row_blocks;

/// Rows of `C` in one micro-tile: how many rows share each loaded vector of `B`.
pub(crate) const MR: usize = 4;

/// Columns of `C` in one micro-tile: a whole number of vector registers.
///
/// Chosen from the vector width the crate was *compiled* for: 8 columns with
/// 256-bit vectors (AVX and later), otherwise 4. With these values, the
/// `MR × NR` block of accumulators occupies 8 vector registers in either case,
/// which leaves room in a 16-register file for the loaded `B` vectors and the
/// broadcast `A` value without spilling to the stack.
pub(crate) const NR: usize = if cfg!(target_feature = "avx") { 8 } else { 4 };

/// Returns the name of the widest vector instruction set this build targets.
///
/// This is decided when the crate is *compiled*, not at run time: a default
/// build for `x86_64` targets SSE2 (two `f64` lanes per register) even on a
/// CPU that supports AVX-512. Compile with `RUSTFLAGS="-C target-cpu=native"`
/// to let the compiler use everything the build machine offers.
///
/// # Examples
///
/// ```
/// let isa = naive_matmul::simd::target_vector_isa();
/// assert!(!isa.is_empty());
/// ```
pub fn target_vector_isa() -> &'static str {
    if cfg!(target_feature = "avx512f") {
        "AVX-512"
    } else if cfg!(target_feature = "avx2") {
        "AVX2"
    } else if cfg!(target_feature = "avx") {
        "AVX"
    } else if cfg!(target_feature = "sse2") {
        "SSE2"
    } else if cfg!(target_feature = "neon") {
        "NEON"
    } else if cfg!(target_feature = "simd128") {
        "WASM SIMD128"
    } else {
        "none (scalar code)"
    }
}

/// Returns the shape `(rows, cols)` of the register-blocked micro-tile.
pub fn micro_tile_shape() -> (usize, usize) {
    (MR, NR)
}

/// The micro-kernel: updates an `MR × NR` block of `C` held entirely in
/// registers.
///
/// For each `k` it multiplies one vector-width row of `B` by `MR` scalars from
/// `A` and adds the products into `MR × NR` accumulators:
///
/// ```text
/// acc[i][l] += a_rows[i][k] * b[k][j + l]      for i < MR, l < NR
/// ```
///
/// The accumulators start from the current values of `C` and are written back
/// once at the end, so `C` is loaded and stored once per `depth` multiply-adds
/// rather than once per multiply-add, which is what the `axpy` kernel of the
/// previous level does.
///
/// Why the compiler vectorises this: the `l` loop has a constant trip count
/// over a fixed-size array, its iterations are independent (each lane is a
/// different output element), and `c_rows` are `&mut` slices, so they cannot
/// alias `b`. Each lane still performs its additions in increasing `k`, so no
/// floating-point reassociation is needed, and none is done.
///
/// # Arguments
///
/// * `a_rows` – `MR` slices of `depth` consecutive elements of `A`'s rows.
/// * `b` – the whole right-hand tile, row-major with row length `b_stride`.
/// * `b_origin` – index in `b` of the element at the first `k` and column `j`.
/// * `depth` – the number of `k` values to accumulate.
/// * `c_rows` – the `MR` rows of `C`; columns `j .. j + NR` are updated.
#[allow(clippy::needless_range_loop)] // constant-trip loops: indices make the lanes explicit
fn micro_kernel(
    a_rows: &[&[f64]; MR],
    b: &[f64],
    b_stride: usize,
    b_origin: usize,
    depth: usize,
    c_rows: &mut [&mut [f64]; MR],
    j: usize,
) {
    let mut acc = [[0.0_f64; NR]; MR];
    for i in 0..MR {
        acc[i].copy_from_slice(&c_rows[i][j..j + NR]);
    }

    for k in 0..depth {
        let start = b_origin + k * b_stride;
        let b_vec: &[f64; NR] = b[start..start + NR]
            .try_into()
            .expect("the slice has exactly NR elements");
        for i in 0..MR {
            let a_ik = a_rows[i][k];
            for l in 0..NR {
                acc[i][l] += a_ik * b_vec[l];
            }
        }
    }

    for i in 0..MR {
        c_rows[i][j..j + NR].copy_from_slice(&acc[i]);
    }
}

/// The three tiles of one product, bundled so helper methods stay short.
struct Operands<'a> {
    /// Left tile, row-major, `rows × depth`.
    a: &'a [f64],
    /// Right tile, row-major, `depth × cols`.
    b: &'a [f64],
    depth: usize,
    cols: usize,
}

impl Operands<'_> {
    /// Returns the elements `ks` of row `row` of the left tile.
    fn a_segment(&self, row: usize, ks: &Range<usize>) -> &[f64] {
        let start = row * self.depth;
        &self.a[start + ks.start..start + ks.end]
    }

    /// Updates columns `js` of one row of `C` with plain `axpy` calls.
    ///
    /// This handles the edges that do not fill a whole micro-tile. It adds the
    /// same products in the same `k` order as the micro-kernel, so the result
    /// is identical to what a full micro-tile would have produced.
    fn update_row_edge(&self, a_segment: &[f64], ks: &Range<usize>, c_row: &mut [f64], js: &Range<usize>) {
        if js.is_empty() {
            return;
        }
        let c_segment = &mut c_row[js.clone()];
        for (k_offset, &a_ik) in a_segment.iter().enumerate() {
            let b_row_start = (ks.start + k_offset) * self.cols;
            let b_segment = &self.b[b_row_start + js.start..b_row_start + js.end];
            axpy(a_ik, b_segment, c_segment);
        }
    }

    /// Updates columns `js` of a group of up to `MR` consecutive rows of `C`
    /// (`c_group`, starting at row `first_row`) over the `k` range `ks`.
    #[allow(clippy::needless_range_loop)] // constant-trip loop over the MR rows
    fn update_row_group(&self, c_group: &mut [f64], first_row: usize, ks: &Range<usize>, js: &Range<usize>) {
        let cols = self.cols;

        // A short group (the last one) has too few rows for a micro-tile.
        if c_group.len() < MR * cols {
            for (offset, c_row) in c_group.chunks_exact_mut(cols).enumerate() {
                let a_segment = self.a_segment(first_row + offset, ks);
                self.update_row_edge(a_segment, ks, c_row, js);
            }
            return;
        }

        let a_rows: [&[f64]; MR] = std::array::from_fn(|i| self.a_segment(first_row + i, ks));
        let mut rows = c_group.chunks_exact_mut(cols);
        let mut c_rows: [&mut [f64]; MR] =
            std::array::from_fn(|_| rows.next().expect("a full group has MR rows"));

        // Whole NR-wide strips go through the micro-kernel...
        let strips_end = js.start + (js.len() / NR) * NR;
        for j in (js.start..strips_end).step_by(NR) {
            let b_origin = ks.start * cols + j;
            micro_kernel(&a_rows, self.b, cols, b_origin, ks.len(), &mut c_rows, j);
        }

        // ...and the leftover columns on the right edge take the scalar path.
        for i in 0..MR {
            self.update_row_edge(a_rows[i], ks, c_rows[i], &(strips_end..js.end));
        }
    }
}

/// Accumulates the product of two dense tiles into a third: `C += A·B`.
///
/// Same contract and same loop structure as
/// [`cache_friendly::accumulate_tile`](crate::cache_friendly): all three tiles
/// are row-major and contiguous (`a` is `rows × depth`, `b` is `depth × cols`,
/// `c` is `rows × cols`), `cols` must be non-zero, and the function adds into
/// `c`. The difference is the innermost step: instead of one `axpy` per
/// `(i, k)` pair, whole `MR × NR` blocks of `c` are updated by the
/// register-blocked [`micro_kernel`].
///
/// Edges (fewer than `MR` rows left, or fewer than `NR` columns left in a
/// cache block) fall back to `axpy`. The cache-block sizes come from `block`.
pub(crate) fn accumulate_tile(
    c: &mut [f64],
    a: &[f64],
    b: &[f64],
    depth: usize,
    cols: usize,
    block: &BlockConfig,
) {
    debug_assert_eq!(c.len() % cols, 0);
    debug_assert_eq!(a.len(), c.len() / cols * depth);
    debug_assert_eq!(b.len(), depth * cols);

    let operands = Operands { a, b, depth, cols };

    for k_start in (0..depth).step_by(block.tile_k()) {
        let ks = k_start..(k_start + block.tile_k()).min(depth);

        for j_start in (0..cols).step_by(block.tile_j()) {
            let js = j_start..(j_start + block.tile_j()).min(cols);

            for (group_index, c_group) in c.chunks_mut(MR * cols).enumerate() {
                operands.update_row_group(c_group, group_index * MR, &ks, &js);
            }
        }
    }
}

/// Accumulates the block of output rows starting at `first_row` into `c_block`.
///
/// As in level 2, the matching rows of `a` form one flat slice, so the block is
/// one [`accumulate_tile`] call.
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64], block: &BlockConfig) {
    let n = a.cols();
    let p = b.cols();
    let rows = c_block.len() / p;
    let a_block = &a.as_slice()[first_row * n..(first_row + rows) * n];
    accumulate_tile(c_block, a_block, b.as_slice(), n, p, block);
}

/// Multiplies `a` by `b` on `threads` threads, with a register-blocked,
/// vectorisable kernel.
///
/// Work is divided exactly as in [`threaded::matmul`](crate::threaded::matmul)
/// and [`cache_friendly::matmul`](crate::cache_friendly::matmul): contiguous
/// blocks of output rows, one scoped thread per block. Only the kernel differs.
///
/// Results are bit-for-bit identical to [`naive::matmul`](crate::naive::matmul)
/// for any thread count and any target, because every output element is still
/// summed in increasing `k` order with separate multiply and add operations.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::{simd, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let c = simd::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), naive_matmul::DimensionMismatch>(())
/// ```
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    matmul_with_config(a, b, threads, &BlockConfig::default())
}

/// Like [`matmul`], with explicit cache-block sizes.
///
/// The micro-tile shape stays fixed at compile time (see [`micro_tile_shape`]);
/// only the cache blocks around it are adjustable. Results are bit-for-bit
/// identical to [`matmul`] for every `block`.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::cache_friendly::BlockConfig;
/// use naive_matmul::{simd, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let one = NonZeroUsize::new(1).unwrap();
/// let c = simd::matmul_with_config(&a, &b, one, &BlockConfig::new(one, one))?;
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
    use crate::cache_friendly::{TILE_J, TILE_K};

    fn nz(n: usize) -> NonZeroUsize {
        NonZeroUsize::new(n).unwrap()
    }

    /// Plain `i-j-k` product of flat tiles, summing in increasing `k` from zero.
    fn reference(a: &[f64], b: &[f64], rows: usize, depth: usize, cols: usize) -> Vec<f64> {
        let mut c = vec![0.0; rows * cols];
        for i in 0..rows {
            for j in 0..cols {
                let mut sum = 0.0;
                for k in 0..depth {
                    sum += a[i * depth + k] * b[k * cols + j];
                }
                c[i * cols + j] = sum;
            }
        }
        c
    }

    fn tile(rows: usize, cols: usize, seed: usize) -> Vec<f64> {
        let mut data = Vec::with_capacity(rows * cols);
        for i in 0..rows {
            for j in 0..cols {
                data.push(((i * 7 + j * 3 + seed) % 9) as f64 - 4.0);
            }
        }
        data
    }

    #[test]
    fn accumulate_tile_matches_reference_around_every_edge() {
        // Row counts and column counts on both sides of the micro-tile and
        // cache-block sizes, so every combination of full and partial tiles
        // (and of full and leftover strips) is exercised.
        let row_counts = [1, MR - 1, MR, MR + 1, 2 * MR + 3];
        let col_counts = [1, NR - 1, NR, NR + 1, TILE_J + NR + 1];
        let depths = [1, TILE_K + 3];
        for &rows in &row_counts {
            for &cols in &col_counts {
                for &depth in &depths {
                    let a = tile(rows, depth, 1);
                    let b = tile(depth, cols, 2);
                    let mut c = vec![0.0; rows * cols];
                    accumulate_tile(&mut c, &a, &b, depth, cols, &BlockConfig::default());
                    assert_eq!(
                        c,
                        reference(&a, &b, rows, depth, cols),
                        "rows={rows}, depth={depth}, cols={cols}"
                    );
                }
            }
        }
    }

    #[test]
    fn accumulate_tile_adds_to_existing_values() {
        let (rows, depth, cols) = (MR, 5, NR);
        let a = tile(rows, depth, 3);
        let b = tile(depth, cols, 4);
        let mut c = vec![100.0; rows * cols];
        accumulate_tile(&mut c, &a, &b, depth, cols, &BlockConfig::default());
        let product = reference(&a, &b, rows, depth, cols);
        for (got, want) in c.iter().zip(&product) {
            assert_eq!(*got, 100.0 + want);
        }
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
    fn rejects_mismatched_dimensions() {
        let err = matmul(&Matrix::zeros(2, 3), &Matrix::zeros(2, 3), nz(2)).unwrap_err();
        assert_eq!(err, DimensionMismatch { lhs: (2, 3), rhs: (2, 3) });
    }

    #[test]
    fn reports_a_target_description_and_micro_tile() {
        assert!(!target_vector_isa().is_empty());
        assert_eq!(micro_tile_shape(), (MR, NR));
    }
}
