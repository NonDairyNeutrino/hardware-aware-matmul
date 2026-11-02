//! Compute kernel that operates on tiles already resident in memory.
//!
//! Nothing here knows about threads, files, or the size of the full matrices.
//! This is the level-2 kernel ([`cache_friendly`](crate::cache_friendly)) with
//! one difference: it works on three flat, contiguous tile buffers instead of
//! on whole `Matrix` values. It reuses level 2's `axpy` inner loop and its
//! cache-block constants unchanged.
//!
//! For every output element the terms are summed in increasing `k` order, so
//! results are bit-for-bit identical to a textbook `i-j-k` loop.

use crate::cache_friendly::{axpy, TILE_J, TILE_K};

/// Accumulates the product of two dense tiles into a third: `C += A·B`.
///
/// All three tiles are row-major and contiguous:
///
/// * `a` is `rows × depth`,
/// * `b` is `depth × cols`,
/// * `c` is `rows × cols`, where `rows = c.len() / cols`.
///
/// `cols` and `depth` must be non-zero. The kernel adds into `c`, so the
/// caller zero-initialises it before the first call to obtain a plain product
/// and may call it repeatedly with successive slices of the shared dimension
/// to build up a full product.
pub(crate) fn accumulate_tile(c: &mut [f64], a: &[f64], b: &[f64], depth: usize, cols: usize) {
    debug_assert_eq!(c.len() % cols, 0);
    debug_assert_eq!(a.len(), c.len() / cols * depth);
    debug_assert_eq!(b.len(), depth * cols);

    for k_start in (0..depth).step_by(TILE_K) {
        let k_end = (k_start + TILE_K).min(depth);

        for j_start in (0..cols).step_by(TILE_J) {
            let j_end = (j_start + TILE_J).min(cols);

            for (i, c_row) in c.chunks_exact_mut(cols).enumerate() {
                let a_segment = &a[i * depth + k_start..i * depth + k_end];
                let c_segment = &mut c_row[j_start..j_end];

                for (k_offset, &a_ik) in a_segment.iter().enumerate() {
                    let b_row_start = (k_start + k_offset) * cols;
                    let b_segment = &b[b_row_start + j_start..b_row_start + j_end];
                    axpy(a_ik, b_segment, c_segment);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulate_tile_computes_a_small_product() {
        // | 1 2 3 |   | 7  8  |   | 58  64  |
        // | 4 5 6 | x | 9  10 | = | 139 154 |
        //             | 11 12 |
        let a = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let b = [7.0, 8.0, 9.0, 10.0, 11.0, 12.0];
        let mut c = [0.0; 4];
        accumulate_tile(&mut c, &a, &b, 3, 2);
        assert_eq!(c, [58.0, 64.0, 139.0, 154.0]);
    }

    #[test]
    fn accumulate_tile_adds_to_existing_values() {
        let mut c = [100.0];
        accumulate_tile(&mut c, &[1.0, 2.0], &[3.0, 4.0], 2, 1);
        assert_eq!(c, [111.0]);
    }
}
