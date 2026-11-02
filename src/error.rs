//! Error types.

use std::fmt;
use std::io;

/// The inner dimensions of the operands disagree (`lhs.cols != rhs.rows`).
#[derive(Debug, PartialEq, Eq)]
pub struct DimensionMismatch {
    /// Shape of the left operand as `(rows, cols)`.
    pub lhs: (usize, usize),
    /// Shape of the right operand as `(rows, cols)`.
    pub rhs: (usize, usize),
}

/// Checks that an `a_shape × b_shape` product is defined and returns
/// `(m, n, p)`: the rows of `a`, the shared dimension, and the columns of `b`.
///
/// Every multiplication level starts with this check, before allocating
/// anything.
pub(crate) fn check_inner_dimensions(
    a_shape: (usize, usize),
    b_shape: (usize, usize),
) -> Result<(usize, usize, usize), DimensionMismatch> {
    if a_shape.1 != b_shape.0 {
        return Err(DimensionMismatch {
            lhs: a_shape,
            rhs: b_shape,
        });
    }
    Ok((a_shape.0, a_shape.1, b_shape.1))
}

impl fmt::Display for DimensionMismatch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "cannot multiply a {}x{} matrix by a {}x{} matrix",
            self.lhs.0, self.lhs.1, self.rhs.0, self.rhs.1
        )
    }
}

impl std::error::Error for DimensionMismatch {}

/// Error returned by the streaming multiplication
/// ([`matmul`](crate::streaming::matmul) and
/// [`matmul_streaming`](crate::streaming::matmul_streaming)).
///
/// The simpler levels ([`naive`](crate::naive), [`threaded`](crate::threaded),
/// [`cache_friendly`](crate::cache_friendly)) cannot fail in any way except a
/// dimension mismatch, so they return [`DimensionMismatch`] directly.
#[derive(Debug)]
pub enum MatmulError {
    /// The operands cannot be multiplied.
    DimensionMismatch(DimensionMismatch),
    /// The output sink does not have the shape of the product.
    OutputShapeMismatch {
        /// Shape of the product, `(a.rows, b.cols)`.
        expected: (usize, usize),
        /// Shape reported by the sink.
        actual: (usize, usize),
    },
    /// A [`TileSource`](crate::streaming::TileSource) or
    /// [`TileSink`](crate::streaming::TileSink)
    /// failed while reading or writing a tile.
    Io(io::Error),
}

impl fmt::Display for MatmulError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DimensionMismatch(e) => write!(f, "{e}"),
            Self::OutputShapeMismatch { expected, actual } => write!(
                f,
                "output is {}x{} but the product is {}x{}",
                actual.0, actual.1, expected.0, expected.1
            ),
            Self::Io(e) => write!(f, "I/O error while streaming a tile: {e}"),
        }
    }
}

impl std::error::Error for MatmulError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::DimensionMismatch(e) => Some(e),
            Self::OutputShapeMismatch { .. } => None,
            Self::Io(e) => Some(e),
        }
    }
}

impl From<DimensionMismatch> for MatmulError {
    fn from(e: DimensionMismatch) -> Self {
        Self::DimensionMismatch(e)
    }
}

impl From<io::Error> for MatmulError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_mentions_both_shapes() {
        let err = DimensionMismatch { lhs: (2, 3), rhs: (4, 5) };
        assert_eq!(err.to_string(), "cannot multiply a 2x3 matrix by a 4x5 matrix");
    }

    #[test]
    fn inner_dimension_check() {
        assert_eq!(check_inner_dimensions((2, 3), (3, 4)), Ok((2, 3, 4)));
        assert_eq!(
            check_inner_dimensions((2, 3), (4, 4)),
            Err(DimensionMismatch { lhs: (2, 3), rhs: (4, 4) })
        );
    }

    #[test]
    fn io_errors_convert() {
        let err: MatmulError = io::Error::new(io::ErrorKind::Other, "boom").into();
        assert!(matches!(err, MatmulError::Io(_)));
        assert!(err.to_string().contains("boom"));
    }
}
