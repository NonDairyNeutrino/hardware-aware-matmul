**Level 3 of 3.** Everything from level 2, plus **bounded memory**: the
matrices no longer have to be in memory at all. The product is computed one
small output tile at a time, by streaming the matching tiles of the inputs
past a running accumulator and handing each finished tile to an output sink.

This is the only level that is not about speed on data that already fits in
RAM. It is what makes the problem *possible* when it does not.

# The problem

Levels 0 to 2 need `A`, `B`, and `C` resident at once: `3·n²·8` bytes for
`n × n` matrices. At `n = 100 000` each matrix is 80 GB and the three together
are 240 GB. The arithmetic is not the obstacle; the memory is.

# The idea

Level 1 observed that rows of `C` are independent. The same is true of any
rectangular block ("tile") of `C`: it depends only on a horizontal strip of `A`
and a vertical strip of `B`.

```text
        B  (n × p)
        ┌───────────┐
        │     ║     │
        │     ║ B strip
        │     ║     │
        └───────────┘
 A (m×n)               C (m×p)
┌─────────────┐      ┌───────────┐
│             │      │           │
│═════════════│  →   │     ▓     │   ← one output tile
│  A strip    │      │           │
└─────────────┘      └───────────┘
```

So never compute "the product". Compute one output tile at a time. The strips
are themselves too big to hold, so split the shared dimension `n` into slices
of depth `D` and *stream* them through three small buffers, adding each partial
product into a running sum. That makes it an **online algorithm**: it consumes
its input incrementally and never needs it all at once.

# What changed from level 2

| | [`cache_friendly`](crate::cache_friendly) (2) | `streaming` (3) |
|---|---|---|
| Unit of work | a block of rows (the whole width) | a tile of `R × Q` of the output |
| Where operands come from | `&Matrix` in memory | any [`TileSource`] (memory, file, generated) |
| Where results go | a `Matrix` returned to the caller | any [`TileSink`] (memory, file, a reduction) |
| Memory | `A`, `B`, `C` entire | three tile buffers per thread |
| Work distribution | fixed equal row blocks | **dynamic**: workers claim tiles from an atomic counter |
| Inner kernel | `i-k-j` + cache blocks, on `Matrix` | the *same* kernel, on flat tile buffers |
| Errors | dimension mismatch only | plus I/O errors from sources and sinks |

The inner loop is deliberately not new: level 2's `axpy`, its `i-k-j` loop
order, and its cache-block constants are reused unchanged. Level 3 adds a
layer *around* the level-2 kernel, not a replacement for it.

# The algorithm

```text
PROCEDURE matmul_streaming(A, B, C, config)
    (m, n)  ← A.shape();  (n2, p) ← B.shape()
    IF n ≠ n2                 THEN RETURN Error(DimensionMismatch)
    IF C.shape() ≠ (m, p)     THEN RETURN Error(OutputShapeMismatch)
    IF m = 0 OR p = 0         THEN RETURN OK

    R ← MIN(config.tile_rows, m);  Q ← MIN(config.tile_cols, p)
    D ← MAX(1, MIN(config.tile_depth, n))
    tiles_per_row ← CEIL(p / Q)
    total_tiles   ← CEIL(m / R) × tiles_per_row
    workers       ← MIN(config.threads, total_tiles)

    next_tile ← AtomicCounter(0);  failed ← AtomicFlag(false)
    SPAWN `workers` threads running run_worker(...); JOIN them
    re-raise any panic; RETURN the first error, or OK


PROCEDURE run_worker(A, B, C, plan, next_tile, failed)
    a_buf ← R×D numbers;  b_buf ← D×Q numbers;  c_buf ← R×Q numbers
    WHILE NOT failed:
        t ← next_tile.fetch_and_add(1)
        IF t ≥ total_tiles THEN BREAK
        compute_output_tile(A, B, C, plan, t, a_buf, b_buf, c_buf)
    RETURN OK


PROCEDURE compute_output_tile(A, B, C, plan, t, a_buf, b_buf, c_buf)
    row  ← (t DIV tiles_per_row) × R;   col  ← (t MOD tiles_per_row) × Q
    rows ← MIN(R, m − row);             cols ← MIN(Q, p − col)

    c_tile ← first rows×cols elements of c_buf;  SET c_tile to 0
    FOR depth_start FROM 0 TO n−1 STEP D:
        depth  ← MIN(D, n − depth_start)
        A.read_tile(row, depth_start, rows, depth, INTO a_buf)
        B.read_tile(depth_start, col, depth, cols, INTO b_buf)
        accumulate_tile(c_tile, a_buf, b_buf, depth, cols)    // C += A·B
    C.write_tile(row, col, rows, cols, FROM c_tile)
```

`accumulate_tile` is the level-2 kernel (`i-k-j` with cache blocks, built on
`axpy`), applied to the three flat buffers.

# Data flow for one output tile

```text
   TileSource A                                      TileSink C
   ┌─────────┐                                       ┌─────────┐
   │ A strip │──read_tile──►  a_buf (R×D) ──┐        │         │
   └─────────┘                              ├─► accumulate_tile
   TileSource B                             │        │   ▲     │
   ┌─────────┐                              │   c_buf (R×Q)    │
   │ B strip │──read_tile──►  b_buf (D×Q) ──┘        │   │     │
   └─────────┘      repeat for each depth slice      │   └─write_tile (once)
                                                     └─────────┘
```

`c_buf` is zeroed at the start of a tile, accumulates across all depth slices,
and is written once at the end. All three buffers are then reused for the next
tile the same worker claims.

# Memory

Each worker owns exactly three buffers, so

```text
peak buffer bytes  =  threads × (R·Q + R·D + D·Q) × 8
```

independent of `m`, `n`, and `p`. [`StreamConfig::peak_buffer_bytes`] reports
it before you start. The price is rereading: every element of `C` is written
once, but `A` is read `⌈p/Q⌉` times and `B` is read `⌈m/R⌉` times. The whole
trade-off is derived in the [cost model](crate::design::cost_model) and
explained practically in [tuning](crate::guide::tuning).

# Example

In-memory matrices, with deliberately tiny tiles so that the streaming is
visible: four 1×1 output tiles, each built from two depth slices.

```rust
use std::num::NonZeroUsize;
use naive_matmul::Matrix;
use naive_matmul::streaming::{matmul_streaming, MemorySink, StreamConfig};

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let sink = MemorySink::new(2, 2);

let config = StreamConfig::new(NonZeroUsize::new(2).unwrap()).with_tile_shape(1, 1, 2);
matmul_streaming(&a, &b, &sink, &config)?;

assert_eq!(sink.into_matrix(), Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
# Ok::<(), naive_matmul::MatmulError>(())
```

For matrices on disk, see [Streaming from and to disk](crate::guide::out_of_core).
For your own data sources, see [Custom sources and sinks](crate::guide::custom_io).

# Edge cases

| Case                          | Behaviour                                                   |
|-------------------------------|-------------------------------------------------------------|
| `m = 0` or `p = 0`            | Returns immediately; nothing to compute or write.           |
| `n = 0`                       | Every output tile is zeros (the empty sum); written as such.|
| Tile larger than the matrix   | Clamped; one tile covers the whole dimension.               |
| Dimensions not divisible by tile | Edge tiles are smaller; buffers use only the needed prefix.|
| More threads than tiles       | Only as many workers as tiles are spawned.                  |

# Why it is correct

Fix an output element `C[i][j]` and let `t` be the tile containing it.

1. Exactly one worker computes `t`, because the atomic counter hands each index
   out once.
2. That worker zeroes its accumulator, then for each depth slice in increasing
   order adds `A[i][k]·B[k][j]` for every `k` in the slice, in increasing `k`
   (the cache-block loops partition the slice's `k` range into consecutive
   blocks visited in order, and each `(i, k, j)` triple is touched once).
3. Slices cover `[0, n)` without overlap or gaps, since `depth_start` steps by
   `D` and the last `depth` is clipped to `n − depth_start`.
4. The tile is written once, to the position of its grid cell; the cells
   partition `C`.

So every `C[i][j]` receives every product `A[i][k]·B[k][j]` exactly once,
summed in increasing `k`, and is stored exactly once: the product, with the
same bits as [`naive`](crate::naive).

# What it costs

- **No faster on data that fits in memory.** In-memory matrices are copied into
  the tile buffers before being used. If everything fits in RAM,
  [`cache_friendly`](crate::cache_friendly) is the better choice. Level 3 earns
  its keep when the data does not fit, or when you want to consume results
  without storing them.
- **Rereading.** The inputs are read many times; see the cost model.
- **I/O can fail.** Sources and sinks return `io::Result`, so this level has a
  richer error type, [`MatmulError`](crate::MatmulError).
- **More machinery.** A tile abstraction, a plan, per-worker buffers, and an
  error-propagation protocol: that is the cost of the generality.

For what remains undone, see [Limitations and roadmap](crate::reference::limitations).

[`TileSource`]: crate::streaming::TileSource
[`TileSink`]: crate::streaming::TileSink
[`StreamConfig::peak_buffer_bytes`]: crate::streaming::StreamConfig::peak_buffer_bytes
