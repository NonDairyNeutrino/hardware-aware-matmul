//! File-backed matrices for out-of-core computation.
//!
//! A [`FileMatrix`] stores its elements on disk as raw little-endian `f64`
//! values in row-major order, with no header; the shape is supplied by the
//! caller. Tiles are read and written with positional I/O (`pread`/`pwrite`
//! on Unix, `seek_read`/`seek_write` on Windows), so many threads can access
//! one file concurrently without sharing a cursor or taking a lock.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;

use super::tile::{assert_tile_in_bounds, TileSink, TileSource};

/// Size in bytes of one stored element.
const ELEMENT_BYTES: usize = std::mem::size_of::<f64>();

#[cfg(unix)]
fn read_exact_at(file: &File, buf: &mut [u8], offset: u64) -> io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.read_exact_at(buf, offset)
}

#[cfg(unix)]
fn write_all_at(file: &File, buf: &[u8], offset: u64) -> io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.write_all_at(buf, offset)
}

#[cfg(windows)]
fn read_exact_at(file: &File, mut buf: &mut [u8], mut offset: u64) -> io::Result<()> {
    use std::os::windows::fs::FileExt;
    while !buf.is_empty() {
        let n = file.seek_read(buf, offset)?;
        if n == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        buf = &mut buf[n..];
        offset += n as u64;
    }
    Ok(())
}

#[cfg(windows)]
fn write_all_at(file: &File, mut buf: &[u8], mut offset: u64) -> io::Result<()> {
    use std::os::windows::fs::FileExt;
    while !buf.is_empty() {
        let n = file.seek_write(buf, offset)?;
        if n == 0 {
            return Err(io::ErrorKind::WriteZero.into());
        }
        buf = &buf[n..];
        offset += n as u64;
    }
    Ok(())
}

/// A dense row-major `f64` matrix stored in a file.
///
/// It implements both [`TileSource`] and [`TileSink`], so it can be an input
/// or the output of [`matmul_streaming`](crate::streaming::matmul_streaming). Only the
/// tiles currently being processed are ever held in memory.
#[derive(Debug)]
pub struct FileMatrix {
    file: File,
    rows: usize,
    cols: usize,
}

impl FileMatrix {
    /// Creates (or truncates) the file at `path` and sizes it for a
    /// `rows` × `cols` matrix. The contents are unspecified until written.
    pub fn create(path: impl AsRef<Path>, rows: usize, cols: usize) -> io::Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)?;
        file.set_len(byte_len(rows, cols))?;
        Ok(Self { file, rows, cols })
    }

    /// Opens an existing file as a `rows` × `cols` matrix.
    ///
    /// # Errors
    ///
    /// Returns [`io::ErrorKind::InvalidData`] if the file's length is not
    /// exactly `rows * cols * 8` bytes.
    pub fn open(path: impl AsRef<Path>, rows: usize, cols: usize) -> io::Result<Self> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        let actual = file.metadata()?.len();
        let expected = byte_len(rows, cols);
        if actual != expected {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("file is {actual} bytes but a {rows}x{cols} matrix needs {expected}"),
            ));
        }
        Ok(Self { file, rows, cols })
    }

    /// Fills the matrix by calling `f(i, j)` for every element, one row at a
    /// time, so only a single row is ever held in memory.
    pub fn fill_with(&self, mut f: impl FnMut(usize, usize) -> f64) -> io::Result<()> {
        let mut bytes = vec![0u8; self.cols * ELEMENT_BYTES];
        for i in 0..self.rows {
            for (j, chunk) in bytes.chunks_exact_mut(ELEMENT_BYTES).enumerate() {
                chunk.copy_from_slice(&f(i, j).to_le_bytes());
            }
            write_all_at(&self.file, &bytes, self.byte_offset(i, 0))?;
        }
        Ok(())
    }

    /// Returns the byte offset of element `(row, col)`.
    fn byte_offset(&self, row: usize, col: usize) -> u64 {
        (row as u64 * self.cols as u64 + col as u64) * ELEMENT_BYTES as u64
    }
}

/// Returns the file length in bytes of a `rows` × `cols` matrix.
fn byte_len(rows: usize, cols: usize) -> u64 {
    rows as u64 * cols as u64 * ELEMENT_BYTES as u64
}

impl TileSource for FileMatrix {
    fn shape(&self) -> (usize, usize) {
        (self.rows, self.cols)
    }

    fn read_tile(
        &self,
        row: usize,
        col: usize,
        rows: usize,
        cols: usize,
        buf: &mut [f64],
    ) -> io::Result<()> {
        assert_tile_in_bounds((self.rows, self.cols), row, col, rows, cols, buf.len());
        let mut bytes = vec![0u8; cols * ELEMENT_BYTES];
        for r in 0..rows {
            read_exact_at(&self.file, &mut bytes, self.byte_offset(row + r, col))?;
            let out = &mut buf[r * cols..(r + 1) * cols];
            for (value, chunk) in out.iter_mut().zip(bytes.chunks_exact(ELEMENT_BYTES)) {
                let raw = <[u8; ELEMENT_BYTES]>::try_from(chunk).expect("chunk has 8 bytes");
                *value = f64::from_le_bytes(raw);
            }
        }
        Ok(())
    }
}

impl TileSink for FileMatrix {
    fn shape(&self) -> (usize, usize) {
        (self.rows, self.cols)
    }

    fn write_tile(
        &self,
        row: usize,
        col: usize,
        rows: usize,
        cols: usize,
        tile: &[f64],
    ) -> io::Result<()> {
        assert_tile_in_bounds((self.rows, self.cols), row, col, rows, cols, tile.len());
        let mut bytes = vec![0u8; cols * ELEMENT_BYTES];
        for r in 0..rows {
            let values = &tile[r * cols..(r + 1) * cols];
            for (chunk, value) in bytes.chunks_exact_mut(ELEMENT_BYTES).zip(values) {
                chunk.copy_from_slice(&value.to_le_bytes());
            }
            write_all_at(&self.file, &bytes, self.byte_offset(row + r, col))?;
        }
        Ok(())
    }
}
