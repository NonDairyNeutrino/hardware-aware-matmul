# Stage P2a: The Reference Run (the Results Data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A`, `git add .` or `git add <directory>`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Produce the data the paper's Results section cites: first enable 128-bit SIMD in the wasm builds (so the browser's level 3 really vectorises), then a reference run that times every level natively and in headless Firefox (the lite and the threaded wasm builds) and writes `web/site/src/data/results.json`, refusing to write it unless every run, native and browser, produced the same result hash.

**Architecture:** `cases.rs` in the wasm wrapper gains `Bench` (prepared operands plus the last result), so the timer covers the multiplication alone. The wrapper exports it to the browser (`bench_prepare`, `bench_multiply`, `bench_hash`, in both builds); a native example times the same cases with `Instant`; a bench page and workers time them in Firefox with `performance.now()`; `web/dev/results.py` merges the three reports with the recorded environment, checks the invariant and writes the file; `web/dev/bench-reference.sh` runs all of it. The wasm builds get `+simd128` first, and the step-through gate pins the reported instruction set. The last task is the first full-size run, whose output is committed.

**Tech Stack:** Rust (stable for the lite build, the pinned `nightly-2025-11-15` for `web/wasm`), `wasm-bindgen` `=0.2.130`, headless Firefox, Python 3 standard library only (no new dependencies anywhere).

**Spec:** `docs/superpowers/specs/2026-11-06-results-design.md` (plan P2a of P2a to P2c).

## Global Constraints

- The core crate `hardware_aware_matmul` is not modified. The wrapper adds **no dependencies** (the JSON is written by hand; Python uses only the standard library).
- The existing gate functions (`run_case`, `run_hash`) and their pinned hashes are unchanged; the gates `lite`, `g2` and the rest still pass. Enabling `simd128` must not change any result bit (it vectorises the same operations in the same order; no fused multiply-add).
- Every wasm export validates its arguments and returns an error: the threaded build is `panic=abort`.
- The timed region is the multiplication alone. Operands are built once per size beforehand; the hash is read afterwards.
- **The invariant is part of the data:** for each matrix size, every level, thread count, native and browser run must have the same result hash, and `results.py` refuses to write a file in which they do not.
- Benchmark numbers appear only as generated data (`results.json`); never type a measured number into prose, code or a commit message other than as the file itself.
- The core crate stays `#![forbid(unsafe_code)]`, MSRV 1.73; `wasm-bindgen` stays `=0.2.130`.
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- Rust: stable, `nightly-2025-11-15` (with `rust-src` and the `wasm32-unknown-unknown` target); the `wasm-bindgen` CLI at `$HOME/.cargo/bin/wasm-bindgen`. In every shell that builds or runs: `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`. Docker with `node:latest` (only the YAML check in Task 8 uses it; do not pull anything). Firefox 159 for the headless runs.
- **Port 8765:** the browser runs serve on it. **Before any browser run check nothing listens there** (`ss -ltnp | grep 8765`); a stray server makes a run fail with "page never reported". Kill only processes you started, by PID (never `pkill -f`).
- Wasm builds take 30 to 60 seconds cold; give shell commands generous timeouts (up to 600000 ms).

---

### Task 1: Enable simd128 in both wasm builds

Until now the browser's level 3 ran as scalar code: the build reported its instruction set as "none (scalar code)", because WebAssembly's 128-bit SIMD (`simd128`) was not enabled. Both wasm builds now pass `-C target-feature=+simd128`, so the compiler can vectorise the level 3 micro-kernel to wasm vector instructions, exactly as it does natively with SSE2. It vectorises the same multiplications and additions in the same order (no fused multiply-add), so every result bit is unchanged: the gates compare against native hashes and must still pass. The module now needs a browser with WebAssembly SIMD (Firefox 89, Chrome 91, Safari 16.4 and later: every current browser). The step-through gate pins the reported instruction set to `WASM SIMD128`, so dropping the flag later fails a gate instead of quietly changing what the Results measure.

**Files:**
- Modify: `web/wasm/build.sh`, `web/wasm/build-lite.sh`, `web/dev/check_report.py`

**Interfaces:**
- Changes: `env_info()` reports `"isa":"WASM SIMD128"` from both builds (the micro-tile stays 4 x 4).

- [ ] **Step 1: Add the flag to both builds and pin it in the gate**


In `web/wasm/build.sh`, replace:

````text
TARGET_DIR=${CARGO_TARGET_DIR:-$PWD/target}

# Atomics, shared memory and the TLS exports that wasm-bindgen-rayon needs. They
# live here, not in .cargo/config.toml, so the stable single-threaded build and
# native `cargo test` never see them. RUSTFLAGS replaces any other rustflags.
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--import-memory"
````

with:

````text
TARGET_DIR=${CARGO_TARGET_DIR:-$PWD/target}

# Atomics, shared memory and the TLS exports that wasm-bindgen-rayon needs, and 128-bit
# SIMD (every current browser has it), which lets the level 3 micro-kernel be
# auto-vectorised to wasm vector instructions. They live here, not in
# .cargo/config.toml, so native `cargo test` never sees them. RUSTFLAGS replaces any
# other rustflags.
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+simd128"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--import-memory"
````


In `web/wasm/build-lite.sh`, replace:

````text
TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}-lite"
# `+stable` overrides the nightly pinned for this directory by rust-toolchain.toml.
cargo +stable build --release --target wasm32-unknown-unknown --target-dir "$TARGET_DIR"
rm -rf pkg-lite
"$WASM_BINDGEN" --target web --out-dir pkg-lite \
````

with:

````text
TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}-lite"
# `+stable` overrides the nightly pinned for this directory by rust-toolchain.toml.
# 128-bit SIMD (every current browser has it) lets the level 3 micro-kernel be
# auto-vectorised to wasm vector instructions. RUSTFLAGS replaces any other rustflags.
RUSTFLAGS="-C target-feature=+simd128" \
  cargo +stable build --release --target wasm32-unknown-unknown --target-dir "$TARGET_DIR"
rm -rf pkg-lite
"$WASM_BINDGEN" --target web --out-dir pkg-lite \
````


In `web/dev/check_report.py`, replace:

````text
        ok_tile = isinstance(env.get("micro_tile"), list) and len(env["micro_tile"]) == 2 and all(
            isinstance(x, int) and x > 0 for x in env["micro_tile"])
        if not (env.get("isa") and ok_tile and env.get("threads") is False):
            problems.append("level %d: bad env %r (the lite build has no threads)" % (level, env))
    one = elements[1]
    # `row_block_plan`'s own documented example: 10 rows over 4 threads.
````

with:

````text
        ok_tile = isinstance(env.get("micro_tile"), list) and len(env["micro_tile"]) == 2 and all(
            isinstance(x, int) and x > 0 for x in env["micro_tile"])
        if not (env.get("isa") == "WASM SIMD128" and ok_tile and env.get("threads") is False):
            problems.append("level %d: bad env %r (the lite build has no threads and is built with simd128)" % (level, env))
    one = elements[1]
    # `row_block_plan`'s own documented example: 10 rows over 4 threads.
````


- [ ] **Step 2: Build both modules and run the gates**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"` and port 8765 free (`ss -ltnp | grep 8765`):

```bash
./build-lite.sh 2>&1 | tail -1                    # Finished ...
./gate.sh lite --no-build 2>&1 | grep -E "GATE|isolated"       # "isolated": false, GATE LITE: PASS
./gate.sh g2 2>&1 | grep GATE                     # builds the threaded module, then GATE G2: PASS
```

From `web/site` (a full build: both modules, the site, then the gate on the production build):

```bash
./gate-c2.sh 2>&1 | grep -E "page|check-dist|GATE|FAIL|REFUS"    # 9 page(s) built, check-dist: PASS (9 pages), GATE STEPTHROUGH: PASS
```

Every gate compares the browser's results with the native hashes, so a `PASS` here shows that `simd128` changed no result bit. If a gate reports a hash mismatch, stop and report BLOCKED: that would mean the vectorisation changed the arithmetic.

- [ ] **Step 3: Check that the gate notices a build without simd128**

From the repository root, after Step 2 (this edits a copy of the report, not the sources):

```bash
python3 -I - <<'EOF'
import json, subprocess
r = json.load(open('web/wasm/target/c2-report.json'))
print(sorted({e['env']['isa'] for e in r['elements']}))
for e in r['elements']:
    e['env']['isa'] = 'none (scalar code)'
json.dump(r, open('web/wasm/target/c2-scalar.json', 'w'))
p = subprocess.run(['python3', '-I', 'web/dev/check_report.py', 'stepthrough', 'web/wasm/target/c2-scalar.json'], capture_output=True, text=True)
print(p.returncode, [l for l in p.stdout.splitlines() if 'simd128' in l][:1])
EOF
```

Expected: `['WASM SIMD128']` (what the real report says) and then `1 [...]` with a line mentioning `simd128` (the gate fails when the instruction set is scalar).

- [ ] **Step 4: Commit**

```bash
git add web/wasm/build.sh web/wasm/build-lite.sh web/dev/check_report.py
git commit -m "enable simd128 in both wasm builds"
```

---

### Task 2: `Bench`: prepared operands, the multiplication timed alone

`cases::run_hash` builds the operands, multiplies and hashes in one call, which is right for a correctness gate and wrong for a benchmark. This task splits it: `multiply` (a validated level dispatch over given matrices, taking the level 4 tile shape as a parameter) and `Bench`, which prepares the operands once, multiplies as often as asked and hashes the stored result afterwards. `run_hash` keeps its signature and behaviour (it now calls `multiply`), so the gates and their pinned hashes are unchanged.

**Files:**
- Modify: `web/wasm/src/cases.rs`

**Interfaces:**
- Produces: `cases::{MAX_N, GATE_TILE, multiply, Bench}`; `Bench::{new, prepare(n), multiply(level, threads, tile_k, tile_j, tile, runner), hash()}`, all returning `Result<_, String>` and never panicking on bad arguments.

- [ ] **Step 1: Write the failing tests**

Add three tests to the `tests` module, just before `hash_is_stable`:


In `web/wasm/src/cases.rs`, replace:

````text

    #[test]
    fn hash_is_stable() {
        // These pin the generator and the hash so the browser and native sides
````

with:

````text

    #[test]
    fn bench_gives_the_same_hash_as_run_hash_for_every_level() {
        let mut bench = Bench::new();
        bench.prepare(48).unwrap();
        for level in 0..=4 {
            for threads in [1, 3] {
                bench.multiply(level, threads, 32, 64, GATE_TILE, &StdRunner).unwrap();
                let expected = run_hash(level, 48, threads, 32, 64, &StdRunner).unwrap();
                assert_eq!(bench.hash().unwrap(), expected, "level {level}, {threads} threads");
            }
        }
    }

    #[test]
    fn the_level_four_tile_shape_does_not_change_the_hash() {
        let mut bench = Bench::new();
        bench.prepare(40).unwrap();
        bench.multiply(0, 1, 32, 64, GATE_TILE, &StdRunner).unwrap();
        let expected = bench.hash().unwrap();
        for tile in [(1, 1, 1), (7, 5, 3), (128, 128, 128)] {
            bench.multiply(4, 2, 32, 64, tile, &StdRunner).unwrap();
            assert_eq!(bench.hash().unwrap(), expected, "tile {tile:?}");
        }
    }

    #[test]
    fn bench_rejects_misuse_instead_of_panicking() {
        let mut bench = Bench::new();
        assert!(bench.multiply(1, 1, 32, 64, GATE_TILE, &StdRunner).is_err(), "before prepare");
        assert!(bench.hash().is_err(), "before multiply");
        assert!(bench.prepare(0).is_err());
        assert!(bench.prepare(MAX_N + 1).is_err());
        bench.prepare(8).unwrap();
        assert!(bench.hash().is_err(), "prepare drops the old result");
        assert!(bench.multiply(1, 0, 32, 64, GATE_TILE, &StdRunner).is_err());
        assert!(bench.multiply(2, 1, 0, 64, GATE_TILE, &StdRunner).is_err());
        assert!(bench.multiply(3, 1, 32, 0, GATE_TILE, &StdRunner).is_err());
        assert!(bench.multiply(4, 1, 32, 64, (0, 64, 64), &StdRunner).is_err());
        assert!(bench.multiply(4, 1, 32, 64, (64, 64, 0), &StdRunner).is_err());
        assert!(bench.multiply(5, 1, 32, 64, GATE_TILE, &StdRunner).is_err());
    }

    #[test]
    fn hash_is_stable() {
        // These pin the generator and the hash so the browser and native sides
````

- [ ] **Step 2: Run them to see the failure**

From `web/wasm`: `cargo test 2>&1 | grep -E "^error" | head -3`
Expected: errors such as ``failed to resolve: use of undeclared type `Bench` `` and ``cannot find value `GATE_TILE` in this scope``.

- [ ] **Step 3: Implement `multiply` and `Bench`**


In `web/wasm/src/cases.rs`, replace:

````text
}

/// Multiplies two `n × n` rough matrices at `level` (0 = naive, 1 = threaded,
/// 2 = cache_friendly, 3 = simd, 4 = streaming with 64 × 64 × 64 tiles) and
````

with:

````text
}

/// The largest matrix edge the wasm wrapper accepts.
pub const MAX_N: usize = 2048;

/// The output-tile shape (rows, columns, depth) level 4 uses in the gate cases.
pub const GATE_TILE: (usize, usize, usize) = (64, 64, 64);

/// Multiplies `a` by `b` at `level` (0 = naive, 1 = threaded, 2 = cache_friendly,
/// 3 = simd, 4 = streaming with the output tiles of the given `tile` shape).
///
/// Levels 1 to 4 run their work on `runner`; `tile_k` and `tile_j` are the cache
/// blocks of levels 2 to 4. Every argument is validated, so a bad one is an error and
/// never a panic.
#[allow(clippy::too_many_arguments)]
pub fn multiply<R: Runner + ?Sized>(
    level: u32,
    a: &Matrix,
    b: &Matrix,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
    tile: (usize, usize, usize),
    runner: &R,
) -> Result<Matrix, String> {
    let threads = NonZeroUsize::new(threads).ok_or("threads must be at least 1")?;
    let tile_k = NonZeroUsize::new(tile_k).ok_or("tile_k must be at least 1")?;
    let tile_j = NonZeroUsize::new(tile_j).ok_or("tile_j must be at least 1")?;
    if tile.0 == 0 || tile.1 == 0 || tile.2 == 0 {
        return Err("the tile shape must be at least 1 in every dimension".to_string());
    }
    let block = BlockConfig::new(tile_k, tile_j);
    match level {
        0 => naive::matmul(a, b).map_err(|e| e.to_string()),
        1 => threaded::matmul_with_runner(a, b, threads, runner).map_err(|e| e.to_string()),
        2 => cache_friendly::matmul_with_runner(a, b, threads, &block, runner)
            .map_err(|e| e.to_string()),
        3 => simd::matmul_with_runner(a, b, threads, &block, runner).map_err(|e| e.to_string()),
        4 => {
            let config = StreamConfig::new(threads)
                .with_tile_shape(tile.0, tile.1, tile.2)
                .with_block_config(block);
            let sink = MemorySink::new(a.rows(), b.cols());
            streaming::matmul_streaming_with_runner(a, b, &sink, &config, runner)
                .map_err(|e| e.to_string())?;
            Ok(sink.into_matrix())
        }
        other => Err(format!("level must be 0 to 4, got {other}")),
    }
}

/// Multiplies two `n × n` rough matrices at `level` (0 = naive, 1 = threaded,
/// 2 = cache_friendly, 3 = simd, 4 = streaming with 64 × 64 × 64 tiles) and
````

In `web/wasm/src/cases.rs`, replace:

````text
    runner: &R,
) -> Result<String, String> {
    let threads = NonZeroUsize::new(threads).ok_or("threads must be at least 1")?;
    let tile_k = NonZeroUsize::new(tile_k).ok_or("tile_k must be at least 1")?;
    let tile_j = NonZeroUsize::new(tile_j).ok_or("tile_j must be at least 1")?;
    if n == 0 || n > 2048 {
        return Err(format!("n must be in 1..=2048, got {n}"));
    }
    let block = BlockConfig::new(tile_k, tile_j);
    let (a, b) = rough_operands(n, n, n);
    let c = match level {
        0 => naive::matmul(&a, &b).map_err(|e| e.to_string())?,
        1 => threaded::matmul_with_runner(&a, &b, threads, runner).map_err(|e| e.to_string())?,
        2 => cache_friendly::matmul_with_runner(&a, &b, threads, &block, runner)
            .map_err(|e| e.to_string())?,
        3 => simd::matmul_with_runner(&a, &b, threads, &block, runner).map_err(|e| e.to_string())?,
        4 => {
            let config = StreamConfig::new(threads)
                .with_tile_shape(64, 64, 64)
                .with_block_config(block);
            let sink = MemorySink::new(n, n);
            streaming::matmul_streaming_with_runner(&a, &b, &sink, &config, runner)
                .map_err(|e| e.to_string())?;
            sink.into_matrix()
        }
        other => return Err(format!("level must be 0 to 4, got {other}")),
    };
    Ok(bit_hash(&c))
}
````

with:

````text
    runner: &R,
) -> Result<String, String> {
    if n == 0 || n > MAX_N {
        return Err(format!("n must be in 1..={MAX_N}, got {n}"));
    }
    let (a, b) = rough_operands(n, n, n);
    let c = multiply(level, &a, &b, threads, tile_k, tile_j, GATE_TILE, runner)?;
    Ok(bit_hash(&c))
}

/// Prepared operands and the last result, for timing the multiplication alone.
///
/// A benchmark builds the operands once (`prepare`), times as many `multiply` calls as
/// it likes, and hashes the stored result afterwards (`hash`), so neither the operand
/// generation nor the hashing sits inside the timed region.
#[derive(Default)]
pub struct Bench {
    operands: Option<(Matrix, Matrix)>,
    result: Option<Matrix>,
}

impl Bench {
    /// An empty bench: call [`Bench::prepare`] before multiplying.
    pub fn new() -> Self {
        Self::default()
    }

    /// Builds the `n × n` rough operands (`n` in `1..=MAX_N`) and drops any earlier
    /// result.
    pub fn prepare(&mut self, n: usize) -> Result<(), String> {
        if n == 0 || n > MAX_N {
            return Err(format!("n must be in 1..={MAX_N}, got {n}"));
        }
        self.result = None;
        self.operands = Some(rough_operands(n, n, n));
        Ok(())
    }

    /// Multiplies the prepared operands and stores the result.
    pub fn multiply<R: Runner + ?Sized>(
        &mut self,
        level: u32,
        threads: usize,
        tile_k: usize,
        tile_j: usize,
        tile: (usize, usize, usize),
        runner: &R,
    ) -> Result<(), String> {
        let (a, b) = self.operands.as_ref().ok_or("call prepare before multiply")?;
        self.result = Some(multiply(level, a, b, threads, tile_k, tile_j, tile, runner)?);
        Ok(())
    }

    /// The bit hash of the stored result.
    pub fn hash(&self) -> Result<String, String> {
        self.result.as_ref().map(bit_hash).ok_or_else(|| "call multiply before hash".to_string())
    }
}
````

- [ ] **Step 4: Run the tests and the stable wasm build**

From `web/wasm`:

```bash
cargo test 2>&1 | grep -E "^(warning|error)|test result" | head -3     # 18 passed, no warnings
cargo test --features threads 2>&1 | grep "test result" | head -1      # 20 passed
cargo +stable build --release --target wasm32-unknown-unknown --target-dir target-lite 2>&1 | grep -E "^(warning|error)|Finished"   # Finished, no warnings
```

The existing tests, including the pinned-hash test `hash_is_stable`, must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add web/wasm/src/cases.rs
git commit -m "add a Bench type that times the multiplication alone"
```

---

### Task 3: Expose the bench API in the wasm wrapper

Three exports, in both builds, over a thread-local `Bench`: `bench_prepare(n)`, `bench_multiply(level, threads, tile_k, tile_j, tile_rows, tile_cols, tile_depth)` (the call a page times) and `bench_hash()`. The threaded build runs the multiplication on the rayon pool, the lite build on the calling thread. Only the calling thread touches the state; the rayon workers never do.

**Files:**
- Modify: `web/wasm/src/lib.rs`

**Interfaces:**
- Consumes: `cases::Bench` (Task 2).
- Produces (wasm exports): `bench_prepare(n: usize) -> Result<(), JsError>`, `bench_multiply(level: u32, threads: usize, tile_k: usize, tile_j: usize, tile_rows: usize, tile_cols: usize, tile_depth: usize) -> Result<(), JsError>`, `bench_hash() -> Result<String, JsError>`.

- [ ] **Step 1: Add the exports**


In `web/wasm/src/lib.rs`, replace:

````text
#[cfg(feature = "threads")]
use rayon::prelude::*;
use wasm_bindgen::prelude::*;
````

with:

````text
#[cfg(feature = "threads")]
use rayon::prelude::*;
use std::cell::RefCell;

use wasm_bindgen::prelude::*;
````

In `web/wasm/src/lib.rs`, replace:

````text
    plan::partition_plan_json(level, rows, inner, cols, threads, tile_rows, tile_cols, tile_depth)
        .map_err(|e| JsError::new(&e))
}
````

with:

````text
    plan::partition_plan_json(level, rows, inner, cols, threads, tile_rows, tile_cols, tile_depth)
        .map_err(|e| JsError::new(&e))
}

thread_local! {
    /// The prepared operands and last result of the benchmark API below. Only the calling
    /// thread touches it; the rayon workers of the threaded build never do.
    static BENCH: RefCell<cases::Bench> = RefCell::new(cases::Bench::new());
}

/// The runner the benchmark API uses: the rayon pool in the threaded build, the calling
/// thread in the lite build.
#[cfg(feature = "threads")]
fn bench_runner() -> RayonRunner {
    RayonRunner
}

#[cfg(not(feature = "threads"))]
fn bench_runner() -> InlineRunner {
    InlineRunner
}

/// Benchmark API, step 1: builds the `n × n` operands (`n` in 1 to 2048) so that the
/// timed calls do not include generating them.
#[wasm_bindgen]
pub fn bench_prepare(n: usize) -> Result<(), JsError> {
    BENCH.with(|bench| bench.borrow_mut().prepare(n)).map_err(|e| JsError::new(&e))
}

/// Benchmark API, step 2: multiplies the prepared operands at `level` (0 to 4) and keeps
/// the result. This is the call a page times. `tile_k`/`tile_j` are the cache blocks of
/// levels 2 to 4 and the three `tile_*` sizes the output tile of level 4.
#[wasm_bindgen]
pub fn bench_multiply(
    level: u32,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
    tile_rows: usize,
    tile_cols: usize,
    tile_depth: usize,
) -> Result<(), JsError> {
    let runner = bench_runner();
    BENCH
        .with(|bench| {
            bench.borrow_mut().multiply(
                level,
                threads,
                tile_k,
                tile_j,
                (tile_rows, tile_cols, tile_depth),
                &runner,
            )
        })
        .map_err(|e| JsError::new(&e))
}

/// Benchmark API, step 3: the bit hash of the last result, so a page can check that every
/// level gave the same answer without hashing inside the timed region.
#[wasm_bindgen]
pub fn bench_hash() -> Result<String, JsError> {
    BENCH.with(|bench| bench.borrow().hash()).map_err(|e| JsError::new(&e))
}
````

- [ ] **Step 2: Test and build both modules, and run the gates**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"` and port 8765 free:

```bash
cargo test 2>&1 | grep -E "^(warning|error)|test result" | head -3     # 18 passed, no warnings
cargo test --features threads 2>&1 | grep "test result" | head -1      # 20 passed
./gate.sh lite 2>&1 | grep -E "GATE|isolated"                          # "isolated": false, GATE LITE: PASS
./gate.sh g2 2>&1 | grep GATE                                          # builds the threaded module, then GATE G2: PASS
```

The new exports are compiled into both modules by these builds; the existing gates must be unaffected (their cases still use `run_case`).

- [ ] **Step 3: Commit**

```bash
git add web/wasm/src/lib.rs
git commit -m "expose the bench API in the wasm wrapper"
```

---

### Task 4: The native bench example

`examples/bench.rs` times every level natively and prints one JSON document: the same operands, level entry points, cache blocks (32, 64) and level 4 tile (128 x 128 x 128) as the browser runs, with `Instant` around `Bench::multiply` only, one discarded warm-up and N timed repeats per case, and the result hash read afterwards. Level 0 is single-threaded, so it is measured once per size; thread counts above the machine's cores are dropped. The record includes the SIMD level's instruction set and micro-tile, so the results say what was compiled.

**Files:**
- Create: `web/wasm/examples/bench.rs`

**Interfaces:**
- Produces: `cargo run --release --example bench -- [--sizes 512,1024] [--threads 1,2,4,8] [--repeats 5] [--warmup 1]` printing `{"kind":"native","isa":...,"micro_tile":[..],"cores":N,"parameters":{...},"runs":[{"level","n","threads","times_ms":[..],"hash"},...]}`; progress goes to stderr.

- [ ] **Step 1: Create the example**


Create `web/wasm/examples/bench.rs`:

````rust
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
````

- [ ] **Step 2: Run it small and check the output**

From `web/wasm`:

```bash
cargo run --release --example bench -- --sizes 64,128 --threads 1,2 --repeats 2 --warmup 1 2>/dev/null | python3 -I -c "
import json, sys
d = json.load(sys.stdin)
print(d['kind'], d['parameters']['sizes'], d['parameters']['threads'], len(d['runs']))
hashes = {}
for r in d['runs']:
    hashes.setdefault(r['n'], set()).add(r['hash'])
print({n: len(v) for n, v in sorted(hashes.items())}, sorted(hashes[64]))
"
```

Expected, exactly: `native [64, 128] [1, 2] 18` (two sizes, each with level 0 once and levels 1 to 4 for two thread counts: 2 x 9 runs) and `{64: 1, 128: 1} ['653a9b093a002dca']`: **one hash per size for every level and thread count**, and the size-64 hash is the value pinned in the gates (`hash_is_stable`). If it differs, stop and report BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add web/wasm/examples/bench.rs
git commit -m "add the native bench example"
```

---

### Task 5: The browser bench page and runner

The same matrix of cases in headless Firefox, for the lite and the threaded build: `bench-run.js` (shared: prepare once per size, warm up, time each repeat with `performance.now()` around `bench_multiply`, read the hash afterwards), one worker per build, `bench.html` (reads the parameters from the URL, starts the worker, posts the report) and `bench-browser.sh` (serves the page like the gates do and writes the report to a file). Both builds are served **with** the isolation headers: the lite build does not need them, but an isolated page gets Firefox's fine-grained timer, while a non-isolated page's `performance.now()` is rounded to about a millisecond, too coarse for the fastest cases (this was found when a first version produced `[1, 0]` ms timings). The threaded pool is `min(cores, 8)` threads and the thread counts above it are dropped.

**Files:**
- Create: `web/wasm/www/bench-run.js`, `web/wasm/www/bench-lite-worker.js`, `web/wasm/www/bench-threads-worker.js`, `web/wasm/www/bench.html`, `web/wasm/bench-browser.sh`

**Interfaces:**
- Consumes: the bench exports (Task 3); the generated `pkg-lite/` (`./build-lite.sh`) and `pkg/` (`./build.sh`, no-bundler).
- Produces: `bench-browser.sh lite|threads OUT.json` (env `SIZES`, `THREADS`, `REPEATS`, `WARMUP`, `PORT`, `TIMEOUT`), writing `{"kind":"browser-lite"|"browser-threads","ok":true,"isolated":..,"cores":..,"env":{..},"parameters":{..},"runs":[{"level","n","threads","times_ms":[..],"hash"},...]}` (plus `pool_threads` for the threaded build).

- [ ] **Step 1: Create the files**


Create `web/wasm/www/bench-run.js`:

````javascript
// The benchmark matrix of the reference run, over the wasm bench API: for each size the
// operands are prepared once, then every level and thread count is warmed up and timed
// `repeats` times with `performance.now()` around the multiplication alone. The result's
// hash is read afterwards, outside the timer.
// The cache blocks (32, 64) and the level 4 tile (128 x 128 x 128) are fixed, like the
// native bench example's.
export function runBench(api, { sizes, threads, repeats, warmup }) {
  const runs = [];
  for (const n of sizes) {
    api.bench_prepare(n);
    for (let level = 0; level <= 4; level += 1) {
      // Level 0 is single-threaded whatever the setting.
      for (const t of level === 0 ? [1] : threads) {
        const run = () => api.bench_multiply(level, t, 32, 64, 128, 128, 128);
        for (let i = 0; i < warmup; i += 1) run();
        const times = [];
        for (let i = 0; i < repeats; i += 1) {
          const started = performance.now();
          run();
          times.push(Number((performance.now() - started).toFixed(4)));
        }
        runs.push({ level, n, threads: t, times_ms: times, hash: api.bench_hash() });
      }
    }
  }
  return runs;
}
````


Create `web/wasm/www/bench-lite-worker.js`:

````javascript
// Runs the reference run's benchmark matrix on the lite (stable, single-threaded) build.
// The page posts { sizes, threads, repeats, warmup }.
import init, { bench_prepare, bench_multiply, bench_hash, env_info } from '../pkg-lite/hardware_aware_matmul_web.js';
import { runBench } from './bench-run.js';

self.onmessage = async (event) => {
  const params = event.data;
  const out = { kind: 'browser-lite', isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency, parameters: params };
  try {
    await init();
    out.env = JSON.parse(env_info());
    out.runs = runBench({ bench_prepare, bench_multiply, bench_hash }, params);
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
````


Create `web/wasm/www/bench-threads-worker.js`:

````javascript
// Runs the reference run's benchmark matrix on the threaded build, with a pool of
// `pool` threads. The page posts { sizes, threads, repeats, warmup, pool }.
import init, {
  initThreadPool,
  pool_threads,
  bench_prepare,
  bench_multiply,
  bench_hash,
  env_info,
} from '../pkg/hardware_aware_matmul_web.js';
import { runBench } from './bench-run.js';

self.onmessage = async (event) => {
  const params = event.data;
  const out = { kind: 'browser-threads', isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency, parameters: params };
  try {
    await init();
    await initThreadPool(params.pool);
    out.pool_threads = pool_threads();
    out.env = JSON.parse(env_info());
    out.runs = runBench({ bench_prepare, bench_multiply, bench_hash }, params);
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
````


Create `web/wasm/www/bench.html`:

````html
<!doctype html>
<meta charset="utf-8">
<title>bench</title>
<script type="module">
  // ?build=lite|threads&sizes=512,1024&threads=1,2,4,8&repeats=5&warmup=1
  const q = new URLSearchParams(location.search);
  const list = (name, fallback) => (q.get(name) || fallback).split(',').map(Number);
  const build = q.get('build');
  const cores = navigator.hardwareConcurrency;
  const pool = Math.min(cores, 8);
  const params = {
    sizes: list('sizes', '512,1024'),
    threads: list('threads', '1').filter((t) => build !== 'threads' || t <= pool),
    repeats: Number(q.get('repeats') || 5),
    warmup: Number(q.get('warmup') || 1),
    pool,
  };
  if (build !== 'lite' && build !== 'threads') throw new Error('build must be lite or threads');
  const worker = new Worker(build === 'lite' ? './bench-lite-worker.js' : './bench-threads-worker.js', { type: 'module' });
  const result = await new Promise((resolve) => {
    worker.onmessage = (event) => resolve(event.data);
    worker.onerror = (event) => resolve({ kind: 'browser-' + build, ok: false, error: 'worker error: ' + event.message });
    worker.postMessage(params);
  });
  await fetch('/report', { method: 'POST', body: JSON.stringify(result) });
  document.title = result.ok ? 'done' : 'failed';
</script>
````


Create `web/wasm/bench-browser.sh` (then `chmod +x`):

````bash
#!/usr/bin/env bash
# Runs the benchmark matrix in headless Firefox for one build and writes the page's JSON
# report to OUT. Part of the reference run (web/dev/bench-reference.sh).
# usage: bench-browser.sh lite|threads OUT.json
#   lite     the stable single-threaded build (pkg-lite/)
#   threads  the threaded build (pkg/, built with the no-bundler feature), with a pool of
#            min(cores, 8) threads
# Both are served WITH the isolation headers: the lite build does not need them, but an
# isolated page gets Firefox's fine-grained timer (a non-isolated page's performance.now()
# is rounded to about a millisecond, too coarse for the fastest cases).
# env: SIZES (default "512 1024"), THREADS (default "1 2 4 8"; the lite build always uses
#      "1"), REPEATS (5), WARMUP (1), PORT (8765), TIMEOUT seconds (default 3600)
# Exits non-zero unless the page reports ok.
set -euo pipefail
cd "$(dirname "$0")"
BUILD=${1:?usage: bench-browser.sh lite|threads OUT.json}
OUT=${2:?usage: bench-browser.sh lite|threads OUT.json}
case "$BUILD" in
  lite) PKG=pkg-lite; THREADS_LIST=1 ;;
  threads) PKG=pkg; THREADS_LIST=$(echo "${THREADS:-1 2 4 8}" | tr ' ' ',') ;;
  *) echo "unknown build: $BUILD" >&2; exit 2 ;;
esac
if [ ! -f "$PKG/hardware_aware_matmul_web_bg.wasm" ]; then
  echo "REFUSING: $PKG/ is missing; build it first (./build-lite.sh or ./build.sh)"; exit 1
fi
if [ "$PKG" = pkg ] && [ "$(cat pkg/.features 2>/dev/null || echo unknown)" != "no-bundler" ]; then
  echo "REFUSING: pkg/ was not built with the no-bundler feature; run ./build.sh"; exit 1
fi
SIZES_LIST=$(echo "${SIZES:-512 1024}" | tr ' ' ',')
mkdir -p target
export REPORT="$PWD/target/bench-$BUILD-report.json" LOG="$PWD/target/bench-$BUILD-server.log"
rm -f "$LOG"
URL="www/bench.html?build=$BUILD&sizes=$SIZES_LIST&threads=$THREADS_LIST&repeats=${REPEATS:-5}&warmup=${WARMUP:-1}"
../dev/run_page.sh . "$URL" "${TIMEOUT:-3600}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I - "$REPORT" "$OUT" <<'PYEOF'
import json, shutil, sys
report = json.load(open(sys.argv[1]))
if not report.get("ok"):
    print("FAIL: the bench page reported an error:", report.get("error"))
    sys.exit(1)
shutil.copy(sys.argv[1], sys.argv[2])
print("bench-browser: %s: %d runs -> %s" % (report["kind"], len(report["runs"]), sys.argv[2]))
PYEOF
````


- [ ] **Step 2: Build both modules and run both pages small**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"` and port 8765 free (`ss -ltnp | grep 8765`):

```bash
./build-lite.sh && ./build.sh
mkdir -p target
SIZES="64 128" REPEATS=2 WARMUP=1 ./bench-browser.sh lite target/b-lite.json
SIZES="64 128" THREADS="1 2" REPEATS=2 WARMUP=1 ./bench-browser.sh threads target/b-threads.json
python3 -I - <<'EOF'
import json
for f in ('target/b-lite.json', 'target/b-threads.json'):
    d = json.load(open(f))
    print(d['kind'], d['isolated'], d.get('pool_threads'), len(d['runs']), sorted({(r['n'], r['hash']) for r in d['runs']}))
EOF
```

Expected: `bench-browser: browser-lite: 10 runs -> target/b-lite.json` and `bench-browser: browser-threads: 18 runs -> target/b-threads.json`, then two lines beginning `browser-lite True None 10 [(64, '653a9b093a002dca'), (128, '...')]` and `browser-threads True N 18 [(64, '653a9b093a002dca'), (128, '...')]` where `N` is the pool size (`min(cores, 8)`, 8 on a machine with 8 or more logical cores) and the size-128 hash is the same in both. If a page "never reported", check the port first (`ss -ltnp | grep 8765`) and look at `web/wasm/target/bench-*-server.log`; do not weaken anything.

- [ ] **Step 3: Commit**

```bash
git add web/wasm/www/bench-run.js web/wasm/www/bench-lite-worker.js web/wasm/www/bench-threads-worker.js web/wasm/www/bench.html web/wasm/bench-browser.sh
git commit -m "add the browser bench page and runner"
```

---

### Task 6: The results assembler, with its checks

`web/dev/results.py` merges the three reports with the recorded environment (CPU, logical cores, OS, `rustc`, Firefox, git commit, `RUSTFLAGS`, the native and browser instruction sets, the pool size) into one document, adding each case's median, minimum, maximum and GFLOP/s (`2 n^3 / median`). **It refuses to write anything unless** every run for a size has the same hash (the project's invariant, as data), each environment measured exactly the expected cases (no missing, extra or duplicate), every case has the expected number of repeats with positive times, and the three reports were run with the same sizes, repeats and warm-up. It also validates an existing file (`--check`). Python standard library only.

**Files:**
- Create: `web/dev/test_results.py`, `web/dev/results.py`

**Interfaces:**
- Produces: `python3 -I web/dev/results.py --native N.json --lite L.json --threads T.json --out OUT.json` and `--check FILE`; the schema: `{"schema":1,"generated","environment":{..},"parameters":{"sizes","repeats","warmup","block","tile","threads":{"native","browser-lite","browser-threads"}},"runs":[{"environment","level","n","threads","repeats","times_ms","median_ms","min_ms","max_ms","gflops","hash"},...]}`.

- [ ] **Step 1: Write the tests first**


Create `web/dev/test_results.py`:

````python
"""Tests for results.py. Run: python3 -I web/dev/test_results.py (from the repo root)."""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import results  # noqa: E402

HASHES = {64: "aaaa", 128: "bbbb"}


def report(kind, threads, **extra):
    runs = []
    for n in (64, 128):
        runs.append({"level": 0, "n": n, "threads": 1, "times_ms": [4.0, 2.0, 3.0], "hash": HASHES[n]})
        for level in range(1, 5):
            for t in threads:
                runs.append({"level": level, "n": n, "threads": t, "times_ms": [2.0, 1.0, 1.5], "hash": HASHES[n]})
    out = {"kind": kind, "ok": True, "cores": 8, "runs": runs,
           "parameters": {"sizes": [64, 128], "repeats": 3, "warmup": 1, "block": [32, 64], "tile": [128, 128, 128]}}
    out.update(extra)
    return out


def reports():
    native = report("native", [1, 2], isa="SSE2", micro_tile=[4, 4])
    lite = report("browser-lite", [1], env={"isa": "none (scalar code)"})
    threads = report("browser-threads", [1, 2], env={"isa": "none (scalar code)"}, pool_threads=8)
    return native, lite, threads


ENV = {"cpu": "test cpu"}


class AssembleTests(unittest.TestCase):
    def build(self, native, lite, threads):
        return results.assemble(native, lite, threads, ENV, "2026-01-01T00:00:00Z")

    def test_assembles_and_summarises(self):
        document = self.build(*reports())
        self.assertEqual(document["schema"], 1)
        self.assertEqual(document["parameters"]["threads"],
                         {"native": [1, 2], "browser-lite": [1], "browser-threads": [1, 2]})
        # native: 2 sizes x (1 + 4 levels x 2 threads); lite: 2 x (1 + 4); threads: like native
        self.assertEqual(len(document["runs"]), 18 + 10 + 18)
        first = document["runs"][0]
        self.assertEqual((first["environment"], first["level"], first["n"]), ("native", 0, 64))
        self.assertEqual(first["median_ms"], 3.0)
        self.assertEqual((first["min_ms"], first["max_ms"]), (2.0, 4.0))
        # 2 * 64^3 flops in 3 ms
        self.assertAlmostEqual(first["gflops"], 2 * 64 ** 3 / 0.003 / 1e9, places=3)

    def test_disagreeing_hashes_are_refused(self):
        native, lite, threads = reports()
        threads["runs"][7]["hash"] = "cccc"
        with self.assertRaisesRegex(results.ResultsError, "disagree"):
            self.build(native, lite, threads)

    def test_a_missing_case_is_refused(self):
        native, lite, threads = reports()
        del lite["runs"][3]
        with self.assertRaisesRegex(results.ResultsError, "browser-lite: wrong set of cases"):
            self.build(native, lite, threads)

    def test_a_duplicate_case_is_refused(self):
        native, lite, threads = reports()
        native["runs"].append(copy.deepcopy(native["runs"][0]))
        with self.assertRaisesRegex(results.ResultsError, "native: wrong set of cases"):
            self.build(native, lite, threads)

    def test_a_wrong_number_of_repeats_is_refused(self):
        native, lite, threads = reports()
        native["runs"][1]["times_ms"] = [1.0, 2.0]
        with self.assertRaisesRegex(results.ResultsError, "repeats"):
            self.build(native, lite, threads)

    def test_runs_with_different_parameters_are_refused(self):
        native, lite, threads = reports()
        lite["parameters"]["repeats"] = 5
        with self.assertRaisesRegex(results.ResultsError, "different repeats"):
            self.build(native, lite, threads)

    def test_a_failed_report_is_refused(self):
        native, lite, threads = reports()
        threads["ok"] = False
        threads["error"] = "boom"
        with self.assertRaisesRegex(results.ResultsError, "boom"):
            self.build(native, lite, threads)

    def test_non_positive_time_is_refused(self):
        native, lite, threads = reports()
        native["runs"][0]["times_ms"] = [0.0, 1.0, 2.0]
        with self.assertRaisesRegex(results.ResultsError, "non-positive"):
            self.build(native, lite, threads)

    def test_check_accepts_what_assemble_writes(self):
        results.check(self.build(*reports()))


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 2: Run them to see the failure**

From the repository root: `python3 -I web/dev/test_results.py 2>&1 | tail -3`
Expected: `ModuleNotFoundError: No module named 'results'`.

- [ ] **Step 3: Write the assembler**


Create `web/dev/results.py`:

````python
"""Assembles the reference run's results.json from the native and browser reports.

usage: python3 -I results.py --native N.json --lite L.json --threads T.json --out OUT.json
       python3 -I results.py --check results.json

The inputs are the JSON the native bench example and the two browser bench pages print
(`web/wasm/examples/bench.rs`, `web/wasm/www/bench.html`). The output is one document:
the recorded environment, the parameters, and one entry per measured case with its
median, minimum, maximum and GFLOP/s.

It refuses to write anything unless the project's invariant holds in the data: for each
matrix size, **every** run (every level, thread count, native and browser) produced the
same result hash. It also checks that every environment measured exactly the expected
cases and that each case has the expected number of repeats.
"""
import argparse
import datetime
import json
import os
import platform
import statistics
import subprocess
import sys

SCHEMA = 1
ENVIRONMENTS = ("native", "browser-lite", "browser-threads")


class ResultsError(Exception):
    """The data breaks a rule; nothing is written."""


def _summarise(environment, report):
    """The runs of one report, with median, min, max and GFLOP/s added."""
    runs = []
    for run in report["runs"]:
        times = run["times_ms"]
        median = statistics.median(times)
        n = run["n"]
        runs.append({
            "environment": environment,
            "level": run["level"],
            "n": n,
            "threads": run["threads"],
            "repeats": len(times),
            "times_ms": times,
            "median_ms": round(median, 4),
            "min_ms": min(times),
            "max_ms": max(times),
            "gflops": round(2 * n ** 3 / (median / 1000) / 1e9, 4),
            "hash": run["hash"],
        })
    return runs


def _thread_counts(report):
    return sorted({run["threads"] for run in report["runs"] if run["level"] != 0})


def check(document):
    """Raises ResultsError unless the document obeys every rule."""
    if document.get("schema") != SCHEMA:
        raise ResultsError("unknown schema %r" % document.get("schema"))
    parameters = document["parameters"]
    sizes, repeats = parameters["sizes"], parameters["repeats"]
    runs = document["runs"]
    if not runs:
        raise ResultsError("no runs")
    # The invariant: one hash per matrix size, whatever the level, threads or environment.
    hashes = {}
    for run in runs:
        hashes.setdefault(run["n"], set()).add(run["hash"])
    for n, found in sorted(hashes.items()):
        if len(found) != 1:
            raise ResultsError("n=%d: the runs disagree on the result: %s" % (n, sorted(found)))
    # Every environment measured exactly the expected cases.
    for environment in ENVIRONMENTS:
        threads = parameters["threads"][environment]
        expected = set()
        for n in sizes:
            expected.add((0, n, 1))
            for level in range(1, 5):
                for t in threads:
                    expected.add((level, n, t))
        found = [(r["level"], r["n"], r["threads"]) for r in runs if r["environment"] == environment]
        if sorted(found) != sorted(expected):
            missing = sorted(expected - set(found))
            extra = sorted(set(found) - expected)
            dup = len(found) - len(set(found))
            raise ResultsError("%s: wrong set of cases (missing %s, unexpected %s, %d duplicates)"
                               % (environment, missing[:3], extra[:3], dup))
    for run in runs:
        if run["repeats"] != repeats or len(run["times_ms"]) != repeats:
            raise ResultsError("%s level %d n %d threads %d: %d repeats, expected %d"
                               % (run["environment"], run["level"], run["n"], run["threads"], run["repeats"], repeats))
        if min(run["times_ms"]) <= 0:
            raise ResultsError("a non-positive time in %r" % run)


def assemble(native, lite, threads, environment, generated):
    """The results document from the three reports and the recorded environment."""
    for name, report in (("native", native), ("browser-lite", lite), ("browser-threads", threads)):
        if report.get("ok") is False:
            raise ResultsError("%s report is not ok: %s" % (name, report.get("error")))
    params = native["parameters"]
    for name, report in (("browser-lite", lite), ("browser-threads", threads)):
        got = report["parameters"]
        for key in ("sizes", "repeats", "warmup"):
            if got[key] != params[key]:
                raise ResultsError("%s was run with different %s (%r) than native (%r)" % (name, key, got[key], params[key]))
    document = {
        "schema": SCHEMA,
        "generated": generated,
        "environment": environment,
        "parameters": {
            "sizes": params["sizes"],
            "repeats": params["repeats"],
            "warmup": params["warmup"],
            "block": params["block"],
            "tile": params["tile"],
            "threads": {
                "native": _thread_counts(native),
                "browser-lite": _thread_counts(lite),
                "browser-threads": _thread_counts(threads),
            },
        },
        "runs": _summarise("native", native) + _summarise("browser-lite", lite) + _summarise("browser-threads", threads),
    }
    check(document)
    return document


def _run(*command):
    try:
        return subprocess.run(command, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def collect_environment(native, threads):
    """What this machine and toolchain are, for the record."""
    cpu = "unknown"
    try:
        with open("/proc/cpuinfo") as cpuinfo:
            for line in cpuinfo:
                if line.startswith("model name"):
                    cpu = line.split(":", 1)[1].strip()
                    break
    except OSError:
        pass
    dirty = bool(_run("git", "status", "--porcelain", "--untracked-files=no"))
    return {
        "cpu": cpu,
        "logical_cores": native["cores"],
        "os": platform.platform(),
        "rustc": _run("rustc", "-V"),
        "rustflags": os.environ.get("RUSTFLAGS", ""),
        "firefox": _run("firefox", "--version"),
        "commit": _run("git", "rev-parse", "HEAD") + (" (with uncommitted changes)" if dirty else ""),
        "native_isa": native["isa"],
        "native_micro_tile": native["micro_tile"],
        "browser_isa": threads["env"]["isa"],
        "browser_pool": threads.get("pool_threads"),
    }


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--native")
    parser.add_argument("--lite")
    parser.add_argument("--threads")
    parser.add_argument("--out")
    parser.add_argument("--check")
    args = parser.parse_args(argv)
    try:
        if args.check:
            document = json.load(open(args.check))
            check(document)
            print("results.py: %s is valid (%d runs)" % (args.check, len(document["runs"])))
            return 0
        if not (args.native and args.lite and args.threads and args.out):
            parser.error("give --native, --lite, --threads and --out, or --check")
        native, lite, threads = (json.load(open(path)) for path in (args.native, args.lite, args.threads))
        generated = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        document = assemble(native, lite, threads, collect_environment(native, threads), generated)
        with open(args.out, "w") as out:
            json.dump(document, out, indent=1)
            out.write("\n")
        print("results.py: wrote %s (%d runs, all hashes agree)" % (args.out, len(document["runs"])))
        return 0
    except ResultsError as error:
        print("results.py: REFUSING: %s" % error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

- [ ] **Step 4: Run the tests**

`python3 -I web/dev/test_results.py 2>&1 | tail -4`
Expected: `Ran 9 tests` and `OK`.

- [ ] **Step 5: Commit**

```bash
git add web/dev/results.py web/dev/test_results.py
git commit -m "add the results assembler with its checks"
```

---

### Task 7: The reference-run script

`web/dev/bench-reference.sh` runs the whole reference run: it refuses if port 8765 is busy, prints the load average (the machine should be idle), builds both wasm modules, runs the native bench and both browser benches, and assembles `web/site/src/data/results.json`. Sizes, thread counts, repeats, warm-up and the output path are environment variables, so the pipeline can be rehearsed in seconds; only a full-size run produces the committed file (Task 10).

**Files:**
- Create: `web/dev/bench-reference.sh`

**Interfaces:**
- Produces: `web/dev/bench-reference.sh` (env `SIZES="512 1024"`, `THREADS="1 2 4 8"`, `REPEATS=5`, `WARMUP=1`, `OUT`, `WASM_BINDGEN`); intermediate reports in `web/wasm/target/bench/` (ignored).

- [ ] **Step 1: Create the script**


Create `web/dev/bench-reference.sh` (then `chmod +x`):

````bash
#!/usr/bin/env bash
# The reference run: times every level natively and in headless Firefox (the lite and the
# threaded wasm builds), and writes web/site/src/data/results.json, the data the Results
# section cites. Run it by hand on an otherwise IDLE machine (shared CI machines are too
# noisy to time anything), then commit the file with a message saying why it was re-run.
#
# usage: web/dev/bench-reference.sh
# env (defaults are the full reference run):
#   SIZES="512 1024"   THREADS="1 2 4 8"   REPEATS=5   WARMUP=1
#   OUT=web/site/src/data/results.json     WASM_BINDGEN=$HOME/.cargo/bin/wasm-bindgen
# Smaller values are for rehearsing the pipeline, e.g.
#   SIZES="64 128" THREADS="1 2" REPEATS=2 OUT=/tmp/rehearsal.json web/dev/bench-reference.sh
# Thread counts above the machine's cores are dropped (natively) or above the pool size
# (in the browser). The file is only written if every run, native and browser, produced
# the same result hash for each size (web/dev/results.py).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
export SIZES=${SIZES:-"512 1024"} THREADS=${THREADS:-"1 2 4 8"} REPEATS=${REPEATS:-5} WARMUP=${WARMUP:-1}
OUT=${OUT:-$ROOT/web/site/src/data/results.json}

if ss -ltnp 2>/dev/null | grep -q ':8765 '; then
  echo "REFUSING: something already listens on port 8765 (a stray server makes the browser runs fail)"; exit 1
fi
echo "load average: $(cut -d' ' -f1-3 /proc/loadavg) (the machine should be idle)"
WORK=$ROOT/web/wasm/target/bench
mkdir -p "$WORK" "$(dirname "$OUT")"

echo "== building the wasm modules"
(cd web/wasm && ./build-lite.sh && ./build.sh)

echo "== native"
(cd web/wasm && cargo run --release --example bench -- \
  --sizes "${SIZES// /,}" --threads "${THREADS// /,}" --repeats "$REPEATS" --warmup "$WARMUP") > "$WORK/native.json"

echo "== browser, lite build"
web/wasm/bench-browser.sh lite "$WORK/lite.json"
echo "== browser, threaded build"
web/wasm/bench-browser.sh threads "$WORK/threads.json"

echo "== assembling"
python3 -I web/dev/results.py --native "$WORK/native.json" --lite "$WORK/lite.json" \
  --threads "$WORK/threads.json" --out "$OUT"
````

- [ ] **Step 2: Rehearse the whole pipeline at small size**

From the repository root, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"` and port 8765 free:

```bash
SIZES="128 256" THREADS="1 2" REPEATS=3 WARMUP=1 OUT=$PWD/web/wasm/target/rehearsal.json web/dev/bench-reference.sh 2>&1 | grep -E "^(==|bench-browser|results.py|load)"
python3 -I web/dev/results.py --check web/wasm/target/rehearsal.json
```

Expected: the load average line, then `== building the wasm modules`, `== native`, `== browser, lite build`, `bench-browser: browser-lite: 10 runs ...`, `== browser, threaded build`, `bench-browser: browser-threads: 18 runs ...`, `== assembling`, `results.py: wrote ... (46 runs, all hashes agree)` and `results.py: web/wasm/target/rehearsal.json is valid (46 runs)` (native 18 + lite 10 + threaded 18). The rehearsal file is under the ignored `web/wasm/target/`; do not commit it. If the run dies in a browser step with "never reported", check port 8765 first.

- [ ] **Step 3: Check that tampered data is refused**

Change one hash in a copy of the native report and try to assemble:

```bash
python3 -I - <<'EOF'
import json
d = json.load(open('web/wasm/target/bench/native.json'))
d['runs'][3]['hash'] = '0000000000000000'
json.dump(d, open('web/wasm/target/bench/native-tampered.json', 'w'))
EOF
python3 -I web/dev/results.py --native web/wasm/target/bench/native-tampered.json --lite web/wasm/target/bench/lite.json --threads web/wasm/target/bench/threads.json --out web/wasm/target/bench/should-not-exist.json; echo "exit $?"
ls web/wasm/target/bench/should-not-exist.json
```

Expected: a line `results.py: REFUSING: n=...: the runs disagree on the result: [...]`, `exit 1`, and `ls` reporting `No such file or directory` (nothing was written).

- [ ] **Step 4: Commit**

```bash
git add web/dev/bench-reference.sh
git commit -m "add the reference-run script"
```

---

### Task 8: Test the assembler in CI

The Pages workflow already builds the site and tests the wasm wrapper natively; the assembler's unit tests are a one-line addition (standard-library Python, nothing to install).

**Files:**
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1: Add the step**


In `.github/workflows/pages.yml`, replace:

````text
        cargo test --features threads

    - name: Generate the expected hashes for the gate page
      working-directory: web/wasm
````

with:

````text
        cargo test --features threads

    - name: Test the results assembler
      run: python3 -I web/dev/test_results.py

    - name: Generate the expected hashes for the gate page
      working-directory: web/wasm
````

- [ ] **Step 2: Check that it parses and the step is where intended**

From the repository root (this uses the `yaml` package that Astro installed in `web/site/node_modules`):

```bash
docker run --rm -v "$PWD/.github/workflows:/wf:ro" -v "$PWD/web/site/node_modules:/nm:ro" -e NODE_PATH=/nm node:latest node -e "
const { parse } = require('yaml');
const w = parse(require('fs').readFileSync('/wf/pages.yml', 'utf8'));
console.log(Object.keys(w.jobs).join(','), Object.keys(w.on).join(','), w.jobs.build.steps.length, w.jobs.build.steps.map((s) => s.name || s.uses).slice(5, 9).join(' | '));
"
```

Expected, starting exactly: `build,deploy workflow_dispatch,push,pull_request 12`, and the step list containing `Test the results assembler` right after the native wrapper tests. (The assembler's tests also run locally: `python3 -I web/dev/test_results.py`.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "test the results assembler in CI"
```

---

### Task 9: Document the reference run in CLAUDE.md

This changes one standing rule of the repository: "the docs deliberately contain no benchmark numbers" becomes "benchmark numbers appear only as generated data".

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Apply the edits**


In `CLAUDE.md`, replace:

````text
## What this is

A teaching-oriented Rust crate (`hardware_aware_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `hardware-aware-matmul`; the crate name is `hardware_aware_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). The site is laid out as a paper: abstract (`docs/paper/abstract.md`, the landing page), introduction, methods (the levels), and later results, discussion and conclusion (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`); `chapters` and `sectionTitles` in `site.config.mjs` give the order and the navigation groups. It renders those pages from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch, on every push to `trunk` (which deploys it, unless the push only touches `docs/superpowers/`) and on pull requests (build only); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

with:

````text
## What this is

A teaching-oriented Rust crate (`hardware_aware_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `hardware-aware-matmul`; the crate name is `hardware_aware_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build; both wasm builds enable `+simd128`, so level 3 vectorises in the browser); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). The site is laid out as a paper: abstract (`docs/paper/abstract.md`, the landing page), introduction, methods (the levels), and later results, discussion and conclusion (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`); `chapters` and `sectionTitles` in `site.config.mjs` give the order and the navigation groups. It renders those pages from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch, on every push to `trunk` (which deploys it, unless the push only touches `docs/superpowers/`) and on pull requests (build only); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

In `CLAUDE.md`, replace:

````text
```sh
# from the repo root
web/dev/node.sh site npm test                   # unit tests of the prose plugin and the step-through's model
web/dev/node.sh site npm run build              # the site into web/site/dist (needs ./build-lite.sh and FEATURES=threads ./build.sh first, and public/expected.json for the gate page; the gate scripts do all three)
````

with:

````text
```sh
# from the repo root
python3 -I web/dev/test_results.py              # unit tests of the results assembler
web/dev/bench-reference.sh                      # the reference run (idle machine; SIZES/THREADS/REPEATS/OUT env for rehearsals)
web/dev/node.sh site npm test                   # unit tests of the prose plugin and the step-through's model
web/dev/node.sh site npm run build              # the site into web/site/dist (needs ./build-lite.sh and FEATURES=threads ./build.sh first, and public/expected.json for the gate page; the gate scripts do all three)
````

In `CLAUDE.md`, replace:

````text
```

Always benchmark with `--release`. The docs deliberately contain no benchmark numbers.

Animations: `manim -ql anim/<file>.py <SceneClass>` (output lands in `anim/media/`, whose generated `Tex/`, `texts/`, and `partial_movie_files/` are untracked).
````

with:

````text
```

Always benchmark with `--release`. Benchmark numbers never appear in prose by hand: only as generated data, `web/site/src/data/results.json`, written by the reference run `web/dev/bench-reference.sh` (native plus headless Firefox, lite and threaded; run by hand on an otherwise idle machine, then commit the file) and refused by `web/dev/results.py` unless every run produced the same result hash. The wasm bench API (`bench_prepare`/`bench_multiply`/`bench_hash`, over `cases::Bench`) times the multiplication alone.

Animations: `manim -ql anim/<file>.py <SceneClass>` (output lands in `anim/media/`, whose generated `Tex/`, `texts/`, and `partial_movie_files/` are untracked).
````

- [ ] **Step 2: Verify**

```bash
grep -n "bench-reference.sh\|results.json\|test_results.py" CLAUDE.md | cut -c1-120
```

Expected: at least three lines (the two commands and the sentence replacing the old "no benchmark numbers" rule).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "document the reference run in CLAUDE.md"
```

---

### Task 10: Record the first reference run

The pipeline is verified at rehearsal size; this task runs it at full size and commits the data the Results section will cite. **This task is run by hand-off, on an idle machine:** the full run takes on the order of ten to twenty minutes and its numbers are only meaningful if nothing else is using the CPU. Do not run anything else (no other builds, tests or browsers) while it runs, and do not use the machine for anything else until it finishes. The data it writes describes this one machine; the file records which.

**Files:**
- Create: `web/site/src/data/results.json` (generated; do not edit it by hand)

- [ ] **Step 1: Prepare an idle machine**

```bash
ss -ltnp | grep 8765 || echo "port free"     # must print: port free
cut -d' ' -f1-3 /proc/loadavg                 # the load average should be low (about 1 or less)
git status --short                            # should be clean: the file records the commit it was run on
```

If the load average is high, find out why (`ps -eo pcpu,args --sort=-pcpu | head`) and report it rather than killing processes you did not start; if it will not settle, report BLOCKED with that output.

- [ ] **Step 2: Run the reference run**

From the repository root, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`. Use a generous timeout (the tool's maximum, 600000 ms) or run it in the background and poll its output file:

```bash
web/dev/bench-reference.sh 2>&1 | tee web/wasm/target/bench/reference-run.log | grep -E "^(==|bench-browser|results.py|load)"
```

Expected: the section headings, `bench-browser: browser-lite: ... runs`, `bench-browser: browser-threads: ... runs` and finally `results.py: wrote .../web/site/src/data/results.json (N runs, all hashes agree)`. If it prints `REFUSING: the runs disagree on the result`, **stop and report BLOCKED**: that would mean two levels or two environments computed different results, which is a bug to investigate, not data to publish. If a browser step dies with "never reported", check the port and the log under `web/wasm/target/`.

- [ ] **Step 3: Check the file**

```bash
python3 -I web/dev/results.py --check web/site/src/data/results.json
python3 -I - <<'EOF'
import json
d = json.load(open('web/site/src/data/results.json'))
env, p = d['environment'], d['parameters']
print('machine:', env['cpu'], '|', env['logical_cores'], 'logical cores |', env['os'])
print('toolchain:', env['rustc'], '|', env['firefox'], '| commit', env['commit'])
print('native isa:', env['native_isa'], env['native_micro_tile'], '| browser isa:', env['browser_isa'], '| pool:', env['browser_pool'])
print('parameters:', p['sizes'], p['repeats'], 'repeats,', p['warmup'], 'warm-up,', p['threads'])
n = max(p['sizes'])
print('median ms at n =', n, '(threads=1 for level 0; the largest thread count otherwise):')
for environment in ('native', 'browser-lite', 'browser-threads'):
    row = []
    for level in range(5):
        t = 1 if level == 0 else max(p['threads'][environment])
        r = next(r for r in d['runs'] if (r['environment'], r['level'], r['n'], r['threads']) == (environment, level, n, t))
        row.append('L%d %.1f' % (level, r['median_ms']))
    print(' ', environment.ljust(16), '  '.join(row))
assert env['commit'] != 'unknown' and env['cpu'] != 'unknown'
EOF
```

Expected: `results.py: web/site/src/data/results.json is valid (N runs)`, then a summary: the CPU and core count, the toolchain versions, the instruction sets (the native SIMD level and the browser's), the parameters (sizes 512 and 1024, 5 repeats, 1 warm-up, thread counts per environment), and a table of median milliseconds at the largest size for the five levels in each of the three environments, with no assertion error (the commit and the CPU are recorded). Paste that summary into your report: it is what a reader will later see described as "the reference machine".

- [ ] **Step 4: Commit**

```bash
git add web/site/src/data/results.json
git commit -m "record the first reference run"
```

---

## After this plan

If every task passes, the repository has the data layer of the Results section: a bench API, a native and a browser benchmark, an assembler that enforces the project's thesis on its own data (every run gives the same answer), and the first committed reference run. Nothing on the site changes yet. Next: **P2b**, the placeholder mechanism in the prose plugin, the Results page (tables and charts from `results.json`) and its navigation entry; then **P2c**, the playground.
