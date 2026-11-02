//! Times each level of the crate on the same problem.
//!
//! Multiplies two n×n matrices with every implementation in turn, checks that
//! all five produce bit-identical results, and prints how long each took.
//!
//! Usage: `cargo run --release [-- n [threads]]` (default n = 512, and one
//! thread per available core).
//!
//! Build with `--release`: unoptimised builds say nothing useful about the
//! differences between the levels. To let the SIMD level use the widest vector
//! instructions your CPU offers, build with
//! `RUSTFLAGS="-C target-cpu=native"`.

use std::env;
use std::error::Error;
use std::num::NonZeroUsize;
use std::thread;
use std::time::{Duration, Instant};

use naive_matmul::streaming::{matmul_streaming, MemorySink, StreamConfig};
use naive_matmul::{cache_friendly, naive, simd, threaded, Matrix};

/// Runs `f` once and returns its result with the elapsed wall-clock time.
fn time<T>(f: impl FnOnce() -> T) -> (T, Duration) {
    let start = Instant::now();
    let result = f();
    (result, start.elapsed())
}

/// Prints one row of the results table.
fn report(level: &str, elapsed: Duration, previous: Option<Duration>, baseline: Duration) {
    let versus_previous = match previous {
        Some(previous) => format!("{:>6.2}x", previous.as_secs_f64() / elapsed.as_secs_f64()),
        None => "     -".to_string(),
    };
    let versus_naive = baseline.as_secs_f64() / elapsed.as_secs_f64();
    println!(
        "{level:<28} {:>10.1?}  {versus_previous:>10}  {versus_naive:>9.2}x",
        elapsed
    );
}

/// Returns an error unless `candidate` equals `reference` exactly.
fn require_identical(level: &str, candidate: &Matrix, reference: &Matrix) -> Result<(), String> {
    if candidate == reference {
        Ok(())
    } else {
        Err(format!("{level} produced a different result from the naive level"))
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let n: usize = match env::args().nth(1) {
        Some(arg) => arg.parse()?,
        None => 512,
    };
    let threads = match env::args().nth(2) {
        Some(arg) => NonZeroUsize::new(arg.parse()?).ok_or("threads must be non-zero")?,
        None => thread::available_parallelism().unwrap_or(NonZeroUsize::MIN),
    };

    // Small integer entries keep every sum exact, so "identical" is meaningful.
    let a = Matrix::from_fn(n, n, |i, j| ((i + 2 * j) % 7) as f64 - 3.0);
    let b = Matrix::from_fn(n, n, |i, j| ((3 * i + j) % 5) as f64 - 2.0);

    let (mr, nr) = simd::micro_tile_shape();
    println!("{n}x{n} times {n}x{n}, {threads} thread(s) where applicable");
    println!(
        "SIMD level compiled for: {} (micro-tile {mr}x{nr})\n",
        simd::target_vector_isa()
    );
    println!(
        "{:<28} {:>10}  {:>10}  {:>10}",
        "level", "time", "vs prev", "vs naive"
    );

    let (reference, t_naive) = time(|| naive::matmul(&a, &b));
    let reference = reference?;
    report("0  naive", t_naive, None, t_naive);

    let (c, t_threaded) = time(|| threaded::matmul(&a, &b, threads));
    require_identical("threaded", &c?, &reference)?;
    report("1  + threads", t_threaded, Some(t_naive), t_naive);

    let (c, t_cache) = time(|| cache_friendly::matmul(&a, &b, threads));
    require_identical("cache_friendly", &c?, &reference)?;
    report("2  + cache friendliness", t_cache, Some(t_threaded), t_naive);

    let (c, t_simd) = time(|| simd::matmul(&a, &b, threads));
    require_identical("simd", &c?, &reference)?;
    report("3  + SIMD micro-kernel", t_simd, Some(t_cache), t_naive);

    // Level 4 with in-memory matrices: tiles are chosen small enough that there
    // are plenty of them for every thread to claim.
    let config = StreamConfig::new(threads).with_tile_shape(128, 128, 128);
    let sink = MemorySink::new(n, n);
    let (result, t_streaming) = time(|| matmul_streaming(&a, &b, &sink, &config));
    result?;
    require_identical("streaming", &sink.into_matrix(), &reference)?;
    report("4  + streaming", t_streaming, Some(t_simd), t_naive);

    println!(
        "\nLevel 4 is not meant to be faster on matrices that fit in memory: it copies\n\
         tiles into small buffers. Its purpose is bounded memory ({} KiB of tile\n\
         buffers here, whatever n is), which is what lets it work on data from disk.",
        config.peak_buffer_bytes() / 1024
    );
    Ok(())
}
