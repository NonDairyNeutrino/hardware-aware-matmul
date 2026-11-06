//! Out-of-core demo for the `hardware_aware_matmul` library.
//!
//! Creates two n×n matrices on disk, multiplies them into a third file while
//! holding only a few small tiles in memory, and reports the memory saved.
//!
//! Usage: `cargo run --release --bin out_of_core [n]` (default n = 1024).

use std::env;
use std::error::Error;
use std::fs;
use std::num::NonZeroUsize;
use std::path::Path;
use std::process;
use std::thread;
use std::time::Instant;

use hardware_aware_matmul::streaming::{matmul_streaming, FileMatrix, StreamConfig, TileSource};

fn run(
    a_path: &Path,
    b_path: &Path,
    c_path: &Path,
    n: usize,
    config: &StreamConfig,
) -> Result<(), Box<dyn Error>> {
    let a = FileMatrix::create(a_path, n, n)?;
    a.fill_with(|i, j| ((i + 2 * j) % 7) as f64 - 3.0)?;
    let b = FileMatrix::create(b_path, n, n)?;
    b.fill_with(|i, j| ((3 * i + j) % 5) as f64 - 2.0)?;
    let c = FileMatrix::create(c_path, n, n)?;

    let start = Instant::now();
    matmul_streaming(&a, &b, &c, config)?;
    let elapsed = start.elapsed();

    let mut corner = [0.0];
    c.read_tile(0, 0, 1, 1, &mut corner)?;
    println!("{n}x{n} product streamed from disk in {elapsed:?}; c[(0, 0)] = {}", corner[0]);
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let n: usize = match env::args().nth(1) {
        Some(arg) => arg.parse()?,
        None => 1024,
    };
    let threads = thread::available_parallelism().unwrap_or(NonZeroUsize::MIN);
    let config = StreamConfig::new(threads).with_tile_shape(128, 128, 128);

    let matrices_bytes = 3 * n * n * std::mem::size_of::<f64>();
    println!(
        "all three matrices: {} KiB; tile buffers (upper bound): {} KiB",
        matrices_bytes / 1024,
        config.peak_buffer_bytes() / 1024
    );

    let dir = env::temp_dir();
    let id = process::id();
    let a_path = dir.join(format!("naive_matmul_a_{id}.bin"));
    let b_path = dir.join(format!("naive_matmul_b_{id}.bin"));
    let c_path = dir.join(format!("naive_matmul_c_{id}.bin"));

    let result = run(&a_path, &b_path, &c_path, n, &config);

    for path in [&a_path, &b_path, &c_path] {
        let _ = fs::remove_file(path);
    }
    result
}
