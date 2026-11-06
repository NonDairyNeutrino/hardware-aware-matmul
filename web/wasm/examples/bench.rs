//! Times each level natively and prints the measurements as JSON.
//!
//! The reference run's native half (`web/dev/bench-reference.sh`). It uses the same
//! operands, the same level entry points and the same cache blocks and tile shape as the
//! browser runs, builds the operands once per matrix size, and times the multiplication
//! alone with `Instant` (the hash is computed afterwards).
//!
//! usage: `cargo run --release --example bench -- [--sizes 512,1024] [--threads 1,2,4,8]
//! [--repeats 5] [--warmup 1]`. Thread counts above the machine's cores are dropped.
//! Level 0 is single-threaded, so it is measured once per size, with 1 thread.

use std::env;
use std::time::Instant;

use hardware_aware_matmul::runner::StdRunner;
use hardware_aware_matmul::simd::{micro_tile_shape, target_vector_isa};
use hardware_aware_matmul_web::cases::Bench;

/// The cache blocks (`k`, `j`) and the level 4 output tile of every measurement; they
/// are the crate defaults and what the browser runs use.
const BLOCK: (usize, usize) = (32, 64);
const TILE: (usize, usize, usize) = (128, 128, 128);

fn list(args: &[String], name: &str, default: &[usize]) -> Vec<usize> {
    match args.iter().position(|a| a == name) {
        Some(i) => args
            .get(i + 1)
            .unwrap_or_else(|| panic!("{name} needs a value"))
            .split(',')
            .map(|v| v.trim().parse().unwrap_or_else(|_| panic!("{name}: not a number: {v}")))
            .collect(),
        None => default.to_vec(),
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let sizes = list(&args, "--sizes", &[512, 1024]);
    let repeats = list(&args, "--repeats", &[5])[0];
    let warmup = list(&args, "--warmup", &[1])[0];
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let threads: Vec<usize> =
        list(&args, "--threads", &[1, 2, 4, 8]).into_iter().filter(|&t| t <= cores).collect();
    assert!(repeats >= 1 && !threads.is_empty(), "need at least one repeat and one thread count");

    let mut bench = Bench::new();
    let mut runs = Vec::new();
    for &n in &sizes {
        bench.prepare(n).expect("valid size");
        for level in 0..=4_u32 {
            let counts: Vec<usize> = if level == 0 { vec![1] } else { threads.clone() };
            for &t in &counts {
                let mut run = || {
                    bench.multiply(level, t, BLOCK.0, BLOCK.1, TILE, &StdRunner).expect("valid case");
                };
                for _ in 0..warmup {
                    run();
                }
                let mut times = Vec::with_capacity(repeats);
                for _ in 0..repeats {
                    let started = Instant::now();
                    run();
                    times.push(started.elapsed().as_secs_f64() * 1000.0);
                }
                let hash = bench.hash().expect("a result");
                let times: Vec<String> = times.iter().map(|ms| format!("{ms:.4}")).collect();
                runs.push(format!(
                    "{{\"level\":{level},\"n\":{n},\"threads\":{t},\"times_ms\":[{}],\"hash\":\"{hash}\"}}",
                    times.join(",")
                ));
                eprintln!("level {level} n {n} threads {t}: done");
            }
        }
    }
    let (mr, nr) = micro_tile_shape();
    println!(
        "{{\"kind\":\"native\",\"isa\":\"{}\",\"micro_tile\":[{mr},{nr}],\"cores\":{cores},\
         \"parameters\":{{\"sizes\":{sizes:?},\"threads\":{threads:?},\"repeats\":{repeats},\
         \"warmup\":{warmup},\"block\":[{},{}],\"tile\":[{},{},{}]}},\"runs\":[{}]}}",
        target_vector_isa(),
        BLOCK.0,
        BLOCK.1,
        TILE.0,
        TILE.1,
        TILE.2,
        runs.join(",")
    );
}
