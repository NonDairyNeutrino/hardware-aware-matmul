# One problem, six implementations

The crate is organised as a ladder. Each rung is a complete, working
implementation of matrix multiplication, and each reuses the ideas of the one
below it, so the code can be read in order.

```text
 0 naive  ─►  1 threaded  ─►  2 cache_friendly  ─►  3 simd  ─►  4 packed
 the loop     + row blocks    + i-k-j kernel         + register-    + B copied into
              + scoped        + cache blocks            blocked        contiguous
                threads         (axpy)                  micro-kernel   strips first

              2 cache_friendly  ─►  5 streaming
              its axpy kernel       + tiles, sources, sinks,
              and cache blocks        dynamic work queue
```

Reading it as a chain of reuse:

| Level | Reuses from below | Adds |
|-------|-------------------|------|
| 0 `naive`          | (nothing)                                  | The triple loop |
| 1 `threaded`       | Level 0's loop, as the per-thread kernel   | Row-block partitioning (`row_block_plan`), jobs on a `Runner` (scoped threads by default) |
| 2 `cache_friendly` | Level 1's partitioning and threading       | A new kernel: `i-k-j` order, `axpy`, cache blocks |
| 3 `simd`           | Level 1's partitioning and threading; level 2's `axpy` and cache blocks | A register-blocked micro-kernel for the innermost step |
| 4 `packed`         | Level 3's micro-kernel, partitioning and cache blocks | Packing: each cache block of `B` is copied into contiguous strips before the kernel reads it |
| 5 `streaming`      | Level 2's `axpy` and cache blocks          | Tiles, the source/sink traits, a work queue |

Shared by all levels: [`Matrix`](crate::Matrix), the dimension check, and the
error types.

# Modules

| Module                      | Public?  | Contents |
|-----------------------------|----------|----------|
| `matrix`                    | yes      | `Matrix`: dense row-major `f64` storage, used by every level. |
| `error`                     | yes      | `MatmulError`, `DimensionMismatch`, and the shared shape check. |
| `naive`                     | yes      | Level 0. |
| `threaded`                  | yes      | Level 1, `row_block_plan`, and the row-block driver that levels 2 to 4 reuse. |
| `runner`                    | yes      | `Runner` and `StdRunner`: where levels 1 to 5 run their jobs. |
| `cache_friendly`            | yes      | Level 2, including `axpy`, `BlockConfig`, and the default cache-block constants used by levels 3 to 5. |
| `simd`                      | yes      | Level 3: the register-blocked micro-kernel and `micro_tile_shape`. |
| `packed`                    | yes      | Level 4: `pack_strips` and the level-3 micro-kernel reading from packed strips. |
| `streaming`                 | yes      | Level 5 and its submodules (below). |
| `streaming::tile`           | yes      | `TileSource`, `TileSink`, `MemorySink`; `Matrix` implements `TileSource`. |
| `streaming::file`           | yes\*    | `FileMatrix`, a disk-backed source and sink. \*Unix and Windows only. |
| `streaming::multiply`       | yes      | `matmul_streaming`, `StreamConfig`, `tile_plan`, `matmul`. |
| `streaming::kernel`         | no       | `accumulate_tile`: level 2's kernel on flat buffers. |

# Separation of concerns

Every level splits its work the same way, and the split is what lets one level
build on another:

- **Partitioning** decides *which part of the output* a unit of work covers
  (all of it, a block of rows, or a tile) and who runs it.
- **The kernel** does the arithmetic for one unit of work. It only reads inputs
  and writes its own output slice, and knows nothing about threads.

In level 1 the kernel is the level-0 loop. In levels 2 to 4 only the kernel
changes. In level 5 the partitioning changes (tiles, work queue, sources and
sinks) and the kernel is level 2's, adapted to flat buffers. Because the pieces
are independent, each level's difference from its predecessor is small.

The partition is an ordinary function: `threaded::row_block_plan` for levels 1
to 4 and `streaming::tile_plan` for level 5. The levels 1 to 4 driver calls
`row_block_plan` itself; for level 5, `tile_plan` and the streaming driver are
built on the same private geometry code (`Plan`). Either way a plan describes
exactly what will run. For level 5 the plan lists the tiles in the order they are numbered; which worker computes which tile is
decided at run time, because workers claim tiles from a shared counter.

# Data flow in level 5

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

The pair `a_buf`/`b_buf` is refilled for each slice of the shared dimension.
`c_buf` is zeroed at the start of a tile, accumulates across all slices, and is
written out once at the end. All three buffers are then reused for the next
tile claimed by the same worker.

# Why traits instead of closures or enums

`TileSource` and `TileSink` are traits because the set of backends is open:
users plug in generated data, mapped files, network stores. Two properties make
the traits cheap to use:

- Both require `Sync`, which is exactly what lets a shared reference cross into
  worker threads. Nothing else about the backends is constrained.
- `matmul_streaming` is generic over `A: TileSource + ?Sized`, so it
  monomorphises for concrete types (no virtual call per tile in the common
  case) while still accepting `&dyn TileSource` when you want runtime
  polymorphism.

# Why `streaming::matmul` wraps the streaming path

Within level 5 there is exactly one algorithm. `streaming::matmul` builds a
`MemorySink`, calls `matmul_streaming`, and unwraps the sink, rather than
maintaining a second, in-memory implementation. The in-memory and out-of-core
paths therefore cannot drift apart, and the tests that exercise one exercise
the other. The price is one extra copy of each tile, which is why
[`simd`](crate::simd), not `streaming::matmul`, is the recommended choice for
data that fits in memory.

# Design principles

- **Imperative style throughout.** Explicit `for` loops that mutate
  accumulators and output slices, rather than iterator-adaptor chains. The
  algorithms are loop nests, and the code reads like one.
- **No `unsafe`.** Disjoint mutable access is achieved by ownership: slices from
  `split_at_mut` in levels 1 to 4, per-worker buffers in level 5. Disjoint
  access to the output of level 5 is the sink's responsibility.
- **No dependencies.** Scoped threads, atomics, and positional file I/O are all
  in `std`.
- **Panics for bugs, `Result` for the world.** I/O can fail legitimately and is
  reported as an error. Misusing an API (wrong buffer length, out-of-bounds
  tile) is a programming error and panics.
- **One result, many speeds.** Every level returns the same bits, so levels can
  be swapped freely and checked against each other.
