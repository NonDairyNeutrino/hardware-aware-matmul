//! Streaming, multithreaded matrix multiplication.
//!
//! # Algorithm
//!
//! The product `C = A·B` (`A` is `m × n`, `B` is `n × p`) is cut into a grid
//! of *output tiles*. Each output tile is computed independently by streaming
//! the operands past it:
//!
//! 1. zero a small accumulator tile of `C`;
//! 2. for each slice of the shared dimension, read the matching tile of `A`
//!    and tile of `B` from their sources, and fold their product into the
//!    accumulator (an online, running sum);
//! 3. write the finished tile to the sink and move on.
//!
//! At no point does a whole matrix need to be in memory. Each worker thread
//! holds exactly three tile buffers, so peak buffer memory is
//! `threads · (R·Q + R·D + D·Q)` elements for tile shape `R × Q × D`,
//! independent of `m`, `n`, and `p` (see [`StreamConfig::peak_buffer_bytes`]).
//!
//! # The memory/I/O trade-off
//!
//! Every element of `C` is written exactly once, but `A` is read
//! `⌈p / Q⌉` times and `B` is read `⌈m / R⌉` times. Larger tiles use more
//! memory and reread the inputs less often; smaller tiles do the opposite.
//!
//! # Parallelism
//!
//! Workers pull output-tile indices from a shared atomic counter, so load
//! balances itself and no two workers ever write the same tile.

use std::io;
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;

use super::kernel::accumulate_tile;
use super::tile::{MemorySink, TileSink, TileSource};
use crate::error::{check_inner_dimensions, MatmulError};
use crate::matrix::Matrix;

/// Tile size used when none is specified: 256 in every dimension, i.e.
/// 512 KiB per tile buffer.
const DEFAULT_TILE: usize = 256;

/// Tuning parameters for [`matmul_streaming`].
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::streaming::StreamConfig;
///
/// let config = StreamConfig::new(NonZeroUsize::new(4).unwrap())
///     .with_tile_shape(128, 128, 128);
/// // 4 threads * 3 buffers * 128*128 elements * 8 bytes
/// assert_eq!(config.peak_buffer_bytes(), 4 * 3 * 128 * 128 * 8);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamConfig {
    threads: NonZeroUsize,
    tile_rows: NonZeroUsize,
    tile_cols: NonZeroUsize,
    tile_depth: NonZeroUsize,
}

impl StreamConfig {
    /// Creates a configuration with `threads` workers and 256×256×256 tiles.
    pub fn new(threads: NonZeroUsize) -> Self {
        let tile = NonZeroUsize::new(DEFAULT_TILE).expect("default tile size is non-zero");
        Self {
            threads,
            tile_rows: tile,
            tile_cols: tile,
            tile_depth: tile,
        }
    }

    /// Sets the tile shape: `rows` and `cols` of each output tile, and
    /// `depth`, the slice of the shared dimension read per step.
    ///
    /// Tiles are clamped to the matrix dimensions, so oversized values are
    /// harmless.
    ///
    /// # Panics
    ///
    /// Panics if any argument is zero.
    pub fn with_tile_shape(mut self, rows: usize, cols: usize, depth: usize) -> Self {
        self.tile_rows = NonZeroUsize::new(rows).expect("tile rows must be non-zero");
        self.tile_cols = NonZeroUsize::new(cols).expect("tile cols must be non-zero");
        self.tile_depth = NonZeroUsize::new(depth).expect("tile depth must be non-zero");
        self
    }

    /// Returns the number of worker threads.
    pub fn threads(&self) -> usize {
        self.threads.get()
    }

    /// Returns the tile shape as `(rows, cols, depth)`.
    pub fn tile_shape(&self) -> (usize, usize, usize) {
        (
            self.tile_rows.get(),
            self.tile_cols.get(),
            self.tile_depth.get(),
        )
    }

    /// Returns an upper bound, in bytes, on the memory held in tile buffers
    /// during a multiplication.
    ///
    /// This is the quantity that stays constant as the matrices grow. It is an
    /// upper bound because tiles are clamped to the matrix dimensions. It does
    /// not include the sources and sink themselves, which for in-memory
    /// matrices are the matrices.
    pub fn peak_buffer_bytes(&self) -> usize {
        let (r, q, d) = self.tile_shape();
        self.threads() * (r * q + r * d + d * q) * std::mem::size_of::<f64>()
    }
}

/// The fully resolved geometry of one multiplication.
struct Plan {
    /// Rows of `A` and `C`.
    m: usize,
    /// Shared dimension: columns of `A`, rows of `B`.
    n: usize,
    /// Columns of `B` and `C`.
    p: usize,
    /// Tile shape, already clamped to the matrix dimensions.
    tile_rows: usize,
    tile_cols: usize,
    tile_depth: usize,
    /// Number of output tiles along a row of the tile grid.
    tiles_per_row: usize,
    /// Total number of output tiles.
    total_tiles: usize,
}

/// One worker's reusable tile buffers.
struct Buffers {
    a: Vec<f64>,
    b: Vec<f64>,
    c: Vec<f64>,
}

impl Buffers {
    fn new(plan: &Plan) -> Self {
        Self {
            a: vec![0.0; plan.tile_rows * plan.tile_depth],
            b: vec![0.0; plan.tile_depth * plan.tile_cols],
            c: vec![0.0; plan.tile_rows * plan.tile_cols],
        }
    }
}

/// Computes the output tile with index `tile_index`, streaming the matching
/// tiles of `a` and `b` through `buffers`, and writes it to `c`.
fn compute_output_tile<A, B, C>(
    a: &A,
    b: &B,
    c: &C,
    plan: &Plan,
    tile_index: usize,
    buffers: &mut Buffers,
) -> io::Result<()>
where
    A: TileSource + ?Sized,
    B: TileSource + ?Sized,
    C: TileSink + ?Sized,
{
    let row = (tile_index / plan.tiles_per_row) * plan.tile_rows;
    let col = (tile_index % plan.tiles_per_row) * plan.tile_cols;
    let rows = plan.tile_rows.min(plan.m - row);
    let cols = plan.tile_cols.min(plan.p - col);

    let c_tile = &mut buffers.c[..rows * cols];
    c_tile.fill(0.0);

    for depth_start in (0..plan.n).step_by(plan.tile_depth) {
        let depth = plan.tile_depth.min(plan.n - depth_start);

        let a_tile = &mut buffers.a[..rows * depth];
        a.read_tile(row, depth_start, rows, depth, a_tile)?;

        let b_tile = &mut buffers.b[..depth * cols];
        b.read_tile(depth_start, col, depth, cols, b_tile)?;

        accumulate_tile(c_tile, a_tile, b_tile, depth, cols);
    }

    c.write_tile(row, col, rows, cols, c_tile)
}

/// Body of one worker thread: claims output tiles until none remain or some
/// worker has failed.
fn run_worker<A, B, C>(
    a: &A,
    b: &B,
    c: &C,
    plan: &Plan,
    next_tile: &AtomicUsize,
    failed: &AtomicBool,
) -> io::Result<()>
where
    A: TileSource + ?Sized,
    B: TileSource + ?Sized,
    C: TileSink + ?Sized,
{
    let mut buffers = Buffers::new(plan);

    while !failed.load(Ordering::Relaxed) {
        let tile_index = next_tile.fetch_add(1, Ordering::Relaxed);
        if tile_index >= plan.total_tiles {
            break;
        }
        compute_output_tile(a, b, c, plan, tile_index, &mut buffers)?;
    }
    Ok(())
}

/// Multiplies `a` by `b`, streaming tiles from the sources and delivering the
/// product to the sink, without ever materialising a whole matrix.
///
/// See the [module documentation](self) for the algorithm and the
/// memory/I/O trade-off. The sink is overwritten tile by tile; its previous
/// contents are irrelevant.
///
/// # Errors
///
/// * [`MatmulError::DimensionMismatch`] if `a.cols != b.rows`.
/// * [`MatmulError::OutputShapeMismatch`] if the sink is not `a.rows × b.cols`.
/// * [`MatmulError::Io`] if any source or sink reports an error. Workers stop
///   claiming new tiles once one fails, and the first error observed is
///   returned; the sink may then be partially written.
///
/// # Panics
///
/// Propagates a panic from any worker thread.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::Matrix;
/// use naive_matmul::streaming::{matmul_streaming, MemorySink, StreamConfig};
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let sink = MemorySink::new(2, 2);
///
/// // Deliberately tiny tiles: 1x1 output tiles, two elements of depth per step.
/// let config = StreamConfig::new(NonZeroUsize::new(2).unwrap()).with_tile_shape(1, 1, 2);
/// matmul_streaming(&a, &b, &sink, &config)?;
///
/// assert_eq!(sink.into_matrix(), Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), naive_matmul::MatmulError>(())
/// ```
pub fn matmul_streaming<A, B, C>(
    a: &A,
    b: &B,
    c: &C,
    config: &StreamConfig,
) -> Result<(), MatmulError>
where
    A: TileSource + ?Sized,
    B: TileSource + ?Sized,
    C: TileSink + ?Sized,
{
    let (m, n, p) = check_inner_dimensions(a.shape(), b.shape())?;
    if c.shape() != (m, p) {
        return Err(MatmulError::OutputShapeMismatch {
            expected: (m, p),
            actual: c.shape(),
        });
    }
    if m == 0 || p == 0 {
        return Ok(()); // The product is empty; nothing to compute.
    }

    let (tile_rows, tile_cols, tile_depth) = config.tile_shape();
    let tile_rows = tile_rows.min(m);
    let tile_cols = tile_cols.min(p);
    let tile_depth = tile_depth.min(n).max(1); // `n` may be 0.
    let tiles_per_row = p.div_ceil(tile_cols);
    let total_tiles = m.div_ceil(tile_rows) * tiles_per_row;
    let plan = Plan {
        m,
        n,
        p,
        tile_rows,
        tile_cols,
        tile_depth,
        tiles_per_row,
        total_tiles,
    };

    let workers = config.threads().min(total_tiles);
    let next_tile = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);

    let first_error = thread::scope(|scope| {
        let mut handles = Vec::with_capacity(workers);
        for _ in 0..workers {
            handles.push(scope.spawn(|| {
                let result = run_worker(a, b, c, &plan, &next_tile, &failed);
                if result.is_err() {
                    failed.store(true, Ordering::Relaxed);
                }
                result
            }));
        }

        let mut first_error = None;
        for handle in handles {
            match handle.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
                Err(panic) => std::panic::resume_unwind(panic),
            }
        }
        first_error
    });

    match first_error {
        Some(error) => Err(MatmulError::Io(error)),
        None => Ok(()),
    }
}

/// Multiplies two in-memory matrices on `threads` threads.
///
/// A convenience wrapper over [`matmul_streaming`] with default tile sizes,
/// a [`Matrix`] source for each operand, and a [`MemorySink`] for the result.
/// Use [`matmul_streaming`] directly to control tile sizes or to work with
/// data that does not fit in memory.
///
/// # Errors
///
/// Returns [`MatmulError::DimensionMismatch`] if `a.cols() != b.rows()`.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::Matrix;
/// use naive_matmul::streaming::matmul;
///
/// let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
/// let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
/// let c = matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
/// assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
/// # Ok::<(), naive_matmul::MatmulError>(())
/// ```
pub fn matmul(a: &Matrix, b: &Matrix, threads: NonZeroUsize) -> Result<Matrix, MatmulError> {
    let (m, _, p) = check_inner_dimensions((a.rows(), a.cols()), (b.rows(), b.cols()))?;
    let sink = MemorySink::new(m, p);
    matmul_streaming(a, b, &sink, &StreamConfig::new(threads))?;
    Ok(sink.into_matrix())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nz(n: usize) -> NonZeroUsize {
        NonZeroUsize::new(n).unwrap()
    }

    #[test]
    fn config_defaults_and_buffer_bytes() {
        let config = StreamConfig::new(nz(2));
        assert_eq!(config.tile_shape(), (256, 256, 256));
        assert_eq!(config.peak_buffer_bytes(), 2 * 3 * 256 * 256 * 8);
    }

    #[test]
    #[should_panic(expected = "non-zero")]
    fn config_rejects_zero_tiles() {
        let _ = StreamConfig::new(nz(1)).with_tile_shape(0, 1, 1);
    }
}
