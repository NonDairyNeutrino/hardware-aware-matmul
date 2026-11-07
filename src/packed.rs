#![doc = include_str!("../docs/levels/packed.md")]

use std::num::NonZeroUsize;
use std::ops::Range;

use crate::cache_friendly::BlockConfig;
use crate::error::DimensionMismatch;
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};
use crate::simd::{micro_kernel, Operands, MR, NR};
use crate::threaded::multiply_by_row_blocks;

/// Copies the whole `NR`-wide strips of one cache block of `B` into `out`,
/// strip after strip, each strip stored `k` by `k`.
///
/// The block is rows `ks` and columns `js_start .. js_start + strips * NR` of
/// the row-major `b` (row length `cols`). Afterwards strip `s` is the slice
/// `out[s * ks.len() * NR ..][.. ks.len() * NR]`, and element `(k, l)` of that
/// strip, the value `b[ks.start + k][js_start + s * NR + l]`, sits at offset
/// `k * NR + l`. The micro-kernel walks exactly this order, so it reads one
/// strip front to back.
///
/// `out` is cleared first and keeps its allocation, so one buffer serves every
/// block of a call.
pub(crate) fn pack_strips(b: &[f64], cols: usize, ks: &Range<usize>, js_start: usize, strips: usize, out: &mut Vec<f64>) {
    out.clear();
    out.reserve(strips * ks.len() * NR);
    for s in 0..strips {
        for k in ks.clone() {
            let start = k * cols + js_start + s * NR;
            out.extend_from_slice(&b[start..start + NR]);
        }
    }
}

/// Updates one group of up to `MR` consecutive rows of `C` (`c_group`,
/// starting at row `first_row`) over the `k` range `ks` and the columns `js`.
///
/// `packed` holds the `strips` whole strips that start at `js.start`, as laid
/// out by [`pack_strips`]. Columns after the last strip take the scalar edge
/// path of level 3, as does a group of fewer than `MR` rows.
#[allow(clippy::needless_range_loop)] // constant-trip loop over the MR rows
fn update_row_group(
    operands: &Operands<'_>,
    packed: &[f64],
    strips: usize,
    c_group: &mut [f64],
    first_row: usize,
    ks: &Range<usize>,
    js: &Range<usize>,
) {
    let cols = operands.cols;

    if c_group.len() < MR * cols {
        for (offset, c_row) in c_group.chunks_exact_mut(cols).enumerate() {
            let a_segment = operands.a_segment(first_row + offset, ks);
            operands.update_row_edge(a_segment, ks, c_row, js);
        }
        return;
    }

    let a_rows: [&[f64]; MR] = std::array::from_fn(|i| operands.a_segment(first_row + i, ks));
    let mut rows = c_group.chunks_exact_mut(cols);
    let mut c_rows: [&mut [f64]; MR] = std::array::from_fn(|_| rows.next().expect("a full group has MR rows"));

    let strip_len = ks.len() * NR;
    for s in 0..strips {
        let strip = &packed[s * strip_len..(s + 1) * strip_len];
        // The strip is a `depth × NR` tile of its own, so its row length is NR.
        micro_kernel(&a_rows, strip, NR, 0, ks.len(), &mut c_rows, js.start + s * NR);
    }

    let strips_end = js.start + strips * NR;
    for i in 0..MR {
        operands.update_row_edge(a_rows[i], ks, c_rows[i], &(strips_end..js.end));
    }
}

/// Accumulates the product of two dense tiles into a third: `C += A·B`.
///
/// Same contract and loop structure as
/// [`simd::accumulate_tile`](crate::simd): all three tiles are row-major and
/// contiguous, `cols` must be non-zero, and the function adds into `c`. The
/// difference is where the micro-kernel finds `B`. For each cache block, the
/// whole strips of `B` are first copied into one contiguous buffer ([`pack_strips`]),
/// then every group of `MR` rows of `C` multiplies against that copy.
///
/// The copy is paid once per cache block and used once per group of rows, so
/// it is cheap when the tile has many rows. A tile with fewer than `MR` rows
/// never reaches the micro-kernel, so it skips the copy.
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
    let uses_micro_kernel = c.len() / cols >= MR;
    let mut packed = Vec::new();

    for k_start in (0..depth).step_by(block.tile_k()) {
        let ks = k_start..(k_start + block.tile_k()).min(depth);

        for j_start in (0..cols).step_by(block.tile_j()) {
            let js = j_start..(j_start + block.tile_j()).min(cols);

            let strips = if uses_micro_kernel { js.len() / NR } else { 0 };
            pack_strips(b, cols, &ks, js.start, strips, &mut packed);

            for (group_index, c_group) in c.chunks_mut(MR * cols).enumerate() {
                update_row_group(&operands, &packed, strips, c_group, group_index * MR, &ks, &js);
            }
        }
    }
}

/// Accumulates the block of output rows starting at `first_row` into `c_block`.
fn multiply_row_block(a: &Matrix, b: &Matrix, first_row: usize, c_block: &mut [f64], block: &BlockConfig) {
    let n = a.cols();
    let p = b.cols();
    let rows = c_block.len() / p;
    let a_block = &a.as_slice()[first_row * n..(first_row + rows) * n];
    accumulate_tile(c_block, a_block, b.as_slice(), n, p, block);
}

/// Multiplies `a` by `b` on `threads` threads, with the register-blocked
/// kernel of level 3 reading `B` from packed, contiguous strips.
///
/// Work is divided exactly as in [`simd::matmul`](crate::simd::matmul): contiguous
/// blocks of output rows, one scoped thread per block. Each thread packs the
/// blocks of `B` it needs into its own buffer.
///
/// Results are bit-for-bit identical to [`naive::matmul`](crate::naive::matmul)
/// for any thread count and any target: packing moves values of `B`, it does not
/// change which products are added to an output element, or in what order.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use hardware_aware_matmul::{packed, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let c = packed::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), hardware_aware_matmul::DimensionMismatch>(())
/// ```
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, DimensionMismatch> {
    matmul_with_config(a, b, threads, &BlockConfig::default())
}

/// Like [`matmul`], with explicit cache-block sizes.
///
/// Results are bit-for-bit identical to [`matmul`] for every `block`.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use hardware_aware_matmul::cache_friendly::BlockConfig;
/// use hardware_aware_matmul::{packed, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let one = NonZeroUsize::new(1).unwrap();
/// let c = packed::matmul_with_config(&a, &b, one, &BlockConfig::new(one, one))?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), hardware_aware_matmul::DimensionMismatch>(())
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
    use crate::simd;

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
    fn pack_strips_lays_out_each_strip_k_by_k() {
        // A 3 x 2*NR + 1 block of B whose entries encode their own position.
        let (depth, cols) = (5, 2 * NR + 1);
        let b: Vec<f64> = (0..depth * cols).map(|x| x as f64).collect();
        let mut out = vec![-1.0; 3]; // stale contents must not survive
        pack_strips(&b, cols, &(1..4), 0, 2, &mut out);

        assert_eq!(out.len(), 2 * 3 * NR);
        for s in 0..2 {
            for k in 0..3 {
                for l in 0..NR {
                    let want = b[(1 + k) * cols + s * NR + l];
                    assert_eq!(out[(s * 3 + k) * NR + l], want, "strip {s}, k {k}, lane {l}");
                }
            }
        }
    }

    #[test]
    fn pack_strips_honours_the_column_offset() {
        let (depth, cols) = (2, 3 * NR);
        let b: Vec<f64> = (0..depth * cols).map(|x| x as f64).collect();
        let mut out = Vec::new();
        pack_strips(&b, cols, &(0..2), NR, 1, &mut out);
        let mut want = Vec::new();
        for k in 0..2 {
            for l in 0..NR {
                want.push(b[k * cols + NR + l]);
            }
        }
        assert_eq!(out, want);
    }

    #[test]
    fn accumulate_tile_matches_simd_around_every_edge() {
        // Packing must change where B is read from and nothing else, so the
        // packed tile is compared with the unpacked one on rough operands.
        let rough = |len: usize, seed: u64| -> Vec<f64> {
            (0..len)
                .map(|i| {
                    let x = (i as u64).wrapping_mul(6_364_136_223_846_793_005).wrapping_add(seed);
                    ((x >> 11) as f64 / (1_u64 << 53) as f64 - 0.5) * 2.0_f64.powi((x >> 60) as i32 - 8)
                })
                .collect()
        };
        let row_counts = [1, MR - 1, MR, MR + 1, 2 * MR + 3];
        let col_counts = [1, NR - 1, NR, NR + 1, TILE_J + NR + 1];
        let depths = [1, TILE_K + 3];
        for &rows in &row_counts {
            for &cols in &col_counts {
                for &depth in &depths {
                    let a = rough(rows * depth, 1);
                    let b = rough(depth * cols, 2);
                    let mut packed = vec![0.0; rows * cols];
                    let mut unpacked = vec![0.0; rows * cols];
                    accumulate_tile(&mut packed, &a, &b, depth, cols, &BlockConfig::default());
                    simd::accumulate_tile(&mut unpacked, &a, &b, depth, cols, &BlockConfig::default());
                    let bits = |v: &[f64]| v.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
                    assert_eq!(bits(&packed), bits(&unpacked), "rows={rows}, depth={depth}, cols={cols}");
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
        let mut zero = vec![0.0; rows * cols];
        accumulate_tile(&mut zero, &a, &b, depth, cols, &BlockConfig::default());
        for (got, product) in c.iter().zip(&zero) {
            assert_eq!(*got, 100.0 + product);
        }
    }

    #[test]
    fn small_product_at_several_thread_counts() {
        let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
        for t in 1..=4 {
            let c = matmul(&a, &b, NonZeroUsize::new(t).unwrap()).unwrap();
            assert_eq!(c.as_slice(), &[58.0, 64.0, 139.0, 154.0]);
        }
    }

    #[test]
    fn rejects_mismatched_dimensions() {
        let one = NonZeroUsize::new(2).unwrap();
        let err = matmul(&Matrix::zeros(2, 3), &Matrix::zeros(2, 3), one).unwrap_err();
        assert_eq!(err, DimensionMismatch { lhs: (2, 3), rhs: (2, 3) });
    }
}
