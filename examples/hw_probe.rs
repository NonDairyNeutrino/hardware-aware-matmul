//! Measures what the machine can do, so the benchmark numbers can be read against it:
//! memory bandwidth (a STREAM-style triad) and peak arithmetic (a register-only loop),
//! each for the given thread counts, as one JSON object on stdout.
//!
//! cargo run --release --example hw_probe -- --threads 1,2,4,8 [--mib 64] [--repeats 5]
//!
//! Triad: every thread owns three `f64` arrays of `--mib` MiB each and computes
//! `a[i] = b[i] + s * c[i]`. Peak: every thread runs 16 independent accumulators updated
//! `acc = acc * m + a` (one multiply and one add, never fused, like the crate's kernels).
//! Both report the best of `--repeats` after a warm-up, summed over all threads.
use std::hint::black_box;
use std::sync::Barrier;
use std::time::{Duration, Instant};

const PEAK_SECONDS: f64 = 0.3;
const PEAK_CHUNK: u64 = 100_000;
const ACCUMULATORS: usize = 16;
const MAX_TOTAL_MIB: usize = 4096;

struct Args {
    threads: Vec<usize>,
    mib: usize,
    repeats: usize,
}

fn parse_args(args: &[String]) -> Result<Args, String> {
    let mut threads = Vec::new();
    let (mut mib, mut repeats) = (64usize, 5usize);
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let value = it.next().ok_or_else(|| format!("{flag} needs a value"))?;
        let number = |text: &str| -> Result<usize, String> {
            match text.parse::<usize>() {
                Ok(n) if n > 0 => Ok(n),
                _ => Err(format!("{flag}: {text:?} is not a positive integer")),
            }
        };
        match flag.as_str() {
            "--threads" => {
                threads = value.split(',').map(number).collect::<Result<_, _>>()?;
            }
            "--mib" => mib = number(value)?,
            "--repeats" => repeats = number(value)?,
            _ => return Err(format!("unknown flag {flag}")),
        }
    }
    if threads.is_empty() {
        return Err("give --threads, e.g. --threads 1,2,4,8".to_string());
    }
    let mut seen = Vec::new();
    threads.retain(|t| {
        let new = !seen.contains(t);
        seen.push(*t);
        new
    });
    let max_threads = threads.iter().copied().max().unwrap_or(0);
    if 3 * mib * max_threads > MAX_TOTAL_MIB {
        return Err(format!(
            "3 arrays of {mib} MiB on {max_threads} threads need {} MiB, more than the {MAX_TOTAL_MIB} MiB allowed; lower --mib",
            3 * mib * max_threads
        ));
    }
    Ok(Args { threads, mib, repeats })
}

/// The slowest thread's time for each repeat: all threads start together, and the pass
/// is over when the last one finishes.
fn slowest_per_repeat(per_thread: Vec<Vec<Duration>>, repeats: usize) -> Vec<Duration> {
    (0..repeats)
        .map(|r| per_thread.iter().map(|times| times[r]).max().unwrap())
        .collect()
}

/// GB/s (1e9 bytes) of the triad over all threads, 24 bytes per element.
fn triad_gbs(threads: usize, mib: usize, repeats: usize) -> f64 {
    let len = mib * 1024 * 1024 / 8;
    let barrier = Barrier::new(threads);
    let per_thread: Vec<Vec<Duration>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|_| {
                let barrier = &barrier;
                scope.spawn(move || {
                    // First touch by the thread that will use the arrays.
                    let mut a = vec![0.0f64; len];
                    let b = vec![1.0f64; len];
                    let c = vec![2.0f64; len];
                    let s = black_box(3.0f64);
                    let mut times = Vec::with_capacity(repeats);
                    for pass in 0..=repeats {
                        barrier.wait();
                        let start = Instant::now();
                        for ((x, y), z) in a.iter_mut().zip(&b).zip(&c) {
                            *x = *y + s * *z;
                        }
                        let elapsed = start.elapsed();
                        black_box(&a);
                        if pass > 0 {
                            times.push(elapsed);
                        }
                    }
                    times
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let best = slowest_per_repeat(per_thread, repeats).into_iter().min().unwrap();
    let bytes = 24.0 * len as f64 * threads as f64;
    bytes / best.as_secs_f64() / 1e9
}

/// One thread's register-only loop for about `PEAK_SECONDS`: (flops done, time taken).
fn peak_loop() -> (f64, Duration) {
    let m = black_box(0.5f64);
    let a = black_box(0.25f64);
    let mut acc = [1.0f64; ACCUMULATORS];
    let start = Instant::now();
    let mut iterations = 0u64;
    while start.elapsed().as_secs_f64() < PEAK_SECONDS {
        for _ in 0..PEAK_CHUNK {
            for x in acc.iter_mut() {
                *x = *x * m + a;
            }
        }
        iterations += PEAK_CHUNK;
    }
    let elapsed = start.elapsed();
    black_box(acc);
    (2.0 * ACCUMULATORS as f64 * iterations as f64, elapsed)
}

/// GFLOP/s of the multiply-add loop summed over all threads (2 flops per update).
fn peak_gflops(threads: usize, repeats: usize) -> f64 {
    let mut best = 0.0f64;
    for pass in 0..=repeats {
        let barrier = Barrier::new(threads);
        let results: Vec<(f64, Duration)> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..threads)
                .map(|_| {
                    let barrier = &barrier;
                    scope.spawn(move || {
                        barrier.wait();
                        peak_loop()
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        // Each thread's own rate, summed: the threads ran together for the same time.
        let total: f64 = results.iter().map(|(flops, t)| flops / t.as_secs_f64() / 1e9).sum();
        if pass > 0 && total > best {
            best = total;
        }
    }
    best
}

fn json_map(entries: &[(usize, f64)]) -> String {
    let body: Vec<String> = entries.iter().map(|(t, v)| format!("\"{t}\": {v:.3}")).collect();
    format!("{{{}}}", body.join(", "))
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = match parse_args(&argv) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("hw_probe: {message}");
            std::process::exit(2);
        }
    };
    let triad: Vec<(usize, f64)> = args.threads.iter().map(|&t| (t, triad_gbs(t, args.mib, args.repeats))).collect();
    let peak: Vec<(usize, f64)> = args.threads.iter().map(|&t| (t, peak_gflops(t, args.repeats))).collect();
    println!(
        "{{\"triad_gbs\": {}, \"peak_gflops\": {}, \"params\": {{\"mib_per_array\": {}, \"repeats\": {}, \
\"peak_seconds\": {}, \"accumulators\": {}, \"note\": \"triad a[i] = b[i] + s*c[i] on f64, three arrays per thread, \
24 bytes per element (two reads and one write; write-allocate traffic is not counted), best of repeats after one \
warm-up, total over all threads; peak is {ACCUMULATORS} independent acc = acc*m + a chains, 2 flops per update, no fused \
multiply-add, best of repeats, total over all threads\"}}}}",
        json_map(&triad),
        json_map(&peak),
        args.mib,
        args.repeats,
        PEAK_SECONDS,
        ACCUMULATORS
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_flags_and_defaults() {
        let parsed = parse_args(&args(&["--threads", "1,2,4"])).unwrap();
        assert_eq!((parsed.threads, parsed.mib, parsed.repeats), (vec![1, 2, 4], 64, 5));
        let parsed = parse_args(&args(&["--threads", "2", "--mib", "8", "--repeats", "2"])).unwrap();
        assert_eq!((parsed.mib, parsed.repeats), (8, 2));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse_args(&args(&[])).is_err());
        assert!(parse_args(&args(&["--threads", "0"])).is_err());
        assert!(parse_args(&args(&["--threads", "1,x"])).is_err());
        assert!(parse_args(&args(&["--bogus", "1"])).is_err());
    }

    #[test]
    fn repeated_thread_counts_are_dropped_in_order() {
        let parsed = parse_args(&args(&["--threads", "4,1,4,2,1"])).unwrap();
        assert_eq!(parsed.threads, vec![4, 1, 2]);
    }

    #[test]
    fn refuses_more_than_4096_mib_in_total() {
        assert!(parse_args(&args(&["--threads", "8", "--mib", "171"])).is_err());
        assert!(parse_args(&args(&["--mib", "171", "--threads", "8"])).is_err());
        assert!(parse_args(&args(&["--threads", "8", "--mib", "128"])).is_ok());
    }

    #[test]
    fn json_map_is_keyed_by_thread_count() {
        assert_eq!(json_map(&[(1, 2.0), (4, 3.5)]), "{\"1\": 2.000, \"4\": 3.500}");
    }
}
