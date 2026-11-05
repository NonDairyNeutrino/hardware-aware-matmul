# Requirements

- Rust 1.73 or newer (the crate uses `usize::div_ceil` and scoped threads).
- Unix or Windows for the disk-backed [`FileMatrix`](crate::streaming::FileMatrix).
  Everything else is platform-independent.
- No external crates.

# Build and test

```sh
cargo build --release
cargo test
```

`cargo test` runs three kinds of tests: unit tests inside each module,
integration tests in `tests/` (including one that checks all five levels
agree), and **the examples embedded in this documentation**, which are compiled
and, unless marked otherwise, run. To run only the documentation examples:

```sh
cargo test --doc
```

# Read the documentation

This documentation is built by `cargo doc`:

```sh
cargo doc --open
```

The five implementations are the modules `naive`, `threaded`,
`cache_friendly`, `simd`, and `streaming`, and each module's page is one chapter of
the story, so read them in that order. The `guide`, `design`, and `reference`
modules hold the other pages. Pass `--document-private-items` to include the
private streaming kernel.

# Run the demos

There are two binaries.

**`compare`** (the default) times all five levels on the same problem:

```sh
cargo run --release                # n = 512, one thread per core
cargo run --release -- 1024        # n = 1024
cargo run --release -- 1024 4      # n = 1024, 4 threads
```

It multiplies two `n × n` matrices with every level, verifies that the four
results are identical, and prints a table showing each level's time and its
speed relative to the previous level and to the naive baseline. Always use
`--release`.

**`out_of_core`** runs level 4 on matrices stored in files:

```sh
cargo run --release --bin out_of_core          # n = 1024
cargo run --release --bin out_of_core -- 4096  # n = 4096
```

It creates three files in your temporary directory (`A`, `B`, and `C`), fills
`A` and `B` one row at a time, multiplies them with 128×128×128 tiles, prints
the result, and deletes the files. Its first line of output compares the size
of all three matrices with the upper bound on tile-buffer memory, which is the
point of the exercise.

> The `out_of_core` files are `3·n²·8` bytes in total. At `n = 4096` that is
> about 384 MiB of temporary disk space.

# Add it to a project

Until it is published, depend on it by path:

```toml
[dependencies]
naive_matmul = { path = "../naive_matmul" }
```

# Your first multiplication

```rust
use std::num::NonZeroUsize;
use naive_matmul::{cache_friendly, naive, Matrix};

fn main() -> Result<(), naive_matmul::DimensionMismatch> {
    let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);

    // The reference implementation: single-threaded triple loop.
    let c = naive::matmul(&a, &b)?;
    assert_eq!(c[(0, 0)], 58.0);

    // The fastest in-memory implementation: same answer.
    let threads = NonZeroUsize::new(2).unwrap();
    assert_eq!(cache_friendly::matmul(&a, &b, threads)?, c);
    Ok(())
}
```

[`Matrix::new`](crate::Matrix::new) takes the row count, the column count, and
the elements in row-major order. The threaded levels take a thread count as a
`NonZeroUsize`, so "zero threads" is unrepresentable.

# Where to go next

- Choosing among the levels for matrices in memory:
  [Multiplying in-memory matrices](crate::guide::in_memory).
- Matrices too big for RAM: [`streaming`](crate::streaming) with
  [`FileMatrix`](crate::streaming::FileMatrix).
- Understanding the design: [Architecture](crate::design::architecture).
