# Running the row blocks on your own executor

Levels 1 to 3 split the output rows into blocks (see
[`row_block_plan`](crate::threaded::row_block_plan)) and compute each block as
an independent job. By default every job gets a scoped standard-library thread.
A [`Runner`] replaces that step, so the same kernels can run on a thread pool, in
a test, or on a target that has no operating-system threads.

[`StdRunner`] is the default. The `_with_runner` functions
([`threaded::matmul_with_runner`](crate::threaded::matmul_with_runner),
[`cache_friendly::matmul_with_runner`](crate::cache_friendly::matmul_with_runner),
[`simd::matmul_with_runner`](crate::simd::matmul_with_runner)) take any other.

A runner must run every job and return only when all have finished. It does not
change the answer: each job writes its own rows, so results are bit-for-bit
identical whichever runner executes them.

The `threads` argument is the maximum number of jobs, not a promise of
parallelism: how many run at once is the runner's choice. A runner that
silently drops jobs would leave the rows of those jobs zero, so it must run
every one.

```rust
use std::num::NonZeroUsize;
use naive_matmul::runner::Runner;
use naive_matmul::{threaded, Matrix};

/// Runs every job on the calling thread, one after another.
struct Inline;

impl Runner for Inline {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        for job in jobs {
            job();
        }
    }
}

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let threads = NonZeroUsize::new(2).unwrap();
let c = threaded::matmul_with_runner(&a, &b, threads, &Inline)?;
assert_eq!(c, Matrix::new(2, 2, vec![58.0, 64.0, 139.0, 154.0]));
# Ok::<(), naive_matmul::DimensionMismatch>(())
```

Level 4 ([`streaming`](crate::streaming)) has its own worker loop and does not
use a `Runner` yet.
