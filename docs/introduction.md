Dense matrix multiplication in Rust, presented as a **sequence of five
implementations**, each a small, understandable step beyond the one before.
Read them in order and the fast version never has to be met as one big blob.

| Level | Module | What it adds | What that fixes | What still limits it |
|-------|--------|--------------|-----------------|----------------------|
| 0 | [`naive`] | The textbook triple loop | (nothing: the reference) | One core; strided access to `B`; all matrices in RAM |
| 1 | [`threaded`] | Output rows split across threads | Idle cores | Each thread is as slow as level 0 (probably waiting on memory); all matrices in RAM |
| 2 | [`cache_friendly`] | `i-k-j` loop order and cache blocking | Wasted memory traffic | `C` moves through memory on every step; all matrices in RAM |
| 3 | [`simd`] | A register-blocked, vectorisable micro-kernel | Excess loads and stores | Compile-time vector width; all matrices in RAM |
| 4 | [`streaming`] | Output tiles, streamed sources and sinks | The memory limit | Rereads inputs; copies tiles |

Every level computes **exactly the same result, bit for bit**. Each output
element is summed in increasing `k` order starting from zero at every level, so
the story is purely about *how* the work is done, never about *what* is
computed. The test suite asserts exact equality across all five.

# Reading order

Each module's documentation is one chapter, in the same format: what changed
from the previous level, how it works, what it gets right, and what it costs
(which motivates the next chapter).

1. [`naive`]: the algorithm, and why it is slow.
2. [`threaded`]: the smallest change that uses every core.
3. [`cache_friendly`]: make each core's loop nest respect the memory hierarchy.
4. [`simd`]: keep the output block in vector registers.
5. [`streaming`]: stop requiring the matrices to fit in memory.

# Try it

```sh
cargo run --release                    # times all five levels on one problem
cargo run --release -- 1024 8          # n = 1024, 8 threads
cargo run --release --bin out_of_core  # level 4 on matrices stored in files
```

The first command multiplies two `n × n` matrices at every level, verifies that
all five results are identical, and prints a table of times. This documentation
contains no benchmark numbers: throughput depends heavily on your CPU, memory, and
storage, so measure on your own hardware. (The project's website publishes one
reference run, as generated data, with the machine it was taken on.) Use `--release`;
debug builds say nothing useful about the differences between the levels.

The SIMD level uses the vector instructions the crate was *compiled* for, which
by default is the baseline of your platform (for example SSE2 on `x86_64`).
To let it use everything your CPU has, build for the machine you are on:

```sh
RUSTFLAGS="-C target-cpu=native" cargo run --release
```

The `compare` binary prints which instruction set the SIMD level was compiled
for.

> Level 4 is not expected to beat level 3 on matrices that fit in memory. It
> copies tiles into small buffers. What it provides is bounded memory.

# Quick start

All five levels on the same input:

```rust
use std::num::NonZeroUsize;
use hardware_aware_matmul::{cache_friendly, naive, simd, streaming, threaded, Matrix};

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let threads = NonZeroUsize::new(2).unwrap();

let c0 = naive::matmul(&a, &b)?;
let c1 = threaded::matmul(&a, &b, threads)?;
let c2 = cache_friendly::matmul(&a, &b, threads)?;
let c3 = simd::matmul(&a, &b, threads)?;
let c4 = streaming::matmul(&a, &b, threads)?;

assert_eq!(c0, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
assert_eq!(c0, c1);
assert_eq!(c0, c2);
assert_eq!(c0, c3);
assert_eq!(c0, c4);
# Ok::<(), Box<dyn std::error::Error>>(())
```

# Which level should I use?

- **Your matrices fit in memory:** [`simd`]. It is the fastest level for
  that case. Use [`naive`] only as a reference or to learn from.
- **They do not, or you want to consume the product without storing it:**
  [`streaming`], with [`FileMatrix`](crate::streaming::FileMatrix) or your own
  [`TileSource`](crate::streaming::TileSource) and
  [`TileSink`](crate::streaming::TileSink).

It is deliberately *not* a high-performance BLAS replacement: no packing of `B`,
no explicit SIMD intrinsics or run-time dispatch, no fused multiply-add. Each level's chapter says what it leaves undone.

# Where to go next

| If you want to…                                  | Read                                              |
|--------------------------------------------------|---------------------------------------------------|
| Build, test, and run the demos                   | [`guide::getting_started`](crate::guide::getting_started) |
| Multiply matrices that fit in memory             | [`guide::in_memory`](crate::guide::in_memory)     |
| Understand the whole design                      | [`design`], starting at [`design::architecture`](crate::design::architecture) |

# Crate layout

| Module                 | Contents                                                              |
|------------------------|-----------------------------------------------------------------------|
| [`matrix`]             | [`Matrix`]: dense row-major `f64` storage shared by every level       |
| [`naive`]              | Level 0                                                               |
| [`threaded`]           | Level 1                                                               |
| [`cache_friendly`]     | Level 2                                                               |
| [`simd`]               | Level 3                                                               |
| [`streaming`]          | Level 4, with submodules `tile` (sources and sinks), `file` (disk-backed matrices), and `multiply` |
| [`error`]              | [`MatmulError`] and [`DimensionMismatch`]                             |
| [`guide`], [`design`]  | The prose pages (visible in `cargo doc`)                              |

The code is written in one consistent imperative style, with explicit `for`
loops rather than iterator-adaptor chains, so each level reads like the loop
nest it is. There is no `unsafe` and there are no dependencies.
