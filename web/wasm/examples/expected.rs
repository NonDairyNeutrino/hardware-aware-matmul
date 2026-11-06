//! Prints the expected hash for each matrix size as JSON, computed natively with
//! the naive level. The browser gates compare every level against these.

use hardware_aware_matmul::runner::StdRunner;
use naive_matmul_web::cases::run_hash;

fn main() {
    let sizes = [64_usize, 256, 512];
    let entries: Vec<String> = sizes
        .iter()
        .map(|&n| {
            let hash = run_hash(0, n, 1, 32, 64, &StdRunner).expect("valid case");
            format!("\"{n}\": \"{hash}\"")
        })
        .collect();
    println!("{{{}}}", entries.join(", "));
}
