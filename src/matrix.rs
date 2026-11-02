//! A dense, row-major matrix of `f64`.

use std::ops::{Index, IndexMut};

/// A dense, row-major matrix of `f64`.
///
/// Elements are stored contiguously in a single `Vec<f64>`, with row `i`
/// occupying `data[i * cols .. (i + 1) * cols]`. Individual elements are
/// accessed with `m[(row, col)]`.
#[derive(Debug, Clone, PartialEq)]
pub struct Matrix {
    rows: usize,
    cols: usize,
    data: Vec<f64>,
}

impl Matrix {
    /// Builds a matrix from row-major `data`.
    ///
    /// # Panics
    ///
    /// Panics if `data.len() != rows * cols`.
    ///
    /// # Examples
    ///
    /// ```
    /// use naive_matmul::Matrix;
    ///
    /// // | 1 2 3 |
    /// // | 4 5 6 |
    /// let m = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    /// assert_eq!(m[(1, 0)], 4.0);
    /// ```
    pub fn new(rows: usize, cols: usize, data: Vec<f64>) -> Self {
        assert_eq!(data.len(), rows * cols, "data length must equal rows * cols");
        Self { rows, cols, data }
    }

    /// Creates a `rows` × `cols` matrix filled with zeros.
    pub fn zeros(rows: usize, cols: usize) -> Self {
        Self::new(rows, cols, vec![0.0; rows * cols])
    }

    /// Creates a `rows` × `cols` matrix whose `(i, j)` element is `f(i, j)`.
    ///
    /// `f` is called exactly once per element, in row-major order.
    ///
    /// # Examples
    ///
    /// ```
    /// use naive_matmul::Matrix;
    ///
    /// let identity = Matrix::from_fn(3, 3, |i, j| if i == j { 1.0 } else { 0.0 });
    /// assert_eq!(identity[(2, 2)], 1.0);
    /// assert_eq!(identity[(0, 2)], 0.0);
    /// ```
    pub fn from_fn(rows: usize, cols: usize, mut f: impl FnMut(usize, usize) -> f64) -> Self {
        let mut data = Vec::with_capacity(rows * cols);
        for i in 0..rows {
            for j in 0..cols {
                data.push(f(i, j));
            }
        }
        Self::new(rows, cols, data)
    }

    /// Returns the number of rows.
    pub fn rows(&self) -> usize {
        self.rows
    }

    /// Returns the number of columns.
    pub fn cols(&self) -> usize {
        self.cols
    }

    /// Returns row `i` as a contiguous slice of length `self.cols()`.
    ///
    /// # Panics
    ///
    /// Panics if `i >= self.rows()`.
    pub fn row(&self, i: usize) -> &[f64] {
        &self.data[i * self.cols..(i + 1) * self.cols]
    }

    /// Returns all elements as a row-major slice of length `rows * cols`.
    pub fn as_slice(&self) -> &[f64] {
        &self.data
    }

    /// Returns all elements as a mutable row-major slice of length `rows * cols`.
    pub fn as_mut_slice(&mut self) -> &mut [f64] {
        &mut self.data
    }
}

impl Index<(usize, usize)> for Matrix {
    type Output = f64;

    /// Returns the element at `(row, col)`.
    ///
    /// # Panics
    ///
    /// Panics if the index is out of bounds.
    fn index(&self, (i, j): (usize, usize)) -> &f64 {
        assert!(i < self.rows && j < self.cols, "matrix index out of bounds");
        &self.data[i * self.cols + j]
    }
}

impl IndexMut<(usize, usize)> for Matrix {
    /// Returns a mutable reference to the element at `(row, col)`.
    ///
    /// # Panics
    ///
    /// Panics if the index is out of bounds.
    fn index_mut(&mut self, (i, j): (usize, usize)) -> &mut f64 {
        assert!(i < self.rows && j < self.cols, "matrix index out of bounds");
        &mut self.data[i * self.cols + j]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_fn_is_row_major() {
        let m = Matrix::from_fn(2, 3, |i, j| (10 * i + j) as f64);
        assert_eq!(m.as_slice(), &[0.0, 1.0, 2.0, 10.0, 11.0, 12.0]);
        assert_eq!(m.row(1), &[10.0, 11.0, 12.0]);
    }

    #[test]
    fn index_mut_writes_the_right_element() {
        let mut m = Matrix::zeros(2, 3);
        m[(1, 2)] = 7.0;
        assert_eq!(m.as_slice(), &[0.0, 0.0, 0.0, 0.0, 0.0, 7.0]);
    }

    #[test]
    #[should_panic(expected = "data length must equal rows * cols")]
    fn new_rejects_wrong_length() {
        let _ = Matrix::new(2, 2, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn index_rejects_out_of_range_column() {
        let m = Matrix::zeros(2, 2);
        let _ = m[(0, 2)];
    }
}
