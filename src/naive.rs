#![doc = include_str!("../docs/levels/naive.md")]

use crate::error::{check_inner_dimensions, DimensionMismatch};
use crate::matrix::Matrix;

/// Multiplies `a` by `b` with the textbook triple loop, on a single thread.
///
/// Each element of the result is computed independently as the dot product of
/// a row of `a` with a column of `b`, accumulated in increasing `k` order
/// starting from zero. Every faster level in this crate produces exactly the
/// same bits, so this function is the reference the others are checked against.
///
/// # Errors
///
/// Returns [`DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use naive_matmul::{naive, Matrix};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let c = naive::matmul(&a, &b)?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), naive_matmul::DimensionMismatch>(())
/// ```
pub fn matmul(a: &Matrix, b: &Matrix) -> Result<Matrix, DimensionMismatch> {
    let (m, n, p) = check_inner_dimensions((a.rows(), a.cols()), (b.rows(), b.cols()))?;
    let mut c = Matrix::zeros(m, p);

    for i in 0..m {
        for j in 0..p {
            let mut sum = 0.0;
            for k in 0..n {
                sum += a[(i, k)] * b[(k, j)];
            }
            c[(i, j)] = sum;
        }
    }

    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_product() {
        let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
        let c = matmul(&a, &b).unwrap();
        assert_eq!(c.as_slice(), &[58.0, 64.0, 139.0, 154.0]);
    }

    #[test]
    fn identity_is_neutral() {
        let a = Matrix::from_fn(4, 4, |i, j| (i * 4 + j) as f64);
        let identity = Matrix::from_fn(4, 4, |i, j| if i == j { 1.0 } else { 0.0 });
        assert_eq!(matmul(&a, &identity).unwrap(), a);
    }

    #[test]
    fn zero_shared_dimension_gives_zeros() {
        let c = matmul(&Matrix::zeros(2, 0), &Matrix::zeros(0, 3)).unwrap();
        assert_eq!(c, Matrix::zeros(2, 3));
    }

    #[test]
    fn rejects_mismatched_dimensions() {
        let err = matmul(&Matrix::zeros(2, 3), &Matrix::zeros(2, 3)).unwrap_err();
        assert_eq!(err, DimensionMismatch { lhs: (2, 3), rhs: (2, 3) });
    }
}
