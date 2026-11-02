//! Tile-granular data movement: the abstractions that let the multiply
//! algorithm stream its inputs and outputs instead of holding whole matrices.
//!
//! A [`TileSource`] hands out rectangular sub-blocks ("tiles") of a matrix on
//! request, and a [`TileSink`] accepts finished tiles of the result. The
//! multiply algorithm only ever talks to these traits, so the same code works
//! on in-memory matrices ([`Matrix`], [`MemorySink`]) and on matrices that live
//! on disk (`FileMatrix`, available on Unix and Windows).

use std::io;
use std::sync::{Mutex, PoisonError};

use crate::matrix::Matrix;

/// A read-only matrix that can deliver rectangular tiles on demand.
///
/// Implementations must be [`Sync`]: several worker threads read different
/// tiles concurrently through a shared reference.
pub trait TileSource: Sync {
    /// Returns the shape of the matrix as `(rows, cols)`.
    fn shape(&self) -> (usize, usize);

    /// Copies the `rows` × `cols` tile whose top-left corner is `(row, col)`
    /// into `buf`, in row-major order.
    ///
    /// # Panics
    ///
    /// Implementations should panic if the tile lies outside the matrix or
    /// `buf.len() != rows * cols`; the multiply algorithm never requests such
    /// a tile.
    fn read_tile(
        &self,
        row: usize,
        col: usize,
        rows: usize,
        cols: usize,
        buf: &mut [f64],
    ) -> io::Result<()>;
}

/// A write-only matrix that accepts finished tiles of the result.
///
/// Implementations must be [`Sync`]: several worker threads write different
/// tiles concurrently through a shared reference. The tiles written during one
/// multiplication never overlap.
pub trait TileSink: Sync {
    /// Returns the shape of the matrix as `(rows, cols)`.
    fn shape(&self) -> (usize, usize);

    /// Stores the row-major `rows` × `cols` `tile` with its top-left corner at
    /// `(row, col)`.
    ///
    /// # Panics
    ///
    /// Implementations should panic if the tile lies outside the matrix or
    /// `tile.len() != rows * cols`.
    fn write_tile(
        &self,
        row: usize,
        col: usize,
        rows: usize,
        cols: usize,
        tile: &[f64],
    ) -> io::Result<()>;
}

/// Panics unless a `rows` × `cols` tile at `(row, col)` fits in a matrix of
/// `shape`, and a buffer of length `len` holds exactly that many elements.
pub(crate) fn assert_tile_in_bounds(
    shape: (usize, usize),
    row: usize,
    col: usize,
    rows: usize,
    cols: usize,
    len: usize,
) {
    let fits_rows = row.checked_add(rows).is_some_and(|end| end <= shape.0);
    let fits_cols = col.checked_add(cols).is_some_and(|end| end <= shape.1);
    assert!(
        fits_rows && fits_cols,
        "{rows}x{cols} tile at ({row}, {col}) is out of bounds for a {}x{} matrix",
        shape.0,
        shape.1
    );
    assert_eq!(len, rows * cols, "tile buffer length must equal rows * cols");
}

impl TileSource for Matrix {
    fn shape(&self) -> (usize, usize) {
        (self.rows(), self.cols())
    }

    fn read_tile(
        &self,
        row: usize,
        col: usize,
        rows: usize,
        cols: usize,
        buf: &mut [f64],
    ) -> io::Result<()> {
        assert_tile_in_bounds(self.shape(), row, col, rows, cols, buf.len());
        for r in 0..rows {
            let source = &self.row(row + r)[col..col + cols];
            buf[r * cols..(r + 1) * cols].copy_from_slice(source);
        }
        Ok(())
    }
}

/// An in-memory [`TileSink`] that assembles the result into a [`Matrix`].
///
/// Tile writes are serialised by an internal lock. They are short copies
/// compared with the arithmetic that produced the tile, so contention is low.
#[derive(Debug)]
pub struct MemorySink {
    shape: (usize, usize),
    matrix: Mutex<Matrix>,
}

impl MemorySink {
    /// Creates a sink backed by a zero-filled `rows` × `cols` matrix.
    pub fn new(rows: usize, cols: usize) -> Self {
        Self {
            shape: (rows, cols),
            matrix: Mutex::new(Matrix::zeros(rows, cols)),
        }
    }

    /// Consumes the sink and returns the assembled matrix.
    pub fn into_matrix(self) -> Matrix {
        self.matrix
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

impl TileSink for MemorySink {
    fn shape(&self) -> (usize, usize) {
        self.shape
    }

    fn write_tile(
        &self,
        row: usize,
        col: usize,
        rows: usize,
        cols: usize,
        tile: &[f64],
    ) -> io::Result<()> {
        assert_tile_in_bounds(self.shape, row, col, rows, cols, tile.len());
        let mut matrix = self.matrix.lock().unwrap_or_else(PoisonError::into_inner);
        let data = matrix.as_mut_slice();
        for r in 0..rows {
            let start = (row + r) * self.shape.1 + col;
            data[start..start + cols].copy_from_slice(&tile[r * cols..(r + 1) * cols]);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix_source_reads_a_sub_tile() {
        let m = Matrix::from_fn(4, 5, |i, j| (10 * i + j) as f64);
        let mut buf = [0.0; 4];
        m.read_tile(1, 2, 2, 2, &mut buf).unwrap();
        assert_eq!(buf, [12.0, 13.0, 22.0, 23.0]);
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn matrix_source_rejects_out_of_bounds_tiles() {
        let m = Matrix::zeros(2, 2);
        let mut buf = [0.0; 4];
        m.read_tile(1, 1, 2, 2, &mut buf).unwrap();
    }

    #[test]
    fn memory_sink_places_tiles() {
        let sink = MemorySink::new(3, 3);
        sink.write_tile(1, 1, 2, 2, &[1.0, 2.0, 3.0, 4.0]).unwrap();
        let m = sink.into_matrix();
        assert_eq!(m.as_slice(), &[0.0, 0.0, 0.0, 0.0, 1.0, 2.0, 0.0, 3.0, 4.0]);
    }
}
