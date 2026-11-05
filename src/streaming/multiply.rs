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
use std::ops::Range;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use super::kernel::accumulate_tile;
use super::tile::{MemorySink, TileSink, TileSource};
use crate::cache_friendly::BlockConfig;
use crate::error::{check_inner_dimensions, MatmulError};
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};

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
    block: BlockConfig,
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
            block: BlockConfig::default(),
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

    /// Sets the cache-block sizes used by the kernel inside each tile.
    ///
    /// They are independent of the tile shape: the tile shape decides how much
    /// data each worker holds, the cache blocks decide how the kernel walks it.
    /// Results are bit-for-bit identical for every choice.
    ///
    /// # Examples
    ///
    /// ```
    /// use std::num::NonZeroUsize;
    /// use naive_matmul::cache_friendly::BlockConfig;
    /// use naive_matmul::streaming::StreamConfig;
    ///
    /// let one = NonZeroUsize::new(1).unwrap();
    /// let block = BlockConfig::new(NonZeroUsize::new(8).unwrap(), NonZeroUsize::new(16).unwrap());
    /// let config = StreamConfig::new(one).with_block_config(block);
    /// assert_eq!(config.block_config(), block);
    /// ```
    pub fn with_block_config(mut self, block: BlockConfig) -> Self {
        self.block = block;
        self
    }

    /// Returns the cache-block sizes used by the kernel inside each tile.
    pub fn block_config(&self) -> BlockConfig {
        self.block
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
    /// Cache-block sizes for the kernel.
    block: BlockConfig,
}

impl Plan {
    /// Resolves the geometry of an `m × n` by `n × p` product. `m` and `p`
    /// must be non-zero.
    fn new(m: usize, n: usize, p: usize, config: &StreamConfig) -> Self {
        let (tile_rows, tile_cols, tile_depth) = config.tile_shape();
        let tile_rows = tile_rows.min(m);
        let tile_cols = tile_cols.min(p);
        let tile_depth = tile_depth.min(n).max(1); // `n` may be 0.
        let tiles_per_row = p.div_ceil(tile_cols);
        let total_tiles = m.div_ceil(tile_rows) * tiles_per_row;
        Self {
            m,
            n,
            p,
            tile_rows,
            tile_cols,
            tile_depth,
            tiles_per_row,
            total_tiles,
            block: config.block_config(),
        }
    }

    /// Returns the rows and columns covered by output tile `tile_index`.
    ///
    /// Tiles are numbered row-major over the grid, and `tile_index` must be
    /// below `total_tiles`.
    fn tile(&self, tile_index: usize) -> OutputTile {
        let row = (tile_index / self.tiles_per_row) * self.tile_rows;
        let col = (tile_index % self.tiles_per_row) * self.tile_cols;
        OutputTile {
            rows: row..(row + self.tile_rows).min(self.m),
            cols: col..(col + self.tile_cols).min(self.p),
        }
    }

    /// Returns the slices of the shared dimension streamed past each tile.
    fn depth_slices(&self) -> impl Iterator<Item = Range<usize>> + '_ {
        (0..self.n)
            .step_by(self.tile_depth)
            .map(|start| start..(start + self.tile_depth).min(self.n))
    }
}

/// One output tile of the grid that [`matmul_streaming`] works through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputTile {
    /// The rows of `C` (and of `A`) the tile covers.
    pub rows: Range<usize>,
    /// The columns of `C` (and of `B`) the tile covers.
    pub cols: Range<usize>,
}

/// The geometry of a streaming multiplication: which tiles exist and which
/// slices of the shared dimension are streamed past each one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilePlan {
    /// The output tiles, numbered row-major over the grid. Workers claim them
    /// in this order from a shared counter, so which worker computes which tile
    /// is decided at run time and is not part of the plan.
    pub tiles: Vec<OutputTile>,
    /// The slices of the shared dimension read for every tile, in order.
    pub depth_slices: Vec<Range<usize>>,
}

/// Describes how [`matmul_streaming`] would tile an `m × n` by `n × p`
/// product under `config`, without multiplying anything.
///
/// It is built from the same code the multiplication uses, so it is exactly
/// the tiling that will run. An empty product (`m` or `p` zero) has no tiles
/// and no depth slices, and `n == 0` has tiles but no depth slices.
///
/// It allocates one [`OutputTile`] per tile, so keep the tile count (about
/// `ceil(m / tile_rows) * ceil(p / tile_cols)`) modest.
///
/// # Examples
///
/// ```
/// use std::num::NonZeroUsize;
/// use naive_matmul::streaming::{tile_plan, StreamConfig};
///
/// let config = StreamConfig::new(NonZeroUsize::new(2).unwrap()).with_tile_shape(2, 3, 4);
/// let plan = tile_plan(4, 6, 6, &config);
/// assert_eq!(plan.tiles.len(), 4); // a 2 x 2 grid of 2 x 3 tiles
/// assert_eq!(plan.depth_slices, vec![0..4, 4..6]);
/// ```
pub fn tile_plan(m: usize, n: usize, p: usize, config: &StreamConfig) -> TilePlan {
    if m == 0 || p == 0 {
        return TilePlan {
            tiles: Vec::new(),
            depth_slices: Vec::new(),
        };
    }
    let plan = Plan::new(m, n, p, config);
    TilePlan {
        tiles: (0..plan.total_tiles).map(|index| plan.tile(index)).collect(),
        depth_slices: plan.depth_slices().collect(),
    }
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
    let tile = plan.tile(tile_index);
    let (row, col) = (tile.rows.start, tile.cols.start);
    let (rows, cols) = (tile.rows.len(), tile.cols.len());

    let c_tile = &mut buffers.c[..rows * cols];
    c_tile.fill(0.0);

    for slice in plan.depth_slices() {
        let (depth_start, depth) = (slice.start, slice.len());

        let a_tile = &mut buffers.a[..rows * depth];
        a.read_tile(row, depth_start, rows, depth, a_tile)?;

        let b_tile = &mut buffers.b[..depth * cols];
        b.read_tile(depth_start, col, depth, cols, b_tile)?;

        accumulate_tile(c_tile, a_tile, b_tile, depth, cols, &plan.block);
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
    matmul_streaming_with_runner(a, b, c, config, &StdRunner)
}

/// Like [`matmul_streaming`], with the workers executed by `runner`.
///
/// The runner receives one job per worker: at most `config.threads()` of them,
/// fewer when there are fewer output tiles, and none for an empty product. Each
/// job claims output tiles from a shared counter until none remain, so a runner
/// that runs its jobs one after another simply lets the first job claim every
/// tile. Results are bit-for-bit identical for every runner.
///
/// # Errors
///
/// The same as [`matmul_streaming`]: the first I/O error observed is returned.
///
/// # Panics
///
/// A panic in a source or sink reaches the caller as the runner decides: with
/// [`StdRunner`] it is a panic from this function.
pub fn matmul_streaming_with_runner<A, B, C, R>(
    a: &A,
    b: &B,
    c: &C,
    config: &StreamConfig,
    runner: &R,
) -> Result<(), MatmulError>
where
    A: TileSource + ?Sized,
    B: TileSource + ?Sized,
    C: TileSink + ?Sized,
    R: Runner + ?Sized,
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

    let plan = Plan::new(m, n, p, config);

    let workers = config.threads().min(plan.total_tiles);
    let next_tile = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);

    // One job per worker. The first error any worker hits is kept for the caller.
    let first_error: Mutex<Option<io::Error>> = Mutex::new(None);
    let jobs: Vec<Box<dyn FnOnce() + Send + '_>> = (0..workers)
        .map(|_| {
            let (plan, next_tile, failed, first_error) = (&plan, &next_tile, &failed, &first_error);
            Box::new(move || {
                if let Err(error) = run_worker(a, b, c, plan, next_tile, failed) {
                    failed.store(true, Ordering::Relaxed);
                    let mut slot = first_error.lock().expect("no code panics while holding this lock");
                    if slot.is_none() {
                        *slot = Some(error);
                    }
                }
            }) as Box<dyn FnOnce() + Send + '_>
        })
        .collect();
    runner.run(jobs);

    match first_error.into_inner().expect("no code panics while holding this lock") {
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
        assert_eq!(config.block_config(), BlockConfig::default());
        assert_eq!(config.peak_buffer_bytes(), 2 * 3 * 256 * 256 * 8);
    }

    #[test]
    fn tile_plan_numbers_tiles_row_major() {
        let config = StreamConfig::new(nz(1)).with_tile_shape(2, 3, 5);
        let plan = tile_plan(4, 5, 6, &config);
        let tile = |rows, cols| OutputTile { rows, cols };
        assert_eq!(
            plan.tiles,
            vec![tile(0..2, 0..3), tile(0..2, 3..6), tile(2..4, 0..3), tile(2..4, 3..6)]
        );
        assert_eq!(plan.depth_slices, vec![0..5]);
    }

    #[test]
    fn tile_plan_clamps_edge_tiles_and_depth_slices() {
        let config = StreamConfig::new(nz(1)).with_tile_shape(4, 4, 3);
        let plan = tile_plan(5, 7, 5, &config);
        assert_eq!(plan.tiles.len(), 4);
        assert_eq!(plan.tiles[3], OutputTile { rows: 4..5, cols: 4..5 });
        assert_eq!(plan.depth_slices, vec![0..3, 3..6, 6..7]);
    }

    #[test]
    fn tile_plan_covers_every_output_element_exactly_once() {
        let shapes = [(5, 7, 9, (2, 4, 3)), (1, 1, 1, (256, 256, 256)), (10, 10, 10, (10, 10, 10)), (7, 0, 5, (3, 3, 3))];
        for (m, n, p, (r, q, d)) in shapes {
            let config = StreamConfig::new(nz(2)).with_tile_shape(r, q, d);
            let plan = tile_plan(m, n, p, &config);
            let mut seen = vec![0_u8; m * p];
            for tile in &plan.tiles {
                for i in tile.rows.clone() {
                    for j in tile.cols.clone() {
                        seen[i * p + j] += 1;
                    }
                }
            }
            assert!(seen.iter().all(|&count| count == 1), "{m}x{n}x{p}");
            let depth: usize = plan.depth_slices.iter().map(|slice| slice.len()).sum();
            assert_eq!(depth, n, "{m}x{n}x{p}");
        }
    }

    #[test]
    fn tile_plan_of_an_empty_product_has_no_tiles() {
        let config = StreamConfig::new(nz(1));
        assert!(tile_plan(0, 3, 4, &config).tiles.is_empty());
        assert!(tile_plan(4, 3, 0, &config).tiles.is_empty());
    }

    #[test]
    #[should_panic(expected = "non-zero")]
    fn config_rejects_zero_tiles() {
        let _ = StreamConfig::new(nz(1)).with_tile_shape(0, 1, 1);
    }
}
