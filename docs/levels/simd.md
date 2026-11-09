**Level 3, of levels 0 to 5.** Same threads, same partitioning, same results as level 2,
but the innermost step is rebuilt around the processor's vector registers.

Level 2 put the data close to the core, and the loop still carries the output block through memory
on every step. This level removes that last trip: it keeps a small block of the output in the
processor's vector registers for the whole inner loop.

# What changed from level 2

Only the innermost step of the kernel. Level 2's loops visit every `(i, k)`
pair and, for each, run `axpy` over a row segment:

```text
for each row i, for each k:
    C[i][j_block] ← C[i][j_block] + A[i][k] × B[k][j_block]
```

The compiler can vectorise that loop, because its iterations are independent, but look at what each
pass does: it *loads* a segment of `B`, *loads* a segment of `C`, performs one multiply and one add,
and *stores* the segment of `C` back. Two loads and a store for one multiply-add. The load/store
units can limit the speed even when every access hits the cache, because the arithmetic cannot go
faster than the data arrives. The gain depends on how well the processor overlaps memory traffic
with arithmetic.

The fix is to stop moving `C` through memory on every `k`. Keep a small block
of `C` in **registers** for the whole `k` loop, and do all the arithmetic on it
there.

# A little SIMD background

A **SIMD** (single instruction, multiple data) instruction applies one operation to a whole
**vector** of numbers in a wide register, one per **lane**. How many `f64` lanes a register has
depends on the instruction set:

| Instruction set | Register width | `f64` lanes |
|-----------------|----------------|-------------|
| SSE2 (baseline `x86_64`), NEON (`aarch64`), SIMD128 (WebAssembly, when enabled) | 128 bits | 2 |
| AVX, AVX2       | 256 bits       | 4 |
| AVX-512         | 512 bits       | 8 |

One vector multiply-add therefore does 2, 4, or 8 scalar multiply-adds in the time of one, provided
they are **independent**: lane `l` must not need lane `l - 1`'s result.

# The micro-kernel

Take an `MR × NR` block of `C` (the **micro-tile**) and treat its `NR` columns
as the lanes. For each `k`, load one vector of `B` (`B[k][j .. j+NR]`), and for
each of the `MR` rows multiply it by the scalar `A[i][k]` and add into that
row's accumulator vector:

```text
                    B   (strip of NR columns)
                 ┌───────────────────────────┐
              k  │ b[k][j .. j+NR]           │ ← one vector load per k
                 └───────────────────────────┘

   A rows         C micro-tile  (MR × NR), held in registers
 ┌─────────┐     ┌───────────────────────────┐
 │ a[0][k] │  ×  │ acc[0][0 .. NR]           │   acc[i][l] += a[i][k] × b[l]
 │ a[1][k] │  ×  │ acc[1][0 .. NR]           │
 │ a[2][k] │  ×  │ acc[2][0 .. NR]           │   for every row i and lane l
 │ a[3][k] │  ×  │ acc[3][0 .. NR]           │
 └─────────┘     └───────────────────────────┘
```

```text
PROCEDURE micro_kernel(a_rows[MR], b, c_rows[MR], j, depth)
    acc[MR][NR] ← c_rows[i][j .. j+NR]            // load C once
    FOR k FROM 0 TO depth−1:
        b_vec ← b[k][j .. j+NR]                   // one vector load
        FOR i FROM 0 TO MR−1:
            a_ik ← a_rows[i][k]                   // broadcast to all lanes
            FOR l FROM 0 TO NR−1:
                acc[i][l] ← acc[i][l] + a_ik × b_vec[l]
    c_rows[i][j .. j+NR] ← acc[i]                 // store C once
```

Each `k` costs one `B` load and `MR` broadcasts for `MR × NR` multiply-adds. `C` moves once per
*`depth`* steps, not on every step. This is the central idea of every high-performance matrix
multiply: keep the output block in registers, and the memory system only has to feed the inputs.

The micro-tile shape is `MR = 4` rows by `NR = 4` columns on a baseline build,
or `NR = 8` when compiled for AVX or later. In both cases the accumulators
occupy about eight vector registers, which leaves room in a 16-register file
for the loaded `B` vectors and a broadcast value without spilling to the stack.
[`micro_tile_shape`] reports the values in effect.

# How the compiler is persuaded to use SIMD, with no `unsafe`

<details>
<summary>Implementation notes: writing loops the auto-vectoriser recognises, and how to check</summary>

The crate does not call vector intrinsics. Explicit intrinsics need `unsafe`
code (the safe `std::simd` is not available on stable Rust), and this crate
forbids `unsafe` and has no dependencies. Instead the loops are written in the
shape the optimiser's **auto-vectoriser** reliably recognises:

- **Fixed-size arrays and constant trip counts.** The accumulators are an
  `[[f64; NR]; MR]` and the lane loop runs exactly `NR` times, so it unrolls
  completely and maps onto whole registers.
- **Independent lanes.** Lane `l` is a different output element, so no lane
  depends on another.
- **No aliasing.** `C` rows are `&mut [f64]`, which Rust guarantees do not
  overlap `B`. The compiler does not have to prove that, or insert runtime
  checks for it.
- **No reassociation.** Vectorising across *outputs* needs no change to the
  order of any one element's additions. (Vectorising the `k` sum itself would
  need the compiler to reorder floating-point additions, which it will not do
  without fast-math flags, and which would change the answer. This code
  never asks it to.)

The cost of this approach is that it depends on the compiler cooperating. It
usually does for code of this shape, but the guarantee is empirical, not
contractual. To check on your build, emit the assembly and look for packed
multiply instructions (`mulpd` or `vmulpd` on `x86_64`, `fmul v….2d` on
`aarch64`) inside the micro-kernel:

```sh
cargo rustc --release --lib -- --emit asm
```

</details>

# Which vector width you actually get

The vector instruction set is chosen **when the crate is compiled**, not at run
time. A default `x86_64` build targets SSE2, with two lanes, even on a CPU that
supports AVX-512.

<details>
<summary>Implementation notes: target-cpu flags and querying the instruction set</summary>

To let the compiler use everything the machine you are building on offers:

```sh
RUSTFLAGS="-C target-cpu=native" cargo run --release
```

The resulting binary may not run on older CPUs, so use this for local
experiments, or choose a specific `target-cpu` for deployment.
[`target_vector_isa`] returns the name of the widest set the build targets, and
the `compare` binary prints it, so you can see which you are measuring.

```rust
use hardware_aware_matmul::simd;

let isa = simd::target_vector_isa();   // e.g. "SSE2", "AVX2", "NEON", "WASM SIMD128"
let (mr, nr) = simd::micro_tile_shape();
assert!(!isa.is_empty());
assert!(mr > 0 && nr > 0);
```

</details>

# The result is still bit-identical

For any output element, the micro-kernel adds the same products in the same
order as every earlier level: increasing `k`, starting from zero (the
accumulator is loaded from `C`, which holds the sum so far, and written back
afterwards). Edge regions that do not fill a micro-tile (fewer than `MR` rows
left, or fewer than `NR` columns left in a cache block) fall back to level 2's
`axpy`, which adds the same terms in the same order.

Rust never fuses a multiply and an add into an FMA on its own, so each product is rounded before the
add, as in the naive loop. A fused multiply-add rounds once instead of twice: faster and slightly
more accurate, but it would change the bits, so this crate does not use it (`f64::mul_add` would be
the way). The test suite asserts exact equality with [`naive`](crate::naive) across shapes that
stress every edge of the micro-tile.

# Example

```rust
use std::num::NonZeroUsize;
use hardware_aware_matmul::{simd, Matrix};

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let c = simd::matmul(&a, &b, NonZeroUsize::new(2).unwrap())?;
assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
# Ok::<(), hardware_aware_matmul::DimensionMismatch>(())
```

# What changed, in one table

| | [`cache_friendly`](crate::cache_friendly) (2) | `simd` (3) |
|---|---|---|
| Row-block partitioning, scoped threads | yes | **same driver** |
| Cache blocks of `B` (32 × 64) | yes | **same** |
| Innermost step | `axpy` per `(i, k)` pair | `MR × NR` micro-kernel |
| Where `C` lives during the `k` loop | memory (loaded and stored each `k`) | registers (loaded and stored once per cache block) |
| Loads per multiply-add | about 2 (`B`, `C`), plus a store | about `1/MR` of a `B` vector, plus `1/NR` of a broadcast |
| Edges | n/a | fall back to `axpy` |
| Summation order per element | increasing `k` | increasing `k` |

# What it costs

- **Compile-time vector width.** One binary, one width. There is no run-time detection and dispatch,
  because that needs `unsafe` today.
- **No packing.** Each micro-kernel call reads `NR` consecutive elements from each of `depth` rows
  of `B`, a row apart.

# Where to go next

[`packed`](crate::packed) removes the last cost above. It keeps this micro-kernel and changes where
it reads `B` from: a contiguous copy of each cache block instead of the matrix itself.

[`micro_tile_shape`]: crate::simd::micro_tile_shape
[`target_vector_isa`]: crate::simd::target_vector_isa
