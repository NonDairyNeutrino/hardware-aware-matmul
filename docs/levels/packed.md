**Level 4, of levels 0 to 5.** Same as level 3, but each cache block of `B` is first **packed**:
copied into a contiguous buffer in the order the micro-kernel reads it.

Level 3 left a cost in plain sight: its kernel reads `B` a row apart at every step. This level pays
to copy each block once.

# What changed from level 3

Level 3's micro-kernel computes an `MR × NR` block of `C`. For every `k` it reads `NR` consecutive
elements of one row of `B`, then moves to the next row. Rows of `B` are `8·n` bytes apart, so each
strip the kernel reads comes from `depth` scattered cache lines.

Level 4 changes where that data comes from, and nothing else:

```text
B (row-major, row length n)            packed block (one strip after another)

 k=0   . . [s0 s0 s0 s0][s1 s1 s1 s1] .       strip 0:  k=0: s0 s0 s0 s0
 k=1   . . [s0 s0 s0 s0][s1 s1 s1 s1] .                 k=1: s0 s0 s0 s0
 k=2   . . [s0 s0 s0 s0][s1 s1 s1 s1] .                 k=2: ...
  ...                                                    ...
                                                 strip 1:  k=0: s1 s1 s1 s1
                                                           ...
```

For each cache block (the same `32 × 64` blocks as level 2), the whole `NR`-wide
strips are copied into one buffer, strip after strip, each strip stored
`k` by `k`. Then every group of `MR` rows of `C` runs the level-3 micro-kernel
against that buffer, which it reads from front to back.

The micro-kernel is level 3's, called unchanged. A packed strip is a
`depth × NR` tile of its own, so it is passed with a row length of `NR`.

# Why it helps, and why it might not

Three costs of a strided read go away; how much of each a given machine shows is for a measurement
to say.

- **Cache lines.** A strip of `NR` doubles is one 64-byte line when `NR = 8`
  and half of one when `NR = 4`. In `B` each such piece pulls in a line whose
  other bytes belong to the neighbouring strip. Packed, a line holds one or two
  whole `k` steps of the strip in use.
- **Pages.** `depth` rows of `B` that are `8·n` bytes apart touch up to `depth`
  different memory pages, each needing an entry in the TLB (the processor's cache
  of address translations). The packed block is a few contiguous pages.
- **Cache sets.** A cache maps an address to a set by its middle bits. When `n`
  is a power of two, rows `8·n` bytes apart can all map to the same few sets and
  evict one another, even though the cache as a whole has room. In the packed
  buffer the strips are adjacent, so they cannot.

Against that, packing is **extra work**: every element of `B` is read and written once more per pass
over it. Packing pays when many row groups reuse a block. Here every `MR`-row group in the thread's
output block reuses it. It does not pay for a tile with fewer than `MR` rows, which never reaches
the micro-kernel, so such a tile skips the copy.

A processor with large, highly associative caches and a good hardware prefetcher may hide most of
the strided-read cost already.

# The result is still bit-identical

Packing moves values of `B`. It does not change which products are added to an
output element, or the order: the micro-kernel still adds them in increasing
`k`, starting from the sum so far in `C`. Columns that do not fill an `NR`-wide
strip, and rows that do not fill an `MR`-row group, take the same scalar path as
at level 3, from the original `B`. The test suite compares this level with the
naive loop, bit for bit, on operands where a reordering would show.

# Example

```rust
use std::num::NonZeroUsize;
use hardware_aware_matmul::{packed, Matrix};

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let c = packed::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
# Ok::<(), hardware_aware_matmul::DimensionMismatch>(())
```

# What changed, in one table

| | [`simd`](crate::simd) (3) | `packed` (4) |
|---|---|---|
| Row-block partitioning, scoped threads | yes | **same driver** |
| Micro-kernel and `MR × NR` tile | yes | **same** |
| Cache blocks of `B` (32 × 64) | yes | **same** |
| Where the kernel reads `B` | in place, a row (`8·n` bytes) apart | a private contiguous buffer |
| Extra work | none | one copy of each block of `B`, per thread |
| Summation order per element | increasing `k` | increasing `k` |

# What it costs

- **Every thread packs its own copy.** Threads work on different rows of `C` but
  need the same blocks of `B`, and each packs them itself. Sharing one packed copy
  would save the repeated work and add synchronisation between threads.
- **A whole `B` block is copied even if few rows use it.** Short output blocks
  (many threads, few rows) pay the copy for little reuse.
- **`A` is not packed.** The micro-kernel reads `MR` rows of `A` in place. Packing
  `A` too is the other half of what BLAS libraries do and is not done here.
- **Allocation.** Each call allocates one buffer the size of a cache block of `B`
  (16 KiB with the default blocks), per thread.

# Where to go next

One assumption remains: every level so far assumes `A`, `B`, and `C` all fit in memory.
[`streaming`](crate::streaming) removes that assumption. It computes its tiles with level 2's `axpy`
kernel, not with this level's packed micro-kernel.
