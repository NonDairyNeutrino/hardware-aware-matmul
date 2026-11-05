**Level 0 of 4.** The textbook algorithm: one thread, three nested loops, no
tricks. Everything else in this crate is a modification of this function, and
every other level is tested against it.

# The idea

For `A` (`m × n`) and `B` (`n × p`), each element of the product `C` (`m × p`)
is the dot product of a row of `A` with a column of `B`:

```text
C[i][j] = Σ over k of  A[i][k] · B[k][j]
```

That translates directly into three loops:

```text
for i in 0..m:
    for j in 0..p:
        sum ← 0
        for k in 0..n:
            sum ← sum + A[i][k] × B[k][j]
        C[i][j] ← sum
```

The real implementation, [`matmul`], is exactly this, using `a[(i, k)]`
indexing on [`Matrix`](crate::Matrix).

```rust
use naive_matmul::{naive, Matrix};

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let c = naive::matmul(&a, &b)?;
assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
# Ok::<(), naive_matmul::DimensionMismatch>(())
```

# What it gets right

- **It is obviously correct.** There is nothing here to get wrong, which is
  why it is the reference for the other levels.
- **It defines the summation order.** Each `C[i][j]` is accumulated in
  increasing `k`, starting from zero. Every later level preserves that order,
  so every level returns *exactly the same bits*.
- **The accumulator lives in a register.** `sum` is a local variable, so the
  inner loop does not touch `C` at all.

# What it costs

The arithmetic is `2·m·n·p` floating-point operations, and **no later level
reduces that count**. Everything that follows is about doing the same work
faster, or on bigger data. The problems with this version are about *how* it
touches memory and processors:

1. **One core.** Only one thread runs; every other core sits idle. Level 1
   fixes this.
2. **A column walk.** The inner loop reads `B[0][j], B[1][j], B[2][j], …`.
   `Matrix` stores rows contiguously, so consecutive reads are `p` elements
   apart: almost every access lands on a different cache line, and a line
   fetched for `B[k][j]` is mostly wasted when the loop moves on. For large
   matrices the processor spends most of its time waiting for memory. Level 2
   fixes this.
3. **A bounds check per element access.** `Index` asserts that the index is in
   range on every call. This is a constant-factor cost (the optimiser can
   remove some of it, not reliably all), and later levels sidestep it by
   iterating over slices.
4. **Three whole matrices in memory.** `A`, `B`, and `C` must all be resident
   at once, which for `n × n` matrices of `f64` is `3·n²·8` bytes. Level 4
   removes this limit.

# Where to go next

[`threaded`](crate::threaded) is the smallest possible change that uses more
than one core.

[`matmul`]: crate::naive::matmul
