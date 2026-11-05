#![doc = include_str!("../docs/design/runner.md")]

/// Runs a batch of jobs to completion.
///
/// Levels 1 to 3 split the output rows into blocks and hand one job per block
/// to a `Runner`. A job borrows from the caller (`'env`), so `run` must not
/// return until every job has finished. Jobs are independent: they may run in
/// any order, on any threads, or one after another on the calling thread.
///
/// The `threads` argument of the `matmul` functions is an upper bound on the
/// number of jobs, not a promise of parallelism: the runner decides how many
/// run at once. Jobs must not assume any order, or that they run on separate
/// threads. This crate never calls `run` from inside a job, so runners need not
/// support re-entrant calls.
///
/// A panic in a job reaches the caller of `run` under [`StdRunner`] (the
/// original payload is replaced by a generic "a scoped thread panicked"
/// message). On targets built with `panic=abort`, such as the wasm build, it
/// aborts instead.
///
/// See the [module documentation](self) for an example.
pub trait Runner: Sync {
    /// Runs every job in `jobs`, returning only when all have finished.
    ///
    /// A panic inside a job must reach the caller of `run`, as with
    /// [`std::thread::scope`].
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>);
}

/// The default [`Runner`]: one scoped standard-library thread per job.
///
/// Every `matmul` function without a `_with_runner` suffix uses this. It does
/// not work on targets without operating-system threads, such as
/// `wasm32-unknown-unknown`; use another [`Runner`] there.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StdRunner;

impl Runner for StdRunner {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        std::thread::scope(|scope| {
            for job in jobs {
                scope.spawn(job);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn std_runner_runs_every_job_and_waits_for_them() {
        let done = AtomicUsize::new(0);
        let jobs: Vec<Box<dyn FnOnce() + Send + '_>> = (0..8)
            .map(|_| {
                let done = &done;
                Box::new(move || {
                    done.fetch_add(1, Ordering::SeqCst);
                }) as Box<dyn FnOnce() + Send + '_>
            })
            .collect();
        StdRunner.run(jobs);
        assert_eq!(done.load(Ordering::SeqCst), 8);
    }

    #[test]
    fn std_runner_lets_jobs_write_disjoint_borrowed_slices() {
        let mut data = vec![0_u32; 6];
        let jobs: Vec<Box<dyn FnOnce() + Send + '_>> = data
            .chunks_mut(2)
            .enumerate()
            .map(|(i, chunk)| {
                Box::new(move || chunk.fill(i as u32 + 1)) as Box<dyn FnOnce() + Send + '_>
            })
            .collect();
        StdRunner.run(jobs);
        assert_eq!(data, [1, 1, 2, 2, 3, 3]);
    }

    #[test]
    fn std_runner_with_no_jobs_returns_immediately() {
        StdRunner.run(Vec::new());
    }

    #[test]
    #[should_panic(expected = "a scoped thread panicked")]
    fn std_runner_propagates_a_job_panic() {
        let jobs: Vec<Box<dyn FnOnce() + Send>> = vec![Box::new(|| panic!("boom"))];
        StdRunner.run(jobs);
    }
}
