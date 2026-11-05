# Stage B Spike, Part Two: Level 4, Limits, and the Production Build (Gates G4, G5, G3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A` or `git add .`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Finish the stage B spike: put level 4 on the runner (G4), measure the browser's limits (G5), and prove the whole thing works from an Astro production build served under `/matmul_levels.rs/` without server-set isolation headers (G3), then record the results.

**Architecture:** Level 4's worker loop becomes jobs handed to the `Runner` (one job per worker, errors collected in a shared slot). The wrapper crate gains level 4 and two limit probes. The gate scripts are tidied (report checks in `web/dev/check_report.py`, a build-mode marker so a bundler build cannot be mistaken for the no-bundler one). A minimal Astro project in `web/site` reuses the very same worker; Node runs only inside a Docker container through `web/dev/node.sh`.

**Tech Stack:** As in part one, plus Astro 7.4.7, `coi-serviceworker` 0.1.7, Node from the `node:latest` Docker image (v26.13.0 when this plan was written), Vite (bundled with Astro).

**Spec:** `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-design.md` (gates G3, G4, G5). Part one's results: `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md`.

## Global Constraints

- `naive_matmul` stays dependency-free, `#![forbid(unsafe_code)]`, MSRV 1.73. The nightly toolchain, the wasm dependencies and Node live only under `web/`; the core crate must still build and test on stable and on 1.73.
- Every level returns bit-for-bit identical results; a runner changes where jobs run, never what they compute.
- New public API is additive. Existing functions keep their signatures and results.
- `web/wasm` keeps its empty `[workspace]` table and tracked `Cargo.lock`; `wasm-bindgen` stays pinned `=0.2.130` to match the CLI.
- Node runs only in Docker (`web/dev/node.sh`); the host has no Node. Files it writes must be owned by the user, not root.
- Never glob `docs/**`; `docs/superpowers/` is not product documentation.
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- Rust: `nightly-2025-11-15` (rust-src, `wasm32-unknown-unknown`) and `1.73`; the `wasm-bindgen` CLI 0.2.130 at `$HOME/.cargo/bin/wasm-bindgen`. In every shell that builds or runs gates: `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`.
- Docker with the `node:latest` image; your user is in the `docker` group. `docker images | grep node` should list it.
- Firefox 159 (headless; a throwaway profile is used). Do not kill other Firefox processes: the user's own browser may be running. Gates run one at a time (port 8765, or `PORT=...`).
- A cold wasm build takes about 30 to 60 seconds. Give shell commands a generous timeout (600000 ms).

## Verified beforehand

The code in this plan was built and run end to end on this machine before the plan was written, and the whole sequence was replayed against a fresh copy of the repository (core tests, clippy, rustdoc, the 1.73 build, the `wasm32` check, and every gate in headless Firefox, including the Astro production build under `/matmul_levels.rs/`). If a step's result differs from what the step states, stop and report BLOCKED with the output.

---

### Task 1: Level 4 on a `Runner`

Level 4 (`streaming`) has its own worker loop (`std::thread::scope`, join, `resume_unwind`). Each worker is already "claim output tiles from a shared counter until none remain", so a worker becomes one job; the first I/O error any worker hits goes into a `Mutex<Option<io::Error>>`. `matmul_streaming` keeps its signature and delegates with `StdRunner`. One behaviour difference, accepted: a panic in a source or sink now reaches the caller of `matmul_streaming` as `StdRunner`'s generic "a scoped thread panicked" instead of the original payload (levels 1 to 3 already behave this way); a custom runner that runs jobs inline or on rayon rethrows the original.

**Files:**
- Modify: `tests/levels.rs`, `tests/streaming.rs`, `src/streaming/multiply.rs`, `src/streaming/mod.rs`, `docs/design/runner.md`

**Interfaces:**
- Consumes: `naive_matmul::runner::{Runner, StdRunner}`, `streaming::tile_plan`, the test helpers `rough_operands`, `assert_same_bits`, `CountingInline` (already in `tests/levels.rs`).
- Produces: `streaming::matmul_streaming_with_runner<A, B, C, R>(a: &A, b: &B, c: &C, config: &StreamConfig, runner: &R) -> Result<(), MatmulError>` with `A, B: TileSource + ?Sized`, `C: TileSink + ?Sized`, `R: Runner + ?Sized`. It hands the runner exactly `min(config.threads(), tile count)` jobs, and none for an empty product.

- [ ] **Step 1: Write the failing tests**


In `tests/levels.rs`, replace:

````text
        simd::matmul_with_runner(&a, &b, nz(4), &block, &inline).unwrap();
        assert_eq!(inline.jobs(), 0, "shape {m}x{n}x{p}");
````

with:

````text
        simd::matmul_with_runner(&a, &b, nz(4), &block, &inline).unwrap();
        let config = StreamConfig::new(nz(4));
        streaming::matmul_streaming_with_runner(&a, &b, &streaming::MemorySink::new(m, p), &config, &inline).unwrap();
        assert_eq!(inline.jobs(), 0, "shape {m}x{n}x{p}");
````

In `tests/levels.rs`, replace:

````text
#[test]
fn an_empty_product_hands_the_runner_no_jobs() {
````

with:

````text
#[test]
fn streaming_runners_never_change_the_bits() {
    for (m, n, p) in [(1, 1, 1), (9, 13, 11), (37, 23, 41), (70, 75, 133)] {
        let (a, b) = rough_operands(m, n, p);
        let reference = naive::matmul(&a, &b).unwrap();
        for threads in [1, 3, 8] {
            for (rows, cols, depth) in [(16, 24, 20), (1, 1, 1), (1000, 1000, 1000)] {
                let config = StreamConfig::new(nz(threads)).with_tile_shape(rows, cols, depth);
                let context = |runner: &str| {
                    format!("streaming, {runner}, tiles {rows}x{cols}x{depth}, shape {m}x{n}x{p}, {threads} thread(s)")
                };

                let inline = CountingInline::new();
                let sink = streaming::MemorySink::new(m, p);
                streaming::matmul_streaming_with_runner(&a, &b, &sink, &config, &inline).unwrap();
                assert_same_bits(&sink.into_matrix(), &reference, &context("inline"));
                let jobs_expected = threads.min(streaming::tile_plan(m, n, p, &config).tiles.len());
                assert_eq!(inline.jobs(), jobs_expected, "{}", context("job count"));

                let sink = streaming::MemorySink::new(m, p);
                streaming::matmul_streaming_with_runner(&a, &b, &sink, &config, &StdRunner).unwrap();
                assert_same_bits(&sink.into_matrix(), &reference, &context("std"));
            }
        }
    }
}

#[test]
fn an_empty_product_hands_the_runner_no_jobs() {
````

In `tests/streaming.rs`, replace:

````text
use naive_matmul::streaming::{
    matmul, matmul_streaming, MemorySink, StreamConfig, TileSource,
};
````

with:

````text
use naive_matmul::runner::Runner;
use naive_matmul::streaming::{
    matmul, matmul_streaming, matmul_streaming_with_runner, MemorySink, StreamConfig, TileSource,
};
````

In `tests/streaming.rs`, replace:

````text
#[cfg(any(unix, windows))]
mod file_backed {
````

with:

````text
/// Runs every job on the calling thread, one after another.
struct Inline;

impl Runner for Inline {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        for job in jobs {
            job();
        }
    }
}

#[test]
fn io_errors_propagate_through_any_runner() {
    let b = Matrix::zeros(8, 8);
    let sink = MemorySink::new(8, 8);
    let config = StreamConfig::new(nz(4)).with_tile_shape(2, 2, 2);
    match matmul_streaming_with_runner(&FailingSource, &b, &sink, &config, &Inline) {
        Err(MatmulError::Io(e)) => assert!(e.to_string().contains("disk on fire")),
        other => panic!("expected an I/O error, got {other:?}"),
    }
}

/// A source whose reads panic, to check that panics reach the caller.
struct PanickingSource;

impl TileSource for PanickingSource {
    fn shape(&self) -> (usize, usize) {
        (8, 8)
    }

    fn read_tile(&self, _: usize, _: usize, _: usize, _: usize, _: &mut [f64]) -> io::Result<()> {
        panic!("boom");
    }
}

#[test]
#[should_panic(expected = "boom")]
fn a_panic_in_a_source_reaches_the_caller_of_an_inline_runner() {
    let b = Matrix::zeros(8, 8);
    let sink = MemorySink::new(8, 8);
    let config = StreamConfig::new(nz(2)).with_tile_shape(2, 2, 2);
    let _ = matmul_streaming_with_runner(&PanickingSource, &b, &sink, &config, &Inline);
}

#[cfg(any(unix, windows))]
mod file_backed {
````

- [ ] **Step 2: Run them to see the failure**

Run: `cargo test --test levels --test streaming 2>&1 | grep -E "^error"`
Expected: `error[E0425]: cannot find function `matmul_streaming_with_runner` in module `streaming`` (three times, in `levels`) and `error[E0432]: unresolved import `naive_matmul::streaming::matmul_streaming_with_runner`` (in `streaming`).

- [ ] **Step 3: Implement**


In `src/streaming/multiply.rs`, replace (include the final line break):

````text
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;

````

with:

````text
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

````

In `src/streaming/multiply.rs`, replace:

````text
use crate::matrix::Matrix;

/// Tile size used
````

with:

````text
use crate::matrix::Matrix;
use crate::runner::{Runner, StdRunner};

/// Tile size used
````

In `src/streaming/multiply.rs`, replace:

````text
pub fn matmul_streaming<A, B, C>(
    a: &A,
    b: &B,
    c: &C,
    config: &StreamConfig,
) -> Result<(), MatmulError>
where
    A: TileSource + ?Sized,
    B: TileSource + ?Sized,
    C: TileSink + ?Sized,
{
    let (m, n, p) = check_inner_dimensions(a.shape(), b.shape())?;
````

with:

````text
pub fn matmul_streaming<A, B, C>(
    a: &A,
    b: &B,
    c: &C,
    config: &StreamConfig,
) -> Result<(), MatmulError>
where
    A: TileSource + ?Sized,
    B: TileSource + ?Sized,
    C: TileSink + ?Sized,
{
    matmul_streaming_with_runner(a, b, c, config, &StdRunner)
}

/// Like [`matmul_streaming`], with the workers executed by `runner`.
///
/// The runner receives one job per worker: at most `config.threads()` of them,
/// fewer when there are fewer output tiles, and none for an empty product. Each
/// job claims output tiles from a shared counter until none remain, so a runner
/// that runs its jobs one after another simply lets the first job claim every
/// tile. Results are bit-for-bit identical for every runner.
///
/// # Errors
///
/// The same as [`matmul_streaming`]: the first I/O error observed is returned.
///
/// # Panics
///
/// A panic in a source or sink reaches the caller as the runner decides: with
/// [`StdRunner`] it is a panic from this function.
pub fn matmul_streaming_with_runner<A, B, C, R>(
    a: &A,
    b: &B,
    c: &C,
    config: &StreamConfig,
    runner: &R,
) -> Result<(), MatmulError>
where
    A: TileSource + ?Sized,
    B: TileSource + ?Sized,
    C: TileSink + ?Sized,
    R: Runner + ?Sized,
{
    let (m, n, p) = check_inner_dimensions(a.shape(), b.shape())?;
````

In `src/streaming/multiply.rs`, replace:

````text
    let first_error = thread::scope(|scope| {
        let mut handles = Vec::with_capacity(workers);
        for _ in 0..workers {
            handles.push(scope.spawn(|| {
                let result = run_worker(a, b, c, &plan, &next_tile, &failed);
                if result.is_err() {
                    failed.store(true, Ordering::Relaxed);
                }
                result
            }));
        }

        let mut first_error = None;
        for handle in handles {
            match handle.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
                Err(panic) => std::panic::resume_unwind(panic),
            }
        }
        first_error
    });

    match first_error {
        Some(error) => Err(MatmulError::Io(error)),
        None => Ok(()),
    }
````

with:

````text
    // One job per worker. The first error any worker hits is kept for the caller.
    let first_error: Mutex<Option<io::Error>> = Mutex::new(None);
    let jobs: Vec<Box<dyn FnOnce() + Send + '_>> = (0..workers)
        .map(|_| {
            let (plan, next_tile, failed, first_error) = (&plan, &next_tile, &failed, &first_error);
            Box::new(move || {
                if let Err(error) = run_worker(a, b, c, plan, next_tile, failed) {
                    failed.store(true, Ordering::Relaxed);
                    let mut slot = first_error.lock().expect("no code panics while holding this lock");
                    if slot.is_none() {
                        *slot = Some(error);
                    }
                }
            }) as Box<dyn FnOnce() + Send + '_>
        })
        .collect();
    runner.run(jobs);

    match first_error.into_inner().expect("no code panics while holding this lock") {
        Some(error) => Err(MatmulError::Io(error)),
        None => Ok(()),
    }
````

In `src/streaming/mod.rs`, replace:

````text
pub use multiply::{matmul, matmul_streaming, tile_plan, OutputTile, StreamConfig, TilePlan};
````

with:

````text
pub use multiply::{
    matmul, matmul_streaming, matmul_streaming_with_runner, tile_plan, OutputTile, StreamConfig,
    TilePlan,
};
````

In `docs/design/runner.md`, replace:

````text
Level 4 ([`streaming`](crate::streaming)) has its own worker loop and does not
use a `Runner` yet.
````

with:

````text
Level 4 takes a runner too:
[`streaming::matmul_streaming_with_runner`](crate::streaming::matmul_streaming_with_runner)
hands it one job per worker. Each worker claims output tiles from a shared
counter, so a runner that runs its jobs one after another simply lets the first
job claim every tile.
````

- [ ] **Step 4: Verify**

Run: `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: every `test result` is `ok`, no warnings. Counts: 44 unit, 12 in `levels` (one new), 16 in `streaming` (two new), 27 doc tests.

Run: `cargo clippy --all-targets 2>&1 | grep -E "^(warning|error)"; cargo +1.73 build 2>&1 | grep -E "^(warning|error)"; cargo check --lib --target wasm32-unknown-unknown 2>&1 | grep -E "^(warning|error)"`
Expected: no output from any of the three.

Run: `rm -rf target/doc && cargo doc --no-deps 2>&1 | grep -c "^warning"`
Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add tests/levels.rs tests/streaming.rs src/streaming/multiply.rs src/streaming/mod.rs docs/design/runner.md
git commit -m "let level 4 run its workers on a Runner"
```

---

### Task 2: Document level 4's runner

The runner docs, `CLAUDE.md`, the README tree and the architecture table still say the runner serves levels 1 to 3 and that level 4 takes none.

**Files:**
- Modify: `src/runner.rs`, `README.md`, `docs/design/architecture.md`, `CLAUDE.md`

- [ ] **Step 1: Apply the edits**


In `src/runner.rs`, replace:

````text
/// Levels 1 to 3 split the output rows into blocks and hand one job per block
/// to a `Runner`. A job borrows
````

with:

````text
/// Levels 1 to 3 split the output rows into blocks and hand one job per block
/// to a `Runner`; level 4 hands it one job per worker. A job borrows
````

In `README.md`, replace:

````text
Runner trait and StdRunner: where levels 1 to 3 run their row-block jobs
````

with:

````text
Runner trait and StdRunner: where levels 1 to 4 run their jobs
````

In `docs/design/architecture.md`, replace:

````text
`Runner` and `StdRunner`: where levels 1 to 3 run their row-block jobs.
````

with:

````text
`Runner` and `StdRunner`: where levels 1 to 4 run their jobs.
````

In `CLAUDE.md`, replace:

````text
Levels 1 to 3 each have `matmul_with_runner`; the plain functions delegate with `StdRunner`. A runner changes where jobs run, never what they compute. Level 4 has its own worker loop and takes no `Runner` yet.
````

with:

````text
Levels 1 to 3 each have `matmul_with_runner` (one job per row block) and level 4 has `matmul_streaming_with_runner` (one job per worker, each claiming tiles from a shared counter); the plain functions delegate with `StdRunner`. A runner changes where jobs run, never what they compute.
````

- [ ] **Step 2: Verify**

Run: `grep -n "no .Runner. yet\|takes no" CLAUDE.md docs/design/runner.md src/runner.rs`
Expected: no output.

Run: `rm -rf target/doc && cargo doc --no-deps 2>&1 | grep -c "^warning"; cargo test 2>&1 | grep -E "FAILED|^error"`
Expected: `0`, then no output.

- [ ] **Step 3: Commit**

```bash
git add src/runner.rs README.md docs/design/architecture.md CLAUDE.md
git commit -m "document the runner for level 4"
```

---

### Task 3: `build.sh` can build for a bundler

Two problems found while prototyping the production build: `FEATURES= ./build.sh` still built the no-bundler variant (`${VAR:-default}` also substitutes when the variable is empty; `${VAR-default}` only when unset), and the raw `wasm-bindgen` CLI writes no `package.json` into `pkg/`, which `wasm-bindgen-rayon`'s bundler-mode worker helper needs (it does `import('../../..')`, a bare directory import). `pkg/.features` records which mode the last build used, so later scripts can refuse the wrong one.

**Files:**
- Modify: `web/wasm/build.sh`

- [ ] **Step 1: Apply the edits**


In `web/wasm/build.sh`, replace (include the final line break):

````text
FEATURES=${FEATURES:-no-bundler}

````

with:

````text
FEATURES=${FEATURES-no-bundler}

````

In `web/wasm/build.sh`, replace:

````text
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured (default: ./target)
#      FEATURES      cargo features (default: no-bundler)
````

with:

````text
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured (default: ./target)
#      FEATURES      cargo features. Unset: no-bundler, for pages that load the
#                    module without a bundler (the gates). Set to the empty
#                    string (FEATURES= ./build.sh) for the bundler build used by
#                    the Astro site. The choice is recorded in pkg/.features.
````

In `web/wasm/build.sh`, replace:

````text
"$WASM_BINDGEN" --target web --out-dir pkg \
  "$TARGET_DIR/wasm32-unknown-unknown/release/naive_matmul_web.wasm"
````

with:

````text
"$WASM_BINDGEN" --target web --out-dir pkg \
  "$TARGET_DIR/wasm32-unknown-unknown/release/naive_matmul_web.wasm"
# A bundler resolves the bare directory import in wasm-bindgen-rayon's worker
# helper through package.json; the raw CLI does not write one (wasm-pack does).
cat > pkg/package.json <<'JSON'
{
  "name": "naive_matmul_web",
  "type": "module",
  "main": "naive_matmul_web.js",
  "module": "naive_matmul_web.js"
}
JSON
printf '%s' "$FEATURES" > pkg/.features
````

- [ ] **Step 2: Verify both modes**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
./build.sh                    # default: no-bundler
cat pkg/.features; echo       # expect: no-bundler
ls pkg/snippets/*/src         # expect: workerHelpers.no-bundler.js
ls pkg/package.json           # expect: pkg/package.json

FEATURES= ./build.sh          # bundler mode
cat pkg/.features | od -c | head -1   # expect an empty file: 0000000
ls pkg/snippets/*/src         # expect: workerHelpers.js

./build.sh                    # leave pkg/ in the mode the plain gates need
```

- [ ] **Step 3: Commit**

```bash
git add web/wasm/build.sh
git commit -m "let build.sh build for a bundler and record the mode"
```

---

### Task 4: Move the gate checks into `check_report.py`, and refuse the wrong build mode

The pass or fail decision currently lives in a Python heredoc inside `gate.sh`. The Astro-build gate needs the same checks, so they move to a shared script, `web/dev/check_report.py`. `gate.sh` also learns to refuse `--no-build` when `pkg/` was built for a bundler (`pkg/.features`, from Task 3). Behaviour for `g1`, `g2` and `probe` is unchanged (22 cases at this point).

**Files:**
- Create: `web/dev/check_report.py`
- Modify (replace entire contents): `web/wasm/gate.sh`

- [ ] **Step 1: Create the report checker**


Create `web/dev/check_report.py`:

````python
"""Decides whether a browser gate passed, from the report its page posted.

Usage: python3 -I check_report.py GATE REPORT.json
Exits 0 on pass, 1 on failure. Gates:
  g1     the thread pool starts and a parallel sum is right
  g2     every case's hash equals the native hash (levels 0 to 3)
  probe  informational: records whether StdRunner works in the browser
"""
import json
import sys

G2_CASES = 22
SPEEDUP_LEVELS = (1, 2, 3)


def main(gate, path):
    report = json.load(open(path))
    cases = report.pop("cases", [])
    print(json.dumps(report, indent=2))
    problems = []

    if not report.get("ok"):
        problems.append("page reported an error: " + str(report.get("error")))
    if not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if report.get("pool_threads") != 4:
        problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))

    if gate == "probe":
        print("StdRunner works in the browser: %r" % report.get("std_runner_works"))
    if gate == "g1" and report.get("sum") != "2499487497200":
        problems.append("wrong parallel sum: %r" % report.get("sum"))

    if gate == "g2":
        if len(cases) != G2_CASES:
            problems.append("expected %d cases, got %d" % (G2_CASES, len(cases)))
        for c in cases:
            flag = "ok " if c["ok"] else "BAD"
            print("%s level %d n %4d threads %d block %dx%d  %8.1f ms  %s" % (
                flag, c["level"], c["n"], c["threads"], c["tile_k"], c["tile_j"], c["ms"], c["hash"]))
            if not c["ok"]:
                problems.append("hash mismatch: %r" % c)

        def ms(level, n, threads):
            return next(c["ms"] for c in cases
                        if (c["level"], c["n"], c["threads"], c["tile_k"]) == (level, n, threads, 32))

        if not problems:
            for level in SPEEDUP_LEVELS:
                print("speedup level %d n 512: 1 -> 4 threads = %.2fx (indicative only)"
                      % (level, ms(level, 512, 1) / ms(level, 512, 4)))

    if problems:
        print("GATE %s: FAIL" % gate.upper())
        for problem in problems:
            print(" -", problem)
        return 1
    print("GATE %s: PASS" % gate.upper())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
````

- [ ] **Step 2: Replace `web/wasm/gate.sh`**

Overwrite the whole file (it stays executable):

````bash
#!/usr/bin/env bash
# Runs one browser gate headlessly and exits non-zero unless it passes.
# usage: gate.sh g1|g2|probe [--no-build]
#   g1     the thread pool starts and runs a parallel sum
#   g2     22 cases (levels 0 to 3) must hash exactly like native Rust
#   probe  informational: records that StdRunner traps in the browser
# env: WASM_BINDGEN (path to the CLI), PORT (default 8765), TIMEOUT (seconds)
# --no-build reuses pkg/, but refuses if pkg/ is missing, was built for the
# bundler, or is older than the sources.
set -euo pipefail
cd "$(dirname "$0")"
GATE=${1:?usage: gate.sh g1|g2|probe [--no-build]}
case "$GATE" in
  g1|g2|probe) URL="www/gate.html?gate=$GATE" ;;
  *) echo "unknown gate: $GATE" >&2; exit 2 ;;
esac

if [ "${2:-}" = "--no-build" ]; then
  WASM=pkg/naive_matmul_web_bg.wasm
  if [ ! -f "$WASM" ]; then
    echo "REFUSING: $WASM is missing; run ./build.sh (or drop --no-build)"; exit 1
  fi
  if [ "$(cat pkg/.features 2>/dev/null || echo unknown)" != "no-bundler" ]; then
    echo "REFUSING: pkg/ was not built with the no-bundler feature; run ./build.sh (or drop --no-build)"; exit 1
  fi
  NEWER=$(find src examples Cargo.toml ../../src ../../Cargo.toml -name '*.rs' -newer "$WASM" -print -quit -o -name Cargo.toml -newer "$WASM" -print -quit)
  if [ -n "$NEWER" ]; then
    echo "REFUSING: $NEWER is newer than $WASM; run ./build.sh (or drop --no-build)"; exit 1
  fi
else
  ./build.sh
fi

mkdir -p target
if ! cargo run --release --example expected 2> target/expected-build.log > www/expected.json; then
  cat target/expected-build.log
  echo "FAIL: could not generate the expected hashes"
  exit 1
fi
export REPORT="$PWD/target/$GATE-report.json" LOG="$PWD/target/$GATE-server.log"
rm -f "$LOG"
../dev/run_page.sh . "$URL" "${TIMEOUT:-180}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I ../dev/check_report.py "$GATE" "$REPORT"
````

- [ ] **Step 3: Run the three gates**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
./gate.sh g1                    # builds, then runs
./gate.sh g2 --no-build
./gate.sh probe --no-build
```

Expected: each ends in `GATE G1: PASS`, `GATE G2: PASS` (22 `ok ` lines and three `speedup` lines) and `GATE PROBE: PASS` (with `StdRunner works in the browser: False`).

- [ ] **Step 4: Check the build-mode guard**

```bash
FEATURES= ./build.sh >/dev/null 2>&1
./gate.sh g1 --no-build; echo "exit $?"      # expect: REFUSING: pkg/ was not built with the no-bundler feature ... then exit 1
./build.sh >/dev/null 2>&1                   # back to the default mode
```

- [ ] **Step 5: Commit**

```bash
git add web/dev/check_report.py web/wasm/gate.sh
git commit -m "move the gate checks into check_report.py and guard the build mode"
```

---

### Task 5: Level 4 in the wasm wrapper and the g2 gate (gate G4)

`run_hash` gains level 4 (`streaming` with 64 x 64 x 64 tiles into a `MemorySink`, on the same runner). The g2 gate grows from 22 to 29 cases: level 4 at n = 256 and 512 with 1, 2 and 4 threads, plus one with block sizes 7 x 2. Each is compared with the native hash.

**Files:**
- Modify: `web/wasm/src/cases.rs`, `web/wasm/src/lib.rs`, `web/wasm/www/worker.js`, `web/dev/check_report.py`, `web/wasm/gate.sh`

- [ ] **Step 1: Apply the edits**


In `web/wasm/src/cases.rs`, replace:

````text
use naive_matmul::cache_friendly::{self, BlockConfig};
use naive_matmul::runner::Runner;
use naive_matmul::{naive, simd, threaded, Matrix};
````

with:

````text
use naive_matmul::cache_friendly::{self, BlockConfig};
use naive_matmul::runner::Runner;
use naive_matmul::streaming::{self, MemorySink, StreamConfig};
use naive_matmul::{naive, simd, threaded, Matrix};
````

In `web/wasm/src/cases.rs`, replace:

````text
/// Multiplies two `n × n` rough matrices at `level` (0 = naive, 1 = threaded,
/// 2 = cache_friendly, 3 = simd) and returns the result's bit hash.
///
/// Levels 1 to 3 run their row blocks on `runner`.
````

with:

````text
/// Multiplies two `n × n` rough matrices at `level` (0 = naive, 1 = threaded,
/// 2 = cache_friendly, 3 = simd, 4 = streaming with 64 × 64 × 64 tiles) and
/// returns the result's bit hash.
///
/// Levels 1 to 4 run their work on `runner`.
````

In `web/wasm/src/cases.rs`, replace:

````text
    let c = match level {
        0 => naive::matmul(&a, &b),
        1 => threaded::matmul_with_runner(&a, &b, threads, runner),
        2 => cache_friendly::matmul_with_runner(&a, &b, threads, &block, runner),
        3 => simd::matmul_with_runner(&a, &b, threads, &block, runner),
        other => return Err(format!("level must be 0 to 3, got {other}")),
    }
    .map_err(|e| e.to_string())?;
    Ok(bit_hash(&c))
````

with:

````text
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
````

In `web/wasm/src/cases.rs`, replace:

````text
            for level in 1..=3 {
                for threads in [1, 3] {
````

with:

````text
            for level in 1..=4 {
                for threads in [1, 3] {
````

In `web/wasm/src/cases.rs`, replace:

````text
            for level in [2, 3] {
                let got = run_hash(level, 40, 2, tile_k, tile_j, &StdRunner).unwrap();
````

with:

````text
            for level in [2, 3, 4] {
                let got = run_hash(level, 40, 2, tile_k, tile_j, &StdRunner).unwrap();
````

In `web/wasm/src/cases.rs`, replace:

````text
        assert!(run_hash(9, 8, 1, 32, 64, &StdRunner).is_err());
````

with:

````text
        assert!(run_hash(5, 8, 1, 32, 64, &StdRunner).is_err());
        assert!(run_hash(9, 8, 1, 32, 64, &StdRunner).is_err());
````

In `web/wasm/src/lib.rs`, replace:

````text
/// Gate G2: the bit hash of a level's product, with its row blocks on the pool.
````

with:

````text
/// Gate G2: the bit hash of a level's product (0 to 4), with its work on the pool.
````

In `web/wasm/www/worker.js`, replace:

````text
    for (const level of [1, 2, 3]) {
````

with:

````text
    for (const level of [1, 2, 3, 4]) {
````

In `web/wasm/www/worker.js`, replace:

````text
  cases.push({ level: 2, n: 256, threads: 4, tile_k: 1, tile_j: 1 });
  return cases;
````

with:

````text
  cases.push({ level: 2, n: 256, threads: 4, tile_k: 1, tile_j: 1 });
  cases.push({ level: 4, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  return cases;
````

In `web/dev/check_report.py`, replace:

````text
  g2     every case's hash equals the native hash (levels 0 to 3)
````

with:

````text
  g2     every case's hash equals the native hash (levels 0 to 4)
````

In `web/dev/check_report.py`, replace:

````text
G2_CASES = 22
````

with:

````text
G2_CASES = 29
````

In `web/dev/check_report.py`, replace (include the final line break):

````text
SPEEDUP_LEVELS = (1, 2, 3)

````

with:

````text
SPEEDUP_LEVELS = (1, 2, 3, 4)

````

In `web/wasm/gate.sh`, replace:

````text
#   g2     22 cases (levels 0 to 3) must hash exactly like native Rust
````

with:

````text
#   g2     29 cases (levels 0 to 4) must hash exactly like native Rust
````

- [ ] **Step 2: Native tests**

Run (from `web/wasm`): `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: `test result: ok. 6 passed` (the level loops now cover level 4), no warnings.

- [ ] **Step 3: Run the gate**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`: `./gate.sh g2`
Expected: 29 lines starting `ok ` (none `BAD`), including `level 4 n  512 threads 4 block 32x64`, four `speedup` lines (levels 1 to 4), and `GATE G2: PASS`.

- [ ] **Step 4: Commit**

```bash
git add web/wasm/src/cases.rs web/wasm/src/lib.rs web/wasm/www/worker.js web/dev/check_report.py web/wasm/gate.sh
git commit -m "add level 4 to the wasm wrapper and the g2 gate"
```

---

### Task 6: The limits gate (G5)

An informational gate that records what the browser build can and cannot do: how long a pool takes to start at 1, 4 and 8 threads, whether the pool can be resized, what a panic in a pool job does, and where the 1 GiB memory cap bites. Each probe runs in a fresh Web Worker with a 30 second timeout (a trap can leave a module unusable, and a panic on the pool can leave the caller waiting forever, which is itself a result). It passes whenever the page ran and reported; it asserts nothing about the numbers.

**Files:**
- Create: `web/wasm/www/limits-worker.js`, `web/wasm/www/limits.html`
- Modify: `web/wasm/src/lib.rs`, `web/dev/check_report.py`, `web/wasm/gate.sh`

- [ ] **Step 1: Create the probe worker and page**


Create `web/wasm/www/limits-worker.js`:

````javascript
// One limits probe per fresh Worker (a trap can leave a module unusable).
// The page posts { kind, ... }; this replies with what happened.
import init, {
  initThreadPool,
  pool_threads,
  run_case,
  memory_probe,
  panic_probe,
} from '../pkg/naive_matmul_web.js';

self.onmessage = async (event) => {
  const message = event.data;
  const out = { outcome: 'ok' };
  try {
    await init();
    if (message.kind === 'pool') {
      const started = performance.now();
      await initThreadPool(message.threads);
      out.init_ms = performance.now() - started;
      out.pool_threads = pool_threads();
      const ran = performance.now();
      out.hash = run_case(3, 256, message.threads, 32, 64);
      out.run_ms = performance.now() - ran;
    } else if (message.kind === 'reinit') {
      await initThreadPool(4);
      out.first_pool = pool_threads();
      try {
        await initThreadPool(2);
        out.second_init = 'ok';
        out.second_pool = pool_threads();
      } catch (e) {
        out.second_init = 'error';
        out.second_error = String(e);
        out.pool_after = pool_threads();
      }
    } else if (message.kind === 'panic') {
      await initThreadPool(4);
      try {
        panic_probe();
        out.panic_probe = 'returned';
      } catch (e) {
        out.panic_probe = 'threw';
        out.panic_error = String(e);
      }
      try {
        out.still_usable = run_case(1, 64, 2, 32, 64);
      } catch (e) {
        out.still_usable = 'no: ' + String(e);
      }
    } else if (message.kind === 'memory') {
      out.checksum = String(memory_probe(message.mib));
    } else {
      throw new Error('unknown probe: ' + message.kind);
    }
  } catch (e) {
    out.outcome = 'error';
    out.error = String((e && e.message) || e);
  }
  self.postMessage(out);
};
````

Create `web/wasm/www/limits.html`:

````html
<!doctype html>
<meta charset="utf-8">
<title>limits</title>
<script type="module">
  // Runs each probe in a fresh Worker, with a timeout: a panic on the pool can
  // leave the caller waiting forever, and that is itself a result worth recording.
  function probe(message, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const worker = new Worker('./limits-worker.js', { type: 'module' });
      const finish = (extra) => {
        clearTimeout(timer);
        worker.terminate();
        resolve({ ...message, ...extra });
      };
      const timer = setTimeout(() => finish({ outcome: 'hung', timeout_ms: timeoutMs }), timeoutMs);
      worker.onmessage = (event) => finish(event.data);
      worker.onerror = (event) => finish({ outcome: 'worker error', error: event.message });
      worker.postMessage(message);
    });
  }

  const plan = [
    { kind: 'pool', threads: 1 },
    { kind: 'pool', threads: 4 },
    { kind: 'pool', threads: 8 },
    { kind: 'reinit' },
    { kind: 'panic' },
    ...[256, 512, 768, 896, 1000, 1100].map((mib) => ({ kind: 'memory', mib })),
  ];
  const probes = [];
  for (const message of plan) probes.push(await probe(message));
  await fetch('/report', {
    method: 'POST',
    body: JSON.stringify({ gate: 'g5', ok: true, isolated: self.crossOriginIsolated, probes }),
  });
</script>
````

- [ ] **Step 2: Apply the edits**

In `web/wasm/src/lib.rs`, replace:

````text
/// The same case with the standard-library runner.
````

with:

````text
/// Gate G5 probe: allocates and touches `mib` MiB of memory.
///
/// Shows where the module's memory cap bites. A failed allocation aborts the
/// module (`panic=abort`), which the page sees as a `RuntimeError`.
#[wasm_bindgen]
pub fn memory_probe(mib: usize) -> Result<u64, JsError> {
    let bytes = mib
        .checked_mul(1024 * 1024)
        .ok_or_else(|| JsError::new("size overflows usize"))?;
    let mut buffer = vec![0_u8; bytes];
    for index in (0..buffer.len()).step_by(4096) {
        buffer[index] = 1;
    }
    Ok(buffer.iter().step_by(4096).map(|&byte| u64::from(byte)).sum())
}

/// Gate G5 probe: a job on the pool panics. With `panic=abort` this traps.
#[wasm_bindgen]
pub fn panic_probe() {
    let jobs: Vec<Box<dyn FnOnce() + Send>> = vec![Box::new(|| panic!("probe panic"))];
    RayonRunner.run(jobs);
}

/// The same case with the standard-library runner.
````

In `web/dev/check_report.py`, replace (include the final line break):

````text
  probe  informational: records whether StdRunner works in the browser

````

with:

````text
  probe  informational: records whether StdRunner works in the browser
  g5     informational: records limits (pool start-up, re-init, panic, memory)

````

In `web/dev/check_report.py`, replace (include the final line break):

````text
    cases = report.pop("cases", [])

````

with:

````text
    cases = report.pop("cases", [])
    probes = report.pop("probes", [])

````

In `web/dev/check_report.py`, replace:

````text
    if report.get("pool_threads") != 4:
````

with:

````text
    if gate != "g5" and report.get("pool_threads") != 4:
````

In `web/dev/check_report.py`, replace (include the final line break):

````text
    if problems:

````

with:

````text
    if gate == "g5":
        if not probes:
            problems.append("no probes were reported")
        for probe in probes:
            print("probe " + json.dumps(probe, sort_keys=True))

    if problems:

````

In `web/wasm/gate.sh`, replace (include the final line break):

````text
# usage: gate.sh g1|g2|probe [--no-build]

````

with:

````text
# usage: gate.sh g1|g2|probe|g5 [--no-build]

````

In `web/wasm/gate.sh`, replace (include the final line break):

````text
#   probe  informational: records that StdRunner traps in the browser

````

with:

````text
#   probe  informational: records that StdRunner traps in the browser
#   g5     informational: records limits (pool start-up, re-init, panic, memory)

````

In `web/wasm/gate.sh`, replace:

````text
GATE=${1:?usage: gate.sh g1|g2|probe [--no-build]}
````

with:

````text
GATE=${1:?usage: gate.sh g1|g2|probe|g5 [--no-build]}
````

In `web/wasm/gate.sh`, replace:

````text
  g1|g2|probe) URL="www/gate.html?gate=$GATE" ;;
  *)
````

with:

````text
  g1|g2|probe) URL="www/gate.html?gate=$GATE" ;;
  g5) URL="www/limits.html" ;;
  *)
````

- [ ] **Step 3: Native tests and the wasm build still pass**

Run (from `web/wasm`): `cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"`
Expected: `6 passed`, no warnings.

- [ ] **Step 4: Run the gate**

From `web/wasm`: `./gate.sh g5` (about 40 seconds; the panic probe waits out its 30 second timeout).
Expected: eleven lines starting `probe {`, then `GATE G5: PASS`. In those lines you should see: the three `pool` probes with `"outcome": "ok"`, the `reinit` probe with `"second_init": "error"` and `"pool_after": 4`, the `panic` probe with `"outcome": "hung"`, memory probes up to 1000 MiB with `"outcome": "ok"`, and the 1100 MiB probe with `"error": "unreachable executed"`. If the picture differs materially, still commit, and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add web/wasm/www/limits-worker.js web/wasm/www/limits.html web/wasm/src/lib.rs web/dev/check_report.py web/wasm/gate.sh
git commit -m "add the limits gate (g5)"
```

---

### Task 7: A Docker wrapper for Node, and a dev server that can omit the isolation headers

The host has no Node; it runs in the `node:latest` image. `web/dev/node.sh` runs a command in that image with `web/` mounted at `/work` and your uid, so files it creates (`node_modules`, `dist`) are yours. The dev server learns `NO_ISOLATION=1`, which sends no COOP or COEP headers, imitating GitHub Pages.

**Files:**
- Create: `web/dev/node.sh`
- Modify: `web/dev/serve.py`

- [ ] **Step 1: Create the wrapper**


Create `web/dev/node.sh` (then `chmod +x`):

````bash
#!/usr/bin/env bash
# Runs a command in a Node container with this repository's web/ directory
# mounted at /work. Files it writes are owned by you, not root.
# usage: node.sh SUBDIR COMMAND...        e.g.  node.sh site npm run build
# env: NODE_IMAGE  image to use (default: node:latest)
set -euo pipefail
WEB=$(cd "$(dirname "$0")/.." && pwd)
SUBDIR=${1:?usage: node.sh SUBDIR COMMAND...}
shift
exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_update_notifier=false \
  -e ASTRO_TELEMETRY_DISABLED=1 \
  -v "$WEB:/work" -w "/work/$SUBDIR" \
  "${NODE_IMAGE:-node:latest}" "$@"
````

- [ ] **Step 2: Add the no-isolation mode to the dev server**

In `web/dev/serve.py`, replace (include the final line break):

````text
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")

````

with:

````text
        if not os.environ.get("NO_ISOLATION"):
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")

````

In `web/dev/serve.py`, replace:

````text
Serves the current directory with the cross-origin-isolation headers that
SharedArrayBuffer needs, and records the page's POST /report body to $REPORT.
````

with:

````text
Serves the current directory with the cross-origin-isolation headers that
SharedArrayBuffer needs (unless $NO_ISOLATION is set, to imitate a host such as
GitHub Pages that cannot send them), and records the page's POST /report body
to $REPORT.
````

- [ ] **Step 3: Verify**

```bash
web/dev/node.sh . sh -c 'node --version; npm --version; id -u'     # expect v26.x.y, an npm version, and YOUR uid (not 0)
```

Check the two server modes (the ports are arbitrary):

```bash
cd web/dev
NO_ISOLATION=1 REPORT=/dev/null python3 -I serve.py 8790 & P1=$!
REPORT=/dev/null python3 -I serve.py 8791 & P2=$!
sleep 1
curl -sI http://127.0.0.1:8790/serve.py | grep -ci cross-origin    # expect 0
curl -sI http://127.0.0.1:8791/serve.py | grep -ci cross-origin    # expect 2
kill $P1 $P2; cd ../..
```

- [ ] **Step 4: Commit**

```bash
git add web/dev/node.sh web/dev/serve.py
git commit -m "add a Docker wrapper for Node and a no-isolation mode for the dev server"
```

---

### Task 8: The Astro site skeleton and the production-build gate (G3)

A minimal Astro project whose one page runs the same worker as the plain gates (`web/wasm/www/worker.js`, imported by URL so there is a single copy). `coi-serviceworker` is loaded first: on a host that cannot send COOP and COEP headers (GitHub Pages) it registers, reloads the page once, and from then on adds the headers itself. `base` is `/matmul_levels.rs/`, the project-site path. `gate-g3.sh` builds the wasm in bundler mode, builds the site in Docker, serves `dist/` under `/matmul_levels.rs/` with **no** isolation headers, opens it in headless Firefox, and passes only if all 29 cases hash like native Rust and the page had to reload (proving isolation came from the service worker).

This is the stage B skeleton, not the real site: stage C replaces the page.

**Files:**
- Create: `web/site/package.json`, `web/site/astro.config.mjs`, `web/site/src/pages/index.astro`, `web/site/gate-g3.sh`, `web/site/package-lock.json` (generated)
- Modify: `.gitignore`, `web/dev/check_report.py`

- [ ] **Step 1: Create the site files**


Create `web/site/package.json`:

````json
{
  "name": "matmul-levels-site",
  "private": true,
  "type": "module",
  "scripts": {
    "prebuild": "mkdir -p public && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js",
    "build": "astro build"
  },
  "dependencies": {
    "astro": "7.4.7",
    "coi-serviceworker": "0.1.7"
  }
}
````

Create `web/site/astro.config.mjs`:

````javascript
import { defineConfig } from 'astro/config';

// GitHub Pages serves this repository at /matmul_levels.rs/.
export default defineConfig({
  base: '/matmul_levels.rs/',
  trailingSlash: 'always',
  vite: { worker: { format: 'es' } },
});
````

Create `web/site/src/pages/index.astro`:

````astro
---
// Stage B gate G3 page: runs the same worker as the plain gates, from a
// production build. The real site replaces this page.
const base = import.meta.env.BASE_URL;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>gate</title>
    <!-- GitHub Pages cannot send the headers SharedArrayBuffer needs, so this
         service worker adds them and reloads the page once. It must be a plain
         same-origin script, loaded before anything else. -->
    <script is:inline src={`${base}coi-serviceworker.js`}></script>
  </head>
  <body>
    <p id="status">starting</p>
    <script>
      const status = document.getElementById('status');
      const base = import.meta.env.BASE_URL;
      const gate = new URLSearchParams(location.search).get('gate') || 'g2';

      async function post(result) {
        await fetch('/report', { method: 'POST', body: JSON.stringify(result) });
      }

      async function main() {
        if (!self.crossOriginIsolated) {
          // coi-serviceworker registers, then reloads the page once. Count the
          // loads so a service worker that never takes over is reported.
          const loads = Number(sessionStorage.getItem('loads') || 0) + 1;
          sessionStorage.setItem('loads', String(loads));
          status.textContent = `not isolated yet (load ${loads})`;
          if (loads >= 3) {
            await post({ gate, ok: false, isolated: false, base, loads, error: 'still not cross-origin isolated after reloads' });
          }
          return;
        }
        status.textContent = 'isolated; running ' + gate;
        const expected = await (await fetch(`${base}expected.json`)).json();
        // The same worker the plain gates use; its wasm import resolves to web/wasm/pkg.
        const worker = new Worker(new URL('../../../wasm/www/worker.js', import.meta.url), { type: 'module' });
        const result = await new Promise((resolve) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = (event) => resolve({ gate, ok: false, error: 'worker error: ' + event.message });
          worker.postMessage({ gate, threads: 4, expected });
        });
        result.base = base;
        result.loads = Number(sessionStorage.getItem('loads') || 0);
        await post(result);
        status.textContent = result.ok ? 'done' : 'failed';
      }
      main();
    </script>
  </body>
</html>
````

Create `web/site/gate-g3.sh` (then `chmod +x`):

````bash
#!/usr/bin/env bash
# Gate G3: the wasm module from an Astro production build, served under
# /matmul_levels.rs/ WITHOUT cross-origin-isolation headers (as GitHub Pages
# would), made isolated by coi-serviceworker, run in headless Firefox. Passes
# only if all 29 cases hash exactly like native Rust and the page reloaded.
# usage: gate-g3.sh [--no-build]
# env: WASM_BINDGEN, NODE_IMAGE (default node:latest), PORT, TIMEOUT (seconds)
set -euo pipefail
cd "$(dirname "$0")"
SITE=$PWD
WASM=$SITE/../wasm

if [ "${1:-}" = "--no-build" ]; then
  if [ ! -f "$WASM/pkg/.features" ] || [ -n "$(cat "$WASM/pkg/.features")" ]; then
    echo "REFUSING: pkg/ was not built for the bundler; run ./gate-g3.sh without --no-build"; exit 1
  fi
else
  (cd "$WASM" && FEATURES= ./build.sh)
fi

mkdir -p "$WASM/target" "$SITE/public"
if ! (cd "$WASM" && cargo run --release --example expected 2> target/expected-build.log) > "$SITE/public/expected.json"; then
  cat "$WASM/target/expected-build.log"
  echo "FAIL: could not generate the expected hashes"
  exit 1
fi

[ -d node_modules ] || ../dev/node.sh site npm ci --no-audit --no-fund
../dev/node.sh site npm run build

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
ln -s "$SITE/dist" "$ROOT/matmul_levels.rs"
export NO_ISOLATION=1 REPORT="$WASM/target/g3-report.json" LOG="$WASM/target/g3-server.log"
rm -f "$LOG"
../dev/run_page.sh "$ROOT" "matmul_levels.rs/?gate=g2" "${TIMEOUT:-180}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I ../dev/check_report.py g3 "$REPORT"
````

- [ ] **Step 2: Ignore the generated files**

In `.gitignore`, replace (include the final line break):

````text
web/wasm/www/expected.json

````

with:

````text
web/wasm/www/expected.json
web/site/public/expected.json
web/site/public/coi-serviceworker.js

````

- [ ] **Step 3: Teach `check_report.py` the g3 gate**

In `web/dev/check_report.py`, replace (include the final line break):

````text
  g2     every case's hash equals the native hash (levels 0 to 4)

````

with:

````text
  g2     every case's hash equals the native hash (levels 0 to 4)
  g3     g2, run from the Astro production build under /matmul_levels.rs/ with
         isolation supplied by the service worker rather than server headers

````

In `web/dev/check_report.py`, replace:

````text
    if gate == "g2":
        if len(cases)
````

with:

````text
    if gate in ("g2", "g3"):
        if len(cases)
````

In `web/dev/check_report.py`, replace:

````text
    if gate == "g5":
        if not probes:
````

with:

````text
    if gate == "g3":
        if report.get("base") != "/matmul_levels.rs/":
            problems.append("wrong base path: %r" % report.get("base"))
        if not report.get("loads", 0) >= 1:
            problems.append("the page never reloaded: isolation did not come from the service worker")

    if gate == "g5":
        if not probes:
````

- [ ] **Step 4: Point `gate.sh` at the new gate**

In `web/wasm/gate.sh`, replace (include the final line break):

````text
#   g5     informational: records limits (pool start-up, re-init, panic, memory)

````

with:

````text
#   g5     informational: records limits (pool start-up, re-init, panic, memory)
# The Astro-build gate (g3) is web/site/gate-g3.sh.

````

- [ ] **Step 5: Install the dependencies in the container and create the lockfile**

From the repository root: `web/dev/node.sh site npm install --no-audit --no-fund`
Expected: `added 187 packages` (the count may differ by a few). It creates `web/site/node_modules/` (ignored) and `web/site/package-lock.json` (to be committed). Then confirm the lockfile pins the intended versions:

```bash
grep -c '"version": "7.4.7"' web/site/package-lock.json    # expect at least 1 (astro)
grep -c '"version": "0.1.7"' web/site/package-lock.json    # expect at least 1 (coi-serviceworker)
ls -ln web/site/package-lock.json | awk '{print $3}'      # expect your own uid, not 0
```

- [ ] **Step 6: Run the gate**

From `web/site`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`: `./gate-g3.sh`
Expected: the Astro build output (`1 page(s) built`), then a JSON header containing `"isolated": true`, `"pool_threads": 4`, `"base": "/matmul_levels.rs/"` and `"loads": 1`, then 29 lines starting `ok ` (none `BAD`), four `speedup` lines, and `GATE G3: PASS`. Vite prints one `INEFFECTIVE_DYNAMIC_IMPORT` warning about `workerHelpers.js`; it is benign (the helper imports its own package) and is expected.

If the page never reports (`FAIL: the page never reported`), look at `web/wasm/target/g3-server.log`: which files were requested tells you whether the service worker took over. Do not weaken the gate; stop and report BLOCKED.

- [ ] **Step 7: Verify the ignore rules**

```bash
git check-ignore -q web/site/public/expected.json;         echo $?   # 0
git check-ignore -q web/site/public/coi-serviceworker.js;  echo $?   # 0
git check-ignore -q web/site/node_modules/x;               echo $?   # 0
git check-ignore -q web/site/dist/index.html;              echo $?   # 0
git check-ignore -q web/site/package-lock.json;            echo $?   # 1 (tracked)
git status --short                                                    # only the files below
```

- [ ] **Step 8: Put `pkg/` back in the mode the plain gates need**

The G3 gate built the wasm for a bundler. Run `(cd web/wasm && ./build.sh)` so the plain gates work again.

- [ ] **Step 9: Commit**

```bash
git add .gitignore web/dev/check_report.py web/wasm/gate.sh web/site/package.json web/site/package-lock.json web/site/astro.config.mjs web/site/src/pages/index.astro web/site/gate-g3.sh
git commit -m "add the Astro site skeleton and the g3 gate"
```

---

### Task 9: Record the G4, G5 and G3 results

The spike's output is a findings document, written from actual gate output.

**Files:**
- Create: `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings-part-two.md`

- [ ] **Step 1: Run the gates and keep the output**

With `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
(cd web/wasm && ./gate.sh g5 2>&1 | tail -16)          # limits; about 40 s
(cd web/site && ./gate-g3.sh 2>&1 | tail -50)           # builds the bundler wasm and the site, then runs
(cd web/wasm && ./build.sh >/dev/null 2>&1)             # restore the no-bundler build afterwards
docker run --rm node:latest node --version               # for the Environment table
firefox --version
```

Both gates must end in `PASS`. **If either does not, stop and report BLOCKED; do not write the document.**

- [ ] **Step 2: Write the findings document**

Create `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings-part-two.md` with the text below and these substitutions, nothing else changed: replace the line `G5_OUTPUT` with the lines of the `g5` run that start with `probe {`, followed by the line `GATE G5: PASS` (verbatim, in printed order); replace the line `G3_OUTPUT` with the JSON header printed by the `g3` run (from the opening `{` to the closing `}`), then its lines starting `ok ` and `speedup`, then the line `GATE G3: PASS` (verbatim, in printed order); replace `FIREFOX_VERSION` with the output of `firefox --version` plus ` (headless)`; replace `NODE_VERSION` with the output of the node command above (for example `v26.13.0`).

````markdown
# Stage B findings, part two: gates G4, G5 and G3

Spec: `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-design.md`.
Plan: `docs/superpowers/plans/2026-11-05-stage-b-spike-part-two.md`.
Part one (G1 and G2): `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md`.

## Verdict

**G4, G5 and G3 are done, and G3 and G4 pass.** All five levels, including level 4,
run on a rayon thread pool in Firefox and return the native answer bit for bit.
The same module works from an Astro production build served under
`/matmul_levels.rs/` by a server that sends no cross-origin-isolation headers:
`coi-serviceworker` supplied them, after one automatic page reload. G5 measured
the limits below.

**Recommendation for stages C and D: GO**, with GitHub Pages as the host and
`coi-serviceworker` for isolation. The fallback (a host that sets headers, such
as Cloudflare Pages or Netlify `_headers`) is not needed for what was tested, but
real GitHub Pages was not tested (see "Not tested").

## Environment

| Item | Value |
|---|---|
| Browser | FIREFOX_VERSION |
| Node (Docker image `node:latest`) | NODE_VERSION |
| Astro | 7.4.7 (pinned in `web/site/package.json` and its lockfile) |
| `coi-serviceworker` | 0.1.7 (pinned) |
| Rust nightly, CLI, crates | as in part one |
| Machine | 8 hardware threads |

## G4: level 4 on the runner

Pass. `streaming::matmul_streaming_with_runner` hands the runner one job per worker
(`min(threads, tile count)` of them; none for an empty product); each job claims
output tiles from a shared counter and the first error is kept in a mutex. In the
browser, level 4 (64 x 64 x 64 tiles into a `MemorySink`) at n = 256 and 512 with
1, 2 and 4 threads, and once with block sizes 7 x 2, returned the native hash in
every case. The level 4 lines of the g2 output are part of the G3 output below
(the same 29 cases, run from the production build).

`threads` is the number of jobs (workers), handed to a fixed pool of 4, as for
the other levels. A panic in a source or sink now reaches the caller of
`matmul_streaming` as `StdRunner`'s generic "a scoped thread panicked" message
rather than the original payload (a runner that runs jobs inline or on rayon
rethrows the original).

## G5: measured limits

Output of `./gate.sh g5` from the run that produced this record:

```text
G5_OUTPUT
```

What it shows:

- **Pool start-up** took from about 30 ms to about half a second. Three runs of this gate gave 110/30/97, 56/120/209 and 37/110/517 ms for 1/4/8 threads: it varies a lot from run to run, and larger pools were slower in two of the three. Treat it as tens to hundreds of milliseconds, not a benchmark, and start the pool once per Worker, ahead of the first call.
- **A pool cannot be resized.** A second `initThreadPool` with a different size fails with `unwrap_throw() on an Err value` (rayon's global pool is built once) and the pool stays at its first size. Changing the thread count in the UI therefore means a fresh Worker, or varying the number of jobs over a fixed pool.
- **A panic in a pool job hangs the caller.** The job traps (`panic=abort`), the thread that called `run` waits forever, and no error reaches JavaScript. Every call must have a timeout and a way to terminate the Worker; the probe page does this with a 30 second timer and `worker.terminate()`.
- **The 1 GiB memory cap is real.** Allocating and touching 1000 MiB worked; 1100 MiB aborted with `RuntimeError: unreachable executed`. The cap comes from `--max-memory=1073741824` in the build flags and could be raised at build time. For scale: three `n x n` `f64` matrices take `24 n^2` bytes, so levels 0 to 3 fit under about 1000 MiB up to roughly `n = 6,000` (derived, not measured), and level 4 with its in-memory sink somewhat less. Running time, not memory, limits `n` first in the browser.

## G3: the production build under a Pages-style subpath

Pass. Output of `./gate-g3.sh` from the run that produced this record (the Astro
build lines are trimmed):

```text
G3_OUTPUT
```

How it was set up, and what the result means:

- The site is built by Astro inside a Docker container (`web/dev/node.sh`, files owned by the host user), with `base: '/matmul_levels.rs/'`.
- `dist/` was served under `/matmul_levels.rs/` by `web/dev/serve.py` with `NO_ISOLATION=1`: **no COOP or COEP headers**. The page was therefore not isolated on first load.
- `coi-serviceworker.js` (a plain, unbundled, same-origin script loaded first) registered, the page reloaded once (`"loads": 1` in the report), and the second load had `crossOriginIsolated === true`. The worker, the wasm and the 4-thread pool then ran from the bundled output. All 29 cases matched the native hashes.
- Bundler mode of `wasm-bindgen-rayon` works under Vite, with two conditions found along the way: the wasm must be built without the `no-bundler` feature (`FEATURES= ./build.sh`), and `pkg/` needs a `package.json` that the raw `wasm-bindgen` CLI does not write (its worker helper does `import('../../..')`). `build.sh` now handles both.
- Vite prints one `INEFFECTIVE_DYNAMIC_IMPORT` warning (the worker helper imports its own package both statically and dynamically). It is benign.
- The shared worker (`web/wasm/www/worker.js`) is imported by URL from the Astro page, so the plain gates and the site run the same code.

## Not tested

- A real deployment on GitHub Pages (HTTPS, CDN caching, service worker update behaviour, the first-visit reload as a user sees it). The local test imitates the missing headers but not the host.
- Which COEP mode `coi-serviceworker` chose (`credentialless` by default, falling back to `require-corp`); the page was isolated either way.
- Browsers other than Firefox 159, and Firefox on other platforms.
- `+simd128` in the wasm build (level 3 is scalar in the browser), and any build with a different pool size or memory cap.
- The real site, the Benchmark and Tuner UI, cancellation, and a single-threaded fallback for pages that are not isolated (stage C and D design).

## Consequences for stages C and D

- Use the real crate in the browser for all five levels, through `RayonRunner`, inside a Web Worker (rayon waits with `Atomics.wait`, which the main thread may not do).
- Host on GitHub Pages with `coi-serviceworker`. Expect one reload on a visitor's first visit, and tell them (the script's `quiet` option and a visible message help).
- Treat the pool size as fixed per Worker; vary `threads` as a job count, or start a new Worker to change the pool.
- Wrap every call in a timeout and terminate the Worker on expiry; a panic in a job cannot be caught.
- Cap `n` in the UI by running time and by the 1 GiB limit; expose the limit in the build flags if bigger inputs matter.
- Keep Node in Docker (`web/dev/node.sh`); in CI use the official Node setup action with a pinned version instead of `node:latest`.
````

- [ ] **Step 3: Verify**

Run: `grep -c "G5_OUTPUT\|G3_OUTPUT\|FIREFOX_VERSION\|NODE_VERSION" docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings-part-two.md`
Expected: `0`

Run: `grep -c "^ok " docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings-part-two.md; grep -c "^probe {" docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings-part-two.md`
Expected: `29`, then `11`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings-part-two.md
git commit -m "record stage B gates G4, G5 and G3"
```

---

### Task 10: Document the site and the Docker workflow in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Apply the edits**


In `CLAUDE.md`, replace:

````text
`web/dev/` holds a stdlib-only dev server and a headless-Firefox page runner.
````

with:

````text
`web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). For now it holds the stage B gate page, not the real site.
````

In `CLAUDE.md`, replace:

````text
./gate.sh g1|g2|probe [--no-build]              # build, then run a gate in headless Firefox; --no-build reuses pkg/
````

with:

````text
./gate.sh g1|g2|probe|g5 [--no-build]           # build, then run a gate in headless Firefox; --no-build reuses pkg/
(cd ../site && ./gate-g3.sh [--no-build])       # Astro production build (Node in Docker) served under /matmul_levels.rs/ with no isolation headers; coi-serviceworker supplies them
````

- [ ] **Step 2: Verify**

Run: `grep -n "node.sh\|gate-g3\|g1|g2|probe|g5" CLAUDE.md | cut -c1-120`
Expected: three lines (the "What this is" paragraph, and the two command lines).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "document the site and the Docker workflow in CLAUDE.md"
```

---

## After this plan

If every task passes, the stage B spike is complete: the real crate (all five levels) runs on a thread pool in a browser, bit-for-bit like native Rust, from a production build served the way GitHub Pages serves it, and the limits are measured. Next: the stage C plan (the real Astro site: the prose pipeline from `docs/`, the StepThrough demo, then the Benchmark and Tuner), designed around the constraints recorded in the part two findings. Still to test when the site is deployed for real: GitHub Pages itself, other browsers, and `+simd128`.
