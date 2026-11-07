**Level 1 of 5.** The same triple loop, spread across threads. One idea, a
few lines of new code.

# What changed from level 0

The rows of the output do not depend on each other. Row `i` of `C` needs only
row `i` of `A` and all of `B`, and nothing else. So the output rows can be
split into blocks, and each block computed independently:

```text
        B  (shared, read-only)
        ┌───────────┐
        │           │
        │           │
        └───────────┘
 A                      C
┌─────────────┐      ┌───────────┐
│ rows block 0│ ───► │  block 0  │ ← thread 0
├─────────────┤      ├───────────┤
│ rows block 1│ ───► │  block 1  │ ← thread 1
├─────────────┤      ├───────────┤
│ rows block 2│ ───► │  block 2  │ ← thread 2
└─────────────┘      └───────────┘
```

The inner loops are untouched: each thread runs the level-0 triple loop, but
only for its own rows.

```text
rows_per_block ← CEIL(m / threads)
SPLIT C into contiguous blocks of rows_per_block rows
FOR EACH block, in parallel:
    FOR EACH row i in the block:
        FOR j in 0..p:
            sum ← 0
            FOR k in 0..n:  sum ← sum + A[i][k] × B[k][j]
            C[i][j] ← sum
JOIN all threads
```

```rust
use std::num::NonZeroUsize;
use hardware_aware_matmul::{threaded, Matrix};

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let c = threaded::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
# Ok::<(), hardware_aware_matmul::DimensionMismatch>(())
```

# How it is done safely

<details>
<summary>Implementation notes: scoped threads and split_at_mut</summary>

Two Rust features make this short and free of `unsafe`:

- **Scoped threads** (`std::thread::scope`). The workers may borrow `a` and `b`
  directly from the caller's stack, because the scope guarantees they finish
  before it ends. No `Arc`, no cloning, no `'static` bound.
- **`split_at_mut`**, driven by the blocks of
  [`row_block_plan`](crate::threaded::row_block_plan), splits the output's
  backing storage into non-overlapping `&mut [f64]` blocks. The borrow checker
  therefore *proves* that no two
  threads can write the same element, so no lock or atomic is needed in the
  arithmetic.

Each thread's kernel (a private function in this module) reads `a` and `b` and
writes only its own block. That separation, with arithmetic on one side and
partitioning on the other, is kept at every level from here on.

</details>

# What it gets right

- **Near-linear scaling is possible**, up to the number of cores, when nothing
  the threads share is used up.
- **Results are unchanged.** Each output element is still computed by exactly
  one thread, in exactly the same order as at level 0, so the result is
  bit-for-bit identical for any thread count.
- **No overhead in the arithmetic.** No locks, no atomics, no shared mutable
  state.

# What it costs

- **Each thread is as slow as level 0, and the threads share the hardware.**
  Every thread still walks a *column* of `B` for each output element (the
  level-0 access pattern), and all of them share the same memory system and the
  same cores. Threads help until something they share is used up, and which
  resource that is depends on the machine and on how efficient each thread's
  loop is. This loop probably spends much of its time waiting for memory, which would
  leave idle time for other threads to use, so it can keep gaining for a long
  time. What it cannot do is make any single thread faster. That is the main
  reason level 2 exists: speed up what each thread does, and the threads go
  further.
- **Fixed, equal-sized blocks.** Work is divided in advance, with no
  rebalancing. For this problem every row costs the same, so equal blocks are
  fine, but if one thread were slowed by something else the others would idle
  waiting for it. Level 5 uses a work queue instead.
- **Parallelism is capped at the row count.** With fewer rows than threads,
  only as many threads as rows are used.
- **Still three whole matrices in memory.**

# Where to go next

The arithmetic each thread does is still the slow part.
[`cache_friendly`](crate::cache_friendly) rewrites that loop nest so that it
walks memory the way the hardware likes.
