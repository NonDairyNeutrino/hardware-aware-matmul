**Level 2 of 4.** Same threads, same partitioning, same results, but each
thread's loops are rearranged so the processor stops waiting for memory.

# What changed from level 1

Only the kernel, the loop nest each thread runs. The row-block partitioning
and the scoped threads are the same driver as level 1
([`threaded`](crate::threaded)); the kernel is what changes.
Two changes to the kernel:

1. a different **loop order**, and
2. **cache blocking**.

# Change 1: loop order `i-k-j`

The earlier levels compute each `C[i][j]` as a dot product of a row of `A`
with a *column* of `B`. In row-major storage a column is strided, so nearly
every read of `B` touches a different cache line, and most of each line that
is fetched goes unused.

The `i-k-j` order does the same additions in a different order. For each
element `A[i][k]`, it adds `A[i][k]` times *row* `k` of `B` into *row* `i` of
`C`:

```text
for i in rows:
    for k in 0..n:
        alpha ← A[i][k]
        for j in 0..p:                    ← walks two contiguous rows
            C[i][j] ← C[i][j] + alpha × B[k][j]
```

The innermost loop now reads one contiguous row and updates another. It is
called `axpy` (`y ← y + a·x`, the name from the classic BLAS routine), and it
has three useful properties:

- every cache line fetched is used completely;
- it zips two slices, so there are no bounds checks in the loop body;
- its iterations are independent, so the compiler is free to vectorise it
  across `j`.

The price is that `C` is now *accumulated into* across the `k` loop instead of
being held in a register, so `C` must start at zero.

# Change 2: cache blocking

Contiguous loops help, but for large matrices there is a second problem.
Row `k` of `B` is used for one `i`, and then, by the time the loop returns to
it for the next `i`, it has been evicted. The data is reloaded from main
memory once per row of the output block.

Cache blocking restructures the loops so that a small block of `B` is reused
for *every* row of the output block before moving to the next block:

```text
for k_block in 0..n step 32:
  for j_block in 0..p step 64:
    for i in rows:                         ← same B block reused for every i
      for k in k_block:
        axpy(A[i][k], B[k][j_block], C[i][j_block])
```

A block of `B` is `32 × 64 × 8 = 16 KiB`, which fits in a typical 32 KiB L1
data cache alongside the active segments of `A` and `C`. These sizes are
reasonable defaults, not tuned constants; the best values depend on your CPU.

```rust
use std::num::NonZeroUsize;
use naive_matmul::{cache_friendly, Matrix};

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let c = cache_friendly::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
# Ok::<(), naive_matmul::DimensionMismatch>(())
```

# The result is still bit-identical

Rearranging loops usually changes floating-point results, because addition is
not associative. This rearrangement does not. For any one output element, the
terms are still added in increasing `k`, starting from zero:

- `k` blocks are visited in increasing order;
- within a block, `k` increases;
- each `C[i][j]` only ever receives its own terms.

The loop reorder changes *which element is being worked on at each moment*, not
the order of the additions that make up any one element. The test suite asserts
exact equality with [`naive`](crate::naive) across shapes and thread counts.

# What changed, in one table

| | [`threaded`](crate::threaded) (1) | `cache_friendly` (2) |
|---|---|---|
| Row-block partitioning, scoped threads | yes | **same** |
| Loop order | `i-j-k` (dot products) | `i-k-j` (row updates) |
| Access to `B` in the inner loop | down a column (strided) | along a row (contiguous) |
| Reuse of `B` across rows of a block | none (evicted) | cache blocks of 32×64 |
| `C` accumulator | a register | memory, zero-initialised |
| Inner loop | indexed, bounds-checked | `axpy`: zipped slices |
| Summation order per element | increasing `k` | increasing `k` |

# What it costs

- **Still three whole matrices in memory.** Neither blocking nor threading
  changes how much memory the problem needs.
- **Not a BLAS.** There is no register-blocked micro-kernel, no packing of `B`,
  and no SIMD intrinsics, only the two changes above.
- **Every thread streams all of `B`.** Each thread reads all of `B` from main
  memory for its own rows. The blocking keeps that reading efficient, but the
  total traffic scales with the number of threads.

# Where to go next

Every level so far assumes `A`, `B`, and `C` all fit in memory. For a
`100 000 × 100 000` product that is 240 GB. [`streaming`](crate::streaming)
removes that assumption.
