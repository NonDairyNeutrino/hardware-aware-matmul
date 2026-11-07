If your matrices fit in memory, you have six implementations to choose from.
This page shows how to build matrices and how to pick one.

# Building matrices

[`Matrix`](crate::Matrix) is a dense, row-major matrix of `f64`, shared by every
level.

```rust
use hardware_aware_matmul::Matrix;

// From row-major data:
let m = Matrix::new(2, 3, vec![1.0, 2.0, 3.0,
                               4.0, 5.0, 6.0]);

// All zeros:
let z = Matrix::zeros(3, 3);

// From a function of (row, column), called once per element in row-major order:
let identity = Matrix::from_fn(3, 3, |i, j| if i == j { 1.0 } else { 0.0 });

// Reading and writing:
assert_eq!(m[(1, 2)], 6.0);
let mut w = Matrix::zeros(2, 2);
w[(0, 1)] = 5.0;

assert_eq!((m.rows(), m.cols()), (2, 3));
assert_eq!(m.row(1), &[4.0, 5.0, 6.0]);
assert_eq!(m.as_slice().len(), 6);
```

`Matrix::new` panics if `data.len() != rows * cols`, and indexing panics when
out of bounds. These are programmer errors, so they are panics rather than
`Result`s.

# Choosing a level

| You want…                                          | Use                                              |
|----------------------------------------------------|--------------------------------------------------|
| The fastest in-memory product (measure on yours)   | [`simd::matmul`](crate::simd::matmul) or [`packed::matmul`](crate::packed::matmul) |
| Cache blocking without the vector work             | [`cache_friendly::matmul`](crate::cache_friendly::matmul) |
| A simple reference, or to understand the algorithm | [`naive::matmul`](crate::naive::matmul)          |
| Threads without the cache work (mostly for study)  | [`threaded::matmul`](crate::threaded::matmul)    |
| Bounded memory, or the same API as for files       | [`streaming::matmul`](crate::streaming::matmul)  |

All six return **bit-identical results**, so switching between them is safe.

```rust
use std::num::NonZeroUsize;
use hardware_aware_matmul::{cache_friendly, Matrix};

let a = Matrix::from_fn(100, 50, |i, j| (i + j) as f64);
let b = Matrix::from_fn(50, 80, |i, j| (i * j) as f64);

let threads = std::thread::available_parallelism().unwrap_or(NonZeroUsize::MIN);
let c = cache_friendly::matmul(&a, &b, threads)?;
assert_eq!((c.rows(), c.cols()), (100, 80));
# Ok::<(), hardware_aware_matmul::DimensionMismatch>(())
```

# Errors

[`naive`](crate::naive), [`threaded`](crate::threaded),
[`cache_friendly`](crate::cache_friendly), [`simd`](crate::simd), and [`packed`](crate::packed) can fail in exactly one way, with a
[`DimensionMismatch`](crate::DimensionMismatch) when `a.cols() != b.rows()`.
The check happens before anything is allocated.
[`streaming::matmul`](crate::streaming::matmul) returns the richer
[`MatmulError`](crate::MatmulError), because the streaming level can also hit
I/O errors; for in-memory matrices the only error that can occur is still the
dimension mismatch.

# Threads and small matrices

[`threaded`](crate::threaded), [`cache_friendly`](crate::cache_friendly),
[`simd`](crate::simd), and [`packed`](crate::packed) split the output *rows* across threads, so the useful thread count is at most
the number of rows.

[`streaming::matmul`](crate::streaming::matmul) splits the output into 256×256
tiles (clamped to the matrix size), so for matrices up to 256 in every
dimension there is exactly one tile and **one worker does all the work**
however many threads you ask for. To spread a small product over more threads
at that level, use [`matmul_streaming`](crate::streaming::matmul_streaming)
with a smaller [`with_tile_shape`](crate::streaming::StreamConfig::with_tile_shape).

# When not to use these

Both operands and the result are in memory, so the memory savings of streaming
do not apply to in-memory data. If you need maximum speed on in-memory data, a
tuned BLAS will beat all six levels. Use this crate to learn how the pieces
fit together, for the streaming behaviour, or as a simple dependency-free
multiply.
