//! Runs one level on one problem, and nothing else, so that a tool that counts events
//! for a whole process (such as `perf stat`) can attribute them to that level.
//!
//! cargo run --release --example level_once -- <level> <n> <threads> <reps>
//!
//! `<level>` is a module name (`naive`, `threaded`, `cache_friendly`, `simd`, `packed`,
//! `streaming`) or `none`. `none` builds the operands and exits, and measures the set-up
//! that every other run also pays, so a caller can subtract it. The product is computed
//! `<reps>` times, and one checksum of the last result goes to stdout: it keeps the work
//! from being optimised away and lets a caller check that two levels agreed.
//!
//! The operands are the ones the `compare` binary uses. `web/dev/perf_counters.py` drives
//! this example under `perf stat`.
use std::env;
use std::error::Error;
use std::num::NonZeroUsize;

use hardware_aware_matmul::{cache_friendly, naive, packed, simd, streaming, threaded, Matrix};

const LEVELS: [&str; 6] = ["naive", "threaded", "cache_friendly", "simd", "packed", "streaming"];

fn usage() -> String {
    format!(
        "usage: level_once <level> <n> <threads> <reps>\n  level: none, {}",
        LEVELS.join(", ")
    )
}

fn parse(text: &str, what: &str) -> Result<usize, String> {
    match text.parse::<usize>() {
        Ok(v) if v > 0 => Ok(v),
        _ => Err(format!("{what}: {text:?} is not a positive integer\n{}", usage())),
    }
}

/// Order-sensitive digest of the exact bits of `c`.
fn checksum(c: &Matrix) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for x in c.as_slice() {
        hash = (hash ^ x.to_bits()).wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 4 {
        return Err(usage().into());
    }
    let level = args[0].as_str();
    if level != "none" && !LEVELS.contains(&level) {
        return Err(format!("unknown level {level:?}\n{}", usage()).into());
    }
    let n = parse(&args[1], "n")?;
    let threads = NonZeroUsize::new(parse(&args[2], "threads")?).expect("checked positive");
    let reps = parse(&args[3], "reps")?;

    let a = Matrix::from_fn(n, n, |i, j| ((i + 2 * j) % 7) as f64 - 3.0);
    let b = Matrix::from_fn(n, n, |i, j| ((3 * i + j) % 5) as f64 - 2.0);
    if level == "none" {
        println!("{:016x}", checksum(&a) ^ checksum(&b));
        return Ok(());
    }

    let mut last = None;
    for _ in 0..reps {
        last = Some(match level {
            "naive" => naive::matmul(&a, &b)?,
            "threaded" => threaded::matmul(&a, &b, threads)?,
            "cache_friendly" => cache_friendly::matmul(&a, &b, threads)?,
            "simd" => simd::matmul(&a, &b, threads)?,
            "packed" => packed::matmul(&a, &b, threads)?,
            _ => streaming::matmul(&a, &b, threads)?,
        });
    }
    println!("{:016x}", checksum(&last.expect("reps is positive")));
    Ok(())
}
