# Stage C1: The Site Shell and the Prose Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A` or `git add .`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Build the first of three parts of the website: the wrapper crate's stable single-threaded ("lite") build, and an Astro site that renders the introduction and the five level chapters from `docs/` in a clean article layout, with the two Manim animations embedded, link and output checks, and a Pages workflow that builds on request.

**Architecture:** The wrapper crate (`web/wasm`) gets a `threads` cargo feature: with it, the nightly threaded build used by the playground; without it, a stable build whose levels run on the calling thread. A remark plugin in `web/site` turns the Markdown in `docs/` (written for rustdoc) into site pages: it strips rustdoc-hidden lines, demotes headings, rewrites intra-doc links through an explicit table (anything unlisted fails the build), and inserts figures after named headings. A checker script verifies the built output. The stage B gate page moves to `/gate/`.

**Tech Stack:** Rust (stable and the pinned `nightly-2025-11-15`), `wasm-bindgen` `=0.2.130`; Astro 7.4.7 with `@astrojs/markdown-remark` 7.3.6; Node from the `node:latest` Docker image (v26.13.0); `unified` 11 for the plugin tests; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-stage-c-site-design.md` (plan C1 of C1 to C3). Stage B results: `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings-part-two.md`.

## Global Constraints

- The core crate `naive_matmul` is not modified by this plan: it stays dependency-free, `#![forbid(unsafe_code)]`, MSRV 1.73. Everything here lives under `web/`, `.github/`, `.gitignore` and `CLAUDE.md`.
- Every level returns bit-for-bit identical results; a runner changes where jobs run, never what they compute. The lite build must give the same hashes as native Rust.
- `web/wasm` keeps its empty `[workspace]` table and tracked `Cargo.lock`; `wasm-bindgen` stays pinned `=0.2.130`.
- `docs/` is the single source of truth for prose (shared with rustdoc): it is rendered, never copied or edited, by the site. Never glob `docs/**`; `docs/superpowers/` is not product documentation.
- Node runs only in Docker (`web/dev/node.sh`); the host has no Node. Files it writes must be owned by the host user.
- A service worker only adds the isolation headers to responses inside its scope, and the worker script and wasm are served from `/_astro/`, so the service worker's scope is the whole site; chapters never load the registering script.
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- Rust: `nightly-2025-11-15` (with `rust-src` and the `wasm32-unknown-unknown` target), stable (also with the wasm target) and `1.73`; the `wasm-bindgen` CLI 0.2.130 at `$HOME/.cargo/bin/wasm-bindgen`. In every shell that builds or runs gates: `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`.
- Docker with the `node:latest` image (do not pull anything; if docker tries to, stop and report BLOCKED); your user can use it. Firefox 159 for the headless gates (do not kill other Firefox processes: only ones whose command line contains `--headless` are ours). Gates run one at a time (port 8765).
- A cold wasm build takes 30 to 60 seconds; give shell commands a generous timeout (600000 ms).
- Astro keeps rendered docs in `web/site/node_modules/.astro`, keyed by the Markdown and **not** by the plugin: after Task 7 `npm run build` clears it first, but before that, delete `web/site/node_modules/.astro` yourself if a plugin change seems to be ignored.

## Verified beforehand

The code in this plan was built and run end to end on this machine before the plan was written (native tests, the stable wasm build, every browser gate in headless Firefox, the plugin tests, the Astro build, the dist checker, screenshots in light, dark and phone width), and the whole sequence was replayed against a fresh copy of the repository. If a step's result differs from what it states, stop and report BLOCKED with the output.

---

### Task 1: Keep the threaded compiler flags in `build.sh`

The threaded build's flags (atomics, shared memory, the TLS exports) live in `web/wasm/.cargo/config.toml`, where they also apply to any other build of the crate for `wasm32`. The stable single-threaded build (Task 2 and 3) must not get them, so they move into `build.sh`, applied through `RUSTFLAGS` only to the threaded build. `build.sh` also refuses a `FEATURES` value that is not `threads` or `no-bundler`.

**Files:**
- Modify: `web/wasm/build.sh`
- Delete: `web/wasm/.cargo/config.toml`

- [ ] **Step 1: Apply the edits**


In `web/wasm/build.sh`, replace:

````text
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured (default: ./target)
#      FEATURES      cargo features. Unset: no-bundler, for pages that load the
#                    module without a bundler (the gates). Set to the empty
#                    string (FEATURES= ./build.sh) for the bundler build used by
#                    the Astro site. The choice is recorded in pkg/.features.
````

with:

````text
# This is the THREADED build. The stable, single-threaded build is build-lite.sh.
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured (default: ./target)
#      FEATURES      cargo features. Unset: no-bundler, for pages that load the
#                    module without a bundler (the gates). `FEATURES=threads` is
#                    the bundler build used by the Astro site. The choice is
#                    recorded in pkg/.features.
````

In `web/wasm/build.sh`, replace (include the final line break):

````text
FEATURES=${FEATURES-no-bundler}
TARGET_DIR=${CARGO_TARGET_DIR:-$PWD/target}
cargo build --release --target wasm32-unknown-unknown \
  --features "$FEATURES" -Z build-std=panic_abort,std

````

with:

````text
FEATURES=${FEATURES-no-bundler}
case "$FEATURES" in
  threads|no-bundler) ;;
  *) echo "FEATURES must be 'threads' or 'no-bundler' (got '$FEATURES'); the stable build is build-lite.sh" >&2; exit 2 ;;
esac
TARGET_DIR=${CARGO_TARGET_DIR:-$PWD/target}

# Atomics, shared memory and the TLS exports that wasm-bindgen-rayon needs. They
# live here, not in .cargo/config.toml, so the stable single-threaded build and
# native `cargo test` never see them. RUSTFLAGS replaces any other rustflags.
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--import-memory"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base"
export RUSTFLAGS

cargo build --release --target wasm32-unknown-unknown \
  --features "$FEATURES" -Z build-std=panic_abort,std

````

- [ ] **Step 2: Delete the cargo config**

```bash
git rm web/wasm/.cargo/config.toml
```

- [ ] **Step 3: Verify**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
bash -n build.sh                      # no output
FEATURES=oops ./build.sh; echo "exit $?"   # expect the message "FEATURES must be 'threads' or 'no-bundler' ..." and exit 2
./gate.sh g1                          # builds (about 40 s cold), then: GATE G1: PASS
./gate.sh g2 --no-build               # GATE G2: PASS
./gate.sh probe --no-build            # GATE PROBE: PASS
```

- [ ] **Step 4: Commit**

```bash
git add web/wasm/build.sh web/wasm/.cargo/config.toml
git commit -m "keep the threaded compiler flags in build.sh"
```

(`git rm` already staged the deletion; the `git add` of the deleted path is harmless.)

---

### Task 2: A stable, single-threaded build of the wasm wrapper

The wrapper gets a cargo feature `threads` (off by default). With it, the crate is the nightly threaded build used so far (`RayonRunner`, `init_thread_pool`, the stage B probes). Without it the crate needs neither `rayon` nor `wasm-bindgen-rayon` (the nightly-only dependencies), builds on **stable**, and runs every level on the calling thread through a new `InlineRunner` (`threads` is still the number of jobs, run one after another). `no-bundler` now implies `threads`.

**Files:**
- Modify: `web/wasm/Cargo.toml`, `web/wasm/src/lib.rs`

**Interfaces:**
- Produces: `naive_matmul_web::InlineRunner` (implements `Runner`); feature `threads`; without it `run_case(level, n, threads, tile_k, tile_j) -> Result<String, JsError>` runs on `InlineRunner`.
- Changes: `cargo test` in `web/wasm` runs 5 tests by default; `cargo test --features threads` runs 7 (the two rayon tests).

- [ ] **Step 1: Write the failing test**


In `web/wasm/src/lib.rs`, replace:

````text
#[cfg(test)]
mod tests {
    use super::*;
    use crate::cases::run_hash;

    #[test]
    fn rayon_runner_gives_the_same_hash_as_the_std_runner() {
````

with:

````text
#[cfg(test)]
mod inline_tests {
    use super::*;
    use crate::cases::run_hash;

    #[test]
    fn inline_runner_gives_the_same_hash_as_the_std_runner() {
        for level in 1..=4 {
            for threads in [1, 3] {
                let std = run_hash(level, 48, threads, 32, 64, &StdRunner).unwrap();
                let inline = run_hash(level, 48, threads, 32, 64, &InlineRunner).unwrap();
                assert_eq!(std, inline, "level {level}, {threads} threads");
            }
        }
    }
}

#[cfg(all(test, feature = "threads"))]
mod tests {
    use super::*;
    use crate::cases::run_hash;

    #[test]
    fn rayon_runner_gives_the_same_hash_as_the_std_runner() {
````

- [ ] **Step 2: Run it to see the failure**

From `web/wasm`: `cargo test 2>&1 | grep -E "^error"`
Expected: `error[E0425]: cannot find value `InlineRunner` in this scope`.

- [ ] **Step 3: Implement**


In `web/wasm/Cargo.toml`, replace:

````text
[features]
# Needed when the page loads the wasm module without a bundler.
no-bundler = ["wasm-bindgen-rayon/no-bundler"]

[dependencies]
naive_matmul = { path = "../.." }
rayon = "1.8"
wasm-bindgen = "=0.2.130"
wasm-bindgen-rayon = "1.2"
````

with:

````text
[features]
# `threads` is the nightly build with a rayon pool. Without it the crate builds on
# stable Rust and runs every level on the calling thread (`InlineRunner`).
threads = ["dep:rayon", "dep:wasm-bindgen-rayon"]
# Needed when the page loads the threaded module without a bundler.
no-bundler = ["threads", "wasm-bindgen-rayon?/no-bundler"]

[dependencies]
naive_matmul = { path = "../.." }
rayon = { version = "1.8", optional = true }
wasm-bindgen = "=0.2.130"
wasm-bindgen-rayon = { version = "1.2", optional = true }
````

In `web/wasm/src/lib.rs`, replace:

````text
//! Everything here runs inside a Web Worker. The thread pool comes from
//! `wasm-bindgen-rayon`; [`RayonRunner`] hands the crate's row-block jobs to it.
````

with:

````text
//! Everything here runs inside a Web Worker. With the `threads` feature the thread
//! pool comes from `wasm-bindgen-rayon` and [`RayonRunner`] hands the crate's jobs
//! to it. Without it (the stable build) [`InlineRunner`] runs them one after
//! another on the calling thread.
````

In `web/wasm/src/lib.rs`, replace:

````text
use naive_matmul::runner::{Runner, StdRunner};
use rayon::prelude::*;
use wasm_bindgen::prelude::*;

pub use wasm_bindgen_rayon::init_thread_pool;

/// Runs each job on the rayon pool.
pub struct RayonRunner;

impl Runner for RayonRunner {
````

with:

````text
use naive_matmul::runner::{Runner, StdRunner};
#[cfg(feature = "threads")]
use rayon::prelude::*;
use wasm_bindgen::prelude::*;

#[cfg(feature = "threads")]
pub use wasm_bindgen_rayon::init_thread_pool;

/// Runs every job on the calling thread, one after another. The runner of the
/// stable build, which has no threads.
pub struct InlineRunner;

impl Runner for InlineRunner {
    fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>) {
        for job in jobs {
            job();
        }
    }
}

/// Runs each job on the rayon pool.
#[cfg(feature = "threads")]
pub struct RayonRunner;

#[cfg(feature = "threads")]
impl Runner for RayonRunner {
````

In `web/wasm/src/lib.rs`, replace:

````text
/// Gate G1 probe: a parallel sum that needs a working pool.
#[wasm_bindgen]
````

with:

````text
/// Gate G1 probe: a parallel sum that needs a working pool.
#[cfg(feature = "threads")]
#[wasm_bindgen]
````

In `web/wasm/src/lib.rs`, replace:

````text
/// Gate G1 probe: the number of threads in the rayon pool.
#[wasm_bindgen]
````

with:

````text
/// Gate G1 probe: the number of threads in the rayon pool.
#[cfg(feature = "threads")]
#[wasm_bindgen]
````

In `web/wasm/src/lib.rs`, replace:

````text
/// Gate G2: the bit hash of a level's product (0 to 4), with its work on the pool.
#[wasm_bindgen]
pub fn run_case(
````

with:

````text
/// Gate G2: the bit hash of a level's product (0 to 4), with its work on the pool.
#[cfg(feature = "threads")]
#[wasm_bindgen]
pub fn run_case(
````

In `web/wasm/src/lib.rs`, replace:

````text
/// Gate G5 probe: a job on the pool panics. With `panic=abort` this traps.
#[wasm_bindgen]
````

with:

````text
/// Gate G5 probe: a job on the pool panics. With `panic=abort` this traps.
#[cfg(feature = "threads")]
#[wasm_bindgen]
````

In `web/wasm/src/lib.rs`, replace:

````text
/// The same case with the standard-library runner.
````

with:

````text
/// The same case with every level run on the calling thread. The stable build's
/// `run_case`: `threads` is still the number of jobs, run one after another.
#[cfg(not(feature = "threads"))]
#[wasm_bindgen]
pub fn run_case(
    level: u32,
    n: usize,
    threads: usize,
    tile_k: usize,
    tile_j: usize,
) -> Result<String, JsError> {
    cases::run_hash(level, n, threads, tile_k, tile_j, &InlineRunner).map_err(|e| JsError::new(&e))
}

/// The same case with the standard-library runner.
````

- [ ] **Step 4: Verify**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
cargo test 2>&1 | grep -E "^(warning|error)|FAILED|test result"
# expect: test result: ok. 5 passed (and 0 doc tests), no warnings
cargo test --features threads 2>&1 | grep -E "^(warning|error)|FAILED|test result"
# expect: test result: ok. 7 passed
cargo +stable build --release --target wasm32-unknown-unknown --target-dir target-lite 2>&1 | grep -E "^(warning|error)|Finished"
# expect: Finished ... (the stable, no-threads build; nothing nightly is needed)
./gate.sh g2                          # the threaded build is unaffected: GATE G2: PASS
```

(The stable build writes `web/wasm/target-lite/`, which Task 3 ignores. Delete it afterwards if you like.)

- [ ] **Step 5: Commit**

```bash
git add web/wasm/Cargo.toml web/wasm/src/lib.rs
git commit -m "add a stable single-threaded build of the wasm wrapper"
```

---

### Task 3: The lite build script and its browser gate

`build-lite.sh` builds the stable, single-threaded module into `pkg-lite/`. A new gate, `gate.sh lite`, runs the same 29 cases on it **on a page served without isolation headers**: the chapters and the playground's fallback must work on an ordinary page. The case list moves into a shared module, `g2-cases.js`, used by both workers; `gate.sh` is rewritten to know about the second package.

**Files:**
- Create: `web/wasm/build-lite.sh`, `web/wasm/www/g2-cases.js`, `web/wasm/www/lite-worker.js`
- Modify (replace entire contents): `web/wasm/gate.sh`
- Modify: `web/wasm/www/worker.js`, `web/wasm/www/gate.html`, `web/dev/check_report.py`, `.gitignore`

**Interfaces:**
- Consumes: the lite `run_case` (Task 2).
- Produces: `web/wasm/build-lite.sh`, `web/wasm/gate.sh lite [--no-build]`; `pkg-lite/` (ignored, generated).

- [ ] **Step 1: Create the build script and the two JavaScript modules**


Create `web/wasm/build-lite.sh` (then `chmod +x`):

````bash
#!/usr/bin/env bash
# Builds the STABLE, single-threaded wasm module into pkg-lite/: no threads, no
# atomics, no nightly. Used by the chapters and as the playground's fallback. The
# threaded build is build.sh.
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured; this build uses "<dir>-lite" (default ./target-lite)
set -euo pipefail
cd "$(dirname "$0")"
WASM_BINDGEN=${WASM_BINDGEN:-wasm-bindgen}
TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}-lite"
# `+stable` overrides the nightly pinned for this directory by rust-toolchain.toml.
cargo +stable build --release --target wasm32-unknown-unknown --target-dir "$TARGET_DIR"
rm -rf pkg-lite
"$WASM_BINDGEN" --target web --out-dir pkg-lite \
  "$TARGET_DIR/wasm32-unknown-unknown/release/naive_matmul_web.wasm"
cat > pkg-lite/package.json <<'JSON'
{
  "name": "naive_matmul_web",
  "type": "module",
  "main": "naive_matmul_web.js",
  "module": "naive_matmul_web.js"
}
JSON
````

Create `web/wasm/www/g2-cases.js`:

````javascript
// The 29 cases of the g2 gate, shared by the threaded and lite workers.
export function g2Cases() {
  const cases = [];
  for (const n of [256, 512]) {
    cases.push({ level: 0, n, threads: 1, tile_k: 32, tile_j: 64 });
    for (const level of [1, 2, 3, 4]) {
      for (const threads of [1, 2, 4]) {
        cases.push({ level, n, threads, tile_k: 32, tile_j: 64 });
      }
    }
  }
  cases.push({ level: 3, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  cases.push({ level: 2, n: 256, threads: 4, tile_k: 1, tile_j: 1 });
  cases.push({ level: 4, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  return cases;
}
````

Create `web/wasm/www/lite-worker.js`:

````javascript
// Runs the lite (stable, single-threaded) build in a Web Worker: the same cases as
// the g2 gate, with no thread pool. The page posts { gate, expected }.
import init, { run_case } from '../pkg-lite/naive_matmul_web.js';
import { g2Cases } from './g2-cases.js';

self.onmessage = async (event) => {
  const { gate, expected } = event.data;
  const out = {
    gate,
    isolated: self.crossOriginIsolated,
    cores: navigator.hardwareConcurrency,
  };
  try {
    await init();
    out.cases = [];
    for (const c of g2Cases()) {
      const started = performance.now();
      const hash = run_case(c.level, c.n, c.threads, c.tile_k, c.tile_j);
      out.cases.push({ ...c, hash, ms: performance.now() - started, ok: hash === expected[String(c.n)] });
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
````

- [ ] **Step 2: Replace `web/wasm/gate.sh`**

Overwrite the whole file (it stays executable):

````bash
#!/usr/bin/env bash
# Runs one browser gate headlessly and exits non-zero unless it passes.
# usage: gate.sh g1|g2|probe|g5|lite [--no-build]
#   g1     the thread pool starts and runs a parallel sum
#   g2     29 cases (levels 0 to 4) must hash exactly like native Rust
#   probe  informational: records whether StdRunner works in the browser (it traps)
#   g5     informational: records limits (pool start-up, re-init, panic, memory)
#   lite   the same 29 cases on the stable single-threaded build (pkg-lite), served
#          WITHOUT isolation headers: it must work on an ordinary page
# The Astro-build gate (g3) is web/site/gate-g3.sh.
# env: WASM_BINDGEN (path to the CLI), PORT (default 8765), TIMEOUT (seconds)
# --no-build reuses pkg/ (pkg-lite/ for `lite`), but refuses if it is missing, was
# built for the bundler (pkg/ only), or is older than the sources.
set -euo pipefail
cd "$(dirname "$0")"
GATE=${1:?usage: gate.sh g1|g2|probe|g5|lite [--no-build]}
PKG=pkg
BUILD=./build.sh
case "$GATE" in
  g1|g2|probe) URL="www/gate.html?gate=$GATE" ;;
  g5) URL="www/limits.html" ;;
  lite) URL="www/gate.html?gate=lite"; PKG=pkg-lite; BUILD=./build-lite.sh; export NO_ISOLATION=1 ;;
  *) echo "unknown gate: $GATE" >&2; exit 2 ;;
esac

if [ "${2:-}" = "--no-build" ]; then
  WASM=$PKG/naive_matmul_web_bg.wasm
  if [ ! -f "$WASM" ]; then
    echo "REFUSING: $WASM is missing; run $BUILD (or drop --no-build)"; exit 1
  fi
  if [ "$PKG" = pkg ] && [ "$(cat pkg/.features 2>/dev/null || echo unknown)" != "no-bundler" ]; then
    echo "REFUSING: pkg/ was not built with the no-bundler feature; run ./build.sh (or drop --no-build)"; exit 1
  fi
  NEWER=$(find src examples Cargo.toml ../../src ../../Cargo.toml -name '*.rs' -newer "$WASM" -print -quit -o -name Cargo.toml -newer "$WASM" -print -quit)
  if [ -n "$NEWER" ]; then
    echo "REFUSING: $NEWER is newer than $WASM; run $BUILD (or drop --no-build)"; exit 1
  fi
else
  "$BUILD"
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

- [ ] **Step 3: Apply the edits**

In `web/wasm/www/worker.js`, replace (include the final line break):

````text
import init, {
  initThreadPool,
  pool_threads,
  sum_squares,
  run_case,
  run_case_std,
} from '../pkg/naive_matmul_web.js';

function g2Cases() {
  const cases = [];
  for (const n of [256, 512]) {
    cases.push({ level: 0, n, threads: 1, tile_k: 32, tile_j: 64 });
    for (const level of [1, 2, 3, 4]) {
      for (const threads of [1, 2, 4]) {
        cases.push({ level, n, threads, tile_k: 32, tile_j: 64 });
      }
    }
  }
  cases.push({ level: 3, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  cases.push({ level: 2, n: 256, threads: 4, tile_k: 1, tile_j: 1 });
  cases.push({ level: 4, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  return cases;
}

````

with:

````text
import init, {
  initThreadPool,
  pool_threads,
  sum_squares,
  run_case,
  run_case_std,
} from '../pkg/naive_matmul_web.js';
import { g2Cases } from './g2-cases.js';

````

In `web/wasm/www/gate.html`, replace:

````text
  const worker = new Worker('./worker.js', { type: 'module' });
````

with:

````text
  const workerUrl = gate === 'lite' ? './lite-worker.js' : './worker.js';
  const worker = new Worker(workerUrl, { type: 'module' });
````

In `web/dev/check_report.py`, replace (include the final line break):

````text
  probe  informational: records whether StdRunner works in the browser

````

with:

````text
  probe  informational: records whether StdRunner works in the browser
  lite   g2's cases on the stable single-threaded build, on a page that is NOT isolated

````

In `web/dev/check_report.py`, replace:

````text
    if not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if gate != "g5" and report.get("pool_threads") != 4:
````

with:

````text
    if gate == "lite":
        if report.get("isolated"):
            problems.append("the lite gate must run on a page that is NOT cross-origin isolated")
    elif not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if gate not in ("g5", "lite") and report.get("pool_threads") != 4:
````

In `web/dev/check_report.py`, replace:

````text
    if gate in ("g2", "g3"):
        if len(cases)
````

with:

````text
    if gate in ("g2", "g3", "lite"):
        if len(cases)
````

In `web/dev/check_report.py`, replace:

````text
        if not problems:
            for level in SPEEDUP_LEVELS:
````

with:

````text
        if not problems and gate != "lite":
            for level in SPEEDUP_LEVELS:
````

In `.gitignore`, replace (include the final line break):

````text
web/wasm/pkg/

````

with:

````text
web/wasm/pkg/
web/wasm/pkg-lite/
web/wasm/target-lite/

````

- [ ] **Step 4: Run the lite gate and its guards**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
./gate.sh lite                  # builds pkg-lite, then prints a JSON header with "isolated": false, 29 lines starting "ok ", and GATE LITE: PASS
./gate.sh lite --no-build       # GATE LITE: PASS
touch src/lib.rs
./gate.sh lite --no-build; echo "exit $?"   # REFUSING: src/lib.rs is newer than pkg-lite/...; exit 1
```

- [ ] **Step 5: Check that the threaded gates still pass after the refactor**

```bash
./gate.sh g1                    # rebuilds the threaded module (src/lib.rs was touched): GATE G1: PASS
./gate.sh g2 --no-build         # GATE G2: PASS
./gate.sh probe --no-build      # GATE PROBE: PASS
```

If a gate fails, do not weaken it: stop and report BLOCKED with the output.

- [ ] **Step 6: Commit**

```bash
git add web/wasm/build-lite.sh web/wasm/gate.sh web/wasm/www/g2-cases.js web/wasm/www/lite-worker.js web/wasm/www/worker.js web/wasm/www/gate.html web/dev/check_report.py .gitignore
git commit -m "add the lite build script and its browser gate"
```

---

### Task 4: Let the Node container read `docs/` and `anim/`

The site renders the chapters from `docs/` and copies two videos from `anim/`; both sit outside `web/`, which is all the container sees. They are mounted **read-only** at `/docs` and `/anim`, so the relative path `../../docs` from `web/site` on the host resolves the same way from `/work/site` in the container (to `/docs`), and the same site config works on a CI runner with no Docker.

**Files:**
- Modify: `web/dev/node.sh`

- [ ] **Step 1: Apply the edits**


In `web/dev/node.sh`, replace:

````text
# Runs a command in a Node container with this repository's web/ directory
# mounted at /work. Files it writes are owned by you, not root.
````

with:

````text
# Runs a command in a Node container with this repository's web/ directory
# mounted at /work, and docs/ and anim/ mounted read-only at /docs and /anim (so
# `../../docs` resolves from /work/site just as it does from web/site on the host).
# Files it writes are owned by you, not root.
````

In `web/dev/node.sh`, replace (include the final line break):

````text
WEB=$(cd "$(dirname "$0")/.." && pwd)

````

with:

````text
WEB=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(dirname "$WEB")

````

In `web/dev/node.sh`, replace (include the final line break):

````text
  -v "$WEB:/work" -w "/work/$SUBDIR" \

````

with:

````text
  -v "$WEB:/work" -w "/work/$SUBDIR" \
  -v "$ROOT/docs:/docs:ro" -v "$ROOT/anim:/anim:ro" \

````

- [ ] **Step 2: Verify**

```bash
bash -n web/dev/node.sh
web/dev/node.sh . sh -c 'ls /docs/levels | head -2; ls /anim/media/videos | head -1; touch /docs/x; echo "touch exit $?"'
```

Expected: the first two files of `docs/levels` (`cache_friendly.md`, `naive.md`), one directory name from `anim/media/videos`, then `touch: cannot touch '/docs/x': Read-only file system` and `touch exit 1`.

- [ ] **Step 3: Commit**

```bash
git add web/dev/node.sh
git commit -m "let the Node container read docs/ and anim/"
```

---

### Task 5: Move the gate page to `/gate/` and check the service worker's scope

The home page becomes the introduction, so the stage B gate page moves to `/gate/`. Three small changes ride along: the page reports the service worker's scope, and the G3 checker requires it to be the site root (the worker script and wasm live under `/_astro/`, and a service worker only adds the isolation headers inside its scope); the page's worker error report now carries a file and line; and `gate-g3.sh` builds the bundler module with `FEATURES=threads` (the empty value now means the lite build).

**Files:**
- Move: `web/site/src/pages/index.astro` to `web/site/src/pages/gate/index.astro`
- Modify: `web/site/src/pages/gate/index.astro`, `web/site/gate-g3.sh`, `web/dev/check_report.py`

- [ ] **Step 1: Move the page**

```bash
mkdir -p web/site/src/pages/gate
git mv web/site/src/pages/index.astro web/site/src/pages/gate/index.astro
```

- [ ] **Step 2: Apply the edits**


In `web/site/src/pages/gate/index.astro`, replace:

````text
// Stage B gate G3 page: runs the same worker as the plain gates, from a
// production build. The real site replaces this page.
````

with:

````text
// Stage B gate G3 page, kept at /gate/: runs the same worker as the plain gates
// from a production build. The service worker is registered only by pages that
// need threads (this one and, later, the playground), never by the chapters.
````

In `web/site/src/pages/gate/index.astro`, replace (include the final line break):

````text
        result.base = base;

````

with:

````text
        result.base = base;
        // The service worker's scope. It must cover the whole site: the worker script
        // and wasm are served from /_astro/, and only responses inside the scope get
        // the isolation headers.
        result.sw_scopes = (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope);

````

In `web/site/src/pages/gate/index.astro`, replace:

````text
// The same worker the plain gates use; its wasm import resolves to web/wasm/pkg.
        const worker = new Worker(new URL('../../../wasm/www/worker.js', import.meta.url), { type: 'module' });
````

with:

````text
// The same worker the plain gates use; its wasm import resolves to web/wasm/pkg.
        const worker = new Worker(new URL('../../../../wasm/www/worker.js', import.meta.url), { type: 'module' });
````

In `web/site/src/pages/gate/index.astro`, replace:

````text
worker.onerror = (event) => resolve({ gate, ok: false, error: 'worker error: ' + event.message });
````

with:

````text
worker.onerror = (event) => resolve({ gate, ok: false, error: `worker error: ${event.message} (${event.filename}:${event.lineno}:${event.colno})` });
````

In `web/site/gate-g3.sh`, replace:

````text
# Gate G3: the wasm module from an Astro production build, served under
# /matmul_levels.rs/ WITHOUT cross-origin-isolation headers (as GitHub Pages
# would), made isolated by coi-serviceworker, run in headless Firefox. Passes
# only if all 29 cases hash exactly like native Rust and the page reloaded.
````

with:

````text
# Gate G3: the wasm module from an Astro production build, served under
# /matmul_levels.rs/ WITHOUT cross-origin-isolation headers (as GitHub Pages
# would), made isolated by coi-serviceworker, run in headless Firefox. The page is
# /matmul_levels.rs/gate/; the service worker is registered from the site root so
# its scope covers /_astro/ (the worker and wasm). Passes only if all 29 cases hash
# exactly like native Rust, the page reloaded, and the scope is /matmul_levels.rs/.
````

In `web/site/gate-g3.sh`, replace:

````text
  if [ ! -f "$WASM/pkg/.features" ] || [ -n "$(cat "$WASM/pkg/.features")" ]; then
    echo "REFUSING: pkg/ was not built for the bundler; run ./gate-g3.sh without --no-build"; exit 1
````

with:

````text
  if [ "$(cat "$WASM/pkg/.features" 2>/dev/null || echo unknown)" != "threads" ]; then
    echo "REFUSING: pkg/ was not built for the bundler; run ./gate-g3.sh without --no-build"; exit 1
````

In `web/site/gate-g3.sh`, replace:

````text
  (cd "$WASM" && FEATURES= ./build.sh)
````

with:

````text
  (cd "$WASM" && FEATURES=threads ./build.sh)
````

In `web/site/gate-g3.sh`, replace:

````text
"matmul_levels.rs/?gate=g2"
````

with:

````text
"matmul_levels.rs/gate/?gate=g2"
````

In `web/dev/check_report.py`, replace (include the final line break):

````text
            problems.append("the page never reloaded: isolation did not come from the service worker")

````

with:

````text
            problems.append("the page never reloaded: isolation did not come from the service worker")
        scopes = report.get("sw_scopes")
        if not scopes or not all(s.endswith("/matmul_levels.rs/") for s in scopes):
            problems.append("the service worker scope must be the site root /matmul_levels.rs/, got %r" % scopes)

````

- [ ] **Step 3: Run the G3 gate**

From `web/site`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
./gate-g3.sh
```

Expected: the bundler-mode module is built (`FEATURES=threads`), `npm ci` runs once in the container, the Astro build reports one page, then a JSON header with `"isolated": true`, `"pool_threads": 4`, `"base": "/matmul_levels.rs/"`, `"loads": 1` and `"sw_scopes": ["http://127.0.0.1:8765/matmul_levels.rs/"]`, 29 lines starting `ok `, four `speedup` lines, and `GATE G3: PASS`. If it fails with `worker error` and no detail, the service worker scope or the worker path is wrong: do not weaken the gate; stop and report BLOCKED.

- [ ] **Step 4: Restore the plain gates' build mode**

The G3 gate built `pkg/` for the bundler: run `(cd web/wasm && ./build.sh)` so `gate.sh g1|g2|probe --no-build` work again.

- [ ] **Step 5: Commit**

```bash
git add web/site/src/pages/gate/index.astro web/site/gate-g3.sh web/dev/check_report.py
git commit -m "move the gate page to /gate/ and check the service worker scope"
```

(The `git mv` already staged the move; `git add` of the new path completes it.)

---

### Task 6: The remark plugin that turns `docs/` into site pages

The chapters are the rustdoc of the crate (`include_str!`), so they contain rustdoc-isms and no frontmatter. One remark plugin handles them: it removes rustdoc-hidden lines (`# ` and bare `#`, and unescapes `##`) inside `rust` fences only; demotes headings one level (the page layout supplies the title); resolves intra-doc links (`crate::x`, reference definitions, and `` [`x`] `` shortcuts) through an explicit table whose misses **fail the build**; and inserts figures after named headings. The plugin is a factory taking its tables as options, so the unit tests use small ones. Astro 7's default Markdown processor does not run remark plugins; the unified processor comes from `@astrojs/markdown-remark`.

**Files:**
- Create: `web/site/src/plugins/remark-rustdoc.test.mjs`, `web/site/src/plugins/remark-rustdoc.mjs`
- Modify: `web/site/package.json`, `web/site/package-lock.json`

**Interfaces:**
- Produces: default export `remarkRustdoc({ base, links, insertions })` (a unified plugin); named exports `cleanRustFence(value)` and `chapterId(path)`. `links` maps a target without its `crate::` prefix to a route under `base`, or `null` for plain code; `insertions` is a list of `{ chapter, afterHeading, html }`.

- [ ] **Step 1: Install the dependencies in the container**

From the repository root (this edits `web/site/package.json` and `web/site/package-lock.json`):

```bash
web/dev/node.sh site npm install --no-audit --no-fund --save-exact @astrojs/markdown-remark@7.3.6 unist-util-visit@5.2.0
web/dev/node.sh site npm install --no-audit --no-fund --save-dev --save-exact unified@11.0.5 remark-parse@11.0.0 remark-stringify@11.0.0
```

Expected: both finish with `added N packages` or `up to date`. `git diff web/site/package.json` shows the two dependency groups, versions pinned exactly (no `^`).

- [ ] **Step 2: Add the test script**


In `web/site/package.json`, replace:

````text
    "build": "astro build"
  }
````

with:

````text
    "build": "astro build",
    "test": "node --test src/plugins/"
  }
````

- [ ] **Step 3: Write the tests first**

Create `web/site/src/plugins/remark-rustdoc.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import remarkRustdoc, { chapterId, cleanRustFence } from './remark-rustdoc.mjs';

const links = {
  naive: 'levels/naive/',
  threaded: 'levels/threaded/',
  'streaming::TileSource': null,
  TileSource: null,
  matmul: null,
};

async function render(markdown, options = {}, path = '/repo/docs/levels/naive.md') {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRustdoc, { base: '/site/', links, ...options })
    .use(remarkStringify);
  return String(await processor.process({ value: markdown, path }));
}

test('removes rustdoc-hidden lines and unescapes ## inside rust fences only', () => {
  const rust = ['let x = 1;', '# Ok::<(), E>(())', '#', '## shown', '#[derive(Debug)]', '  # indented hidden'].join('\n');
  assert.equal(cleanRustFence(rust), ['let x = 1;', '# shown', '#[derive(Debug)]'].join('\n'));
});

test('leaves other fences alone', async () => {
  const out = await render('```sh\n# a comment\ncargo test\n```\n\n```rust\n# hidden\nfn main() {}\n```\n');
  assert.match(out, /# a comment/);
  assert.doesNotMatch(out, /hidden/);
  assert.match(out, /fn main/);
});

test('demotes headings one level', async () => {
  const out = await render('# One\n\n## Two\n');
  assert.match(out, /^## One$/m);
  assert.match(out, /^### Two$/m);
});

test('rewrites inline crate:: links to routes under the base, and null to plain text', async () => {
  const out = await render('See [the naive level](crate::naive) and [the trait](crate::streaming::TileSource).\n');
  assert.match(out, /\[the naive level\]\(\/site\/levels\/naive\/\)/);
  assert.doesNotMatch(out, /crate::/);
  assert.match(out, /the trait/);
  assert.doesNotMatch(out, /\]\(.*TileSource/);
});

test('resolves reference-style links and removes their definitions', async () => {
  const out = await render('Use [`TileSource`] or [`threaded`].\n\n[`TileSource`]: crate::streaming::TileSource\n[`threaded`]: crate::threaded\n');
  assert.match(out, /\[`threaded`\]\(\/site\/levels\/threaded\/\)/);
  assert.match(out, /`TileSource`/);
  assert.doesNotMatch(out, /crate::/);
  assert.doesNotMatch(out, /^\[`/m);
});

test('resolves shortcut references that have no definition, in paragraphs and tables', async () => {
  const out = await render('The [`naive`] level, then [`matmul`].\n\n| a |\n|---|\n| [`threaded`] |\n');
  assert.match(out, /\[`naive`\]\(\/site\/levels\/naive\/\)/);
  assert.match(out, /\[`threaded`\]\(\/site\/levels\/threaded\/\)/);
  assert.match(out, /`matmul`/);
  assert.doesNotMatch(out, /\[`matmul`\]/);
});

test('links a shortcut that is followed by a colon in running text', async () => {
  const out = await render('1. [`naive`]: the algorithm, and why it is slow.\n');
  assert.match(out, /\[`naive`\]\(\/site\/levels\/naive\/\): the algorithm/);
});

test('does not touch ordinary links or brackets', async () => {
  const out = await render('Visit [Rust](https://rust-lang.org), see [1], and `[x]`.\n');
  assert.match(out, /\[Rust\]\(https:\/\/rust-lang\.org\)/);
  assert.match(out, /\[1\]/);
});

test('an unlisted link fails the build with a message naming it', async () => {
  await assert.rejects(render('[x](crate::mystery::Thing)\n'), /unresolvable doc link "crate::mystery::Thing"/);
  await assert.rejects(render('A [`Mystery`] shortcut.\n'), /unresolvable doc link "Mystery"/);
});

test('inserts html after the named heading, for the named chapter only', async () => {
  const insertions = [{ chapter: 'levels/naive', afterHeading: 'The idea', html: '<figure>FIG</figure>' }];
  const naive = await render('# The idea\n\nText.\n', { insertions });
  assert.match(naive, /## The idea\n\n<figure>FIG<\/figure>\n\nText\./);
  const other = await render('# The idea\n\nText.\n', { insertions }, '/repo/docs/levels/threaded.md');
  assert.doesNotMatch(other, /FIG/);
});

test('an insertion whose heading is missing fails the build', async () => {
  const insertions = [{ chapter: 'levels/naive', afterHeading: 'No such heading', html: '<p/>' }];
  await assert.rejects(render('# The idea\n', { insertions }), /no heading "No such heading"/);
});

test('chapterId finds the path under docs/', () => {
  assert.equal(chapterId('/repo/docs/levels/naive.md'), 'levels/naive');
  assert.equal(chapterId('/docs/introduction.md'), 'introduction');
  assert.equal(chapterId('/elsewhere/x.md'), null);
});
````

- [ ] **Step 4: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module"`
Expected: `Cannot find module '/work/site/src/plugins/remark-rustdoc.mjs'`.

- [ ] **Step 5: Write the plugin**


Create `web/site/src/plugins/remark-rustdoc.mjs`:

````javascript
// Turns the Markdown in docs/ (written for rustdoc) into site pages.
//
// The same files are the module documentation of the Rust crate (include_str!), so
// they contain rustdoc-isms and no frontmatter. This plugin handles them:
//   - rustdoc-hidden lines inside `rust` fences are removed;
//   - headings are demoted one level (the page layout supplies the title);
//   - intra-doc links (`crate::x`, and `[`x`]` shortcuts) are rewritten through an
//     explicit table, and anything not in the table FAILS the build;
//   - figures and demos are inserted after named headings, so the Markdown stays
//     free of site markup.
import { visit } from 'unist-util-visit';

/** rustdoc hides lines that start with "# " (or are exactly "#") and unescapes "##". */
export function cleanRustFence(value) {
  return value
    .split('\n')
    .filter((line) => !/^\s*#(\s|$)/.test(line))
    .map((line) => line.replace(/^(\s*)##/, '$1#'))
    .join('\n');
}

/** "levels/naive" for ".../docs/levels/naive.md", or null if the file is not under docs/. */
export function chapterId(path) {
  const match = /[\\/]docs[\\/](.+)\.md$/.exec(path ?? '');
  return match ? match[1].replaceAll('\\', '/') : null;
}

function plainText(node) {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(plainText).join('');
}

/**
 * @param {object} options
 * @param {string} options.base        site base path, ending in "/"
 * @param {Record<string, string|null>} options.links
 *        intra-doc link target (without the "crate::" prefix) -> route under `base`,
 *        or null to show the text as plain code
 * @param {{chapter: string, afterHeading: string, html: string}[]} [options.insertions]
 */
export default function remarkRustdoc({ base = '/', links = {}, insertions = [] } = {}) {
  return (tree, file) => {
    const where = file.path ?? 'unknown file';

    const resolve = (raw) => {
      const key = raw.replace(/^crate::/, '');
      if (!Object.prototype.hasOwnProperty.call(links, key)) {
        throw new Error(`${where}: unresolvable doc link "${raw}" (add it to site.config.mjs)`);
      }
      const route = links[key];
      return route === null ? null : base + route;
    };

    visit(tree, 'code', (node) => {
      if (node.lang === 'rust') node.value = cleanRustFence(node.value);
    });

    // Figures and demos go in before the headings are demoted (matching is by text).
    const chapter = chapterId(file.path);
    for (const insertion of insertions.filter((i) => i.chapter === chapter)) {
      const index = tree.children.findIndex(
        (node) => node.type === 'heading' && plainText(node) === insertion.afterHeading,
      );
      if (index === -1) {
        throw new Error(`${where}: no heading "${insertion.afterHeading}" to insert after`);
      }
      tree.children.splice(index + 1, 0, { type: 'html', value: insertion.html });
    }

    visit(tree, 'heading', (node) => {
      node.depth = Math.min(node.depth + 1, 6);
    });

    // Reference-style definitions: resolve them, then drop them from the output.
    const definitions = new Map();
    visit(tree, 'definition', (node, index, parent) => {
      definitions.set(node.identifier, resolve(node.url));
      parent.children.splice(index, 1);
      return ['skip', index];
    });

    // [text](crate::x)
    visit(tree, 'link', (node, index, parent) => {
      if (!node.url.startsWith('crate::')) return;
      const url = resolve(node.url);
      if (url === null) parent.children.splice(index, 1, ...node.children);
      else node.url = url;
    });

    // [`x`] and [`x`][y] where a definition exists
    visit(tree, 'linkReference', (node, index, parent) => {
      const url = definitions.get(node.identifier);
      if (url === undefined) throw new Error(`${where}: reference "${node.identifier}" has no definition`);
      if (url === null) parent.children.splice(index, 1, ...node.children);
      else parent.children.splice(index, 1, { type: 'link', url, children: node.children });
    });

    // [`x`] with no definition parses as the text "[", code, and "]".
    const rewriteShortcuts = (parent) => {
      const kids = parent.children;
      for (let i = 1; i < kids.length - 1; i++) {
        const [before, code, after] = [kids[i - 1], kids[i], kids[i + 1]];
        const isShortcut =
          before.type === 'text' && before.value.endsWith('[') &&
          code.type === 'inlineCode' &&
          after.type === 'text' && after.value.startsWith(']') &&
          !/^\]([([])/.test(after.value);
        if (!isShortcut) continue;
        const url = resolve(code.value);
        before.value = before.value.slice(0, -1);
        after.value = after.value.slice(1);
        if (url !== null) kids.splice(i, 1, { type: 'link', url, children: [code] });
      }
    };
    visit(tree, 'paragraph', rewriteShortcuts);
    visit(tree, 'tableCell', rewriteShortcuts);
  };
}
````

- [ ] **Step 6: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`
Expected: `ℹ pass 12` and `ℹ fail 0`, no `✖` lines.

- [ ] **Step 7: Commit**

```bash
git add web/site/package.json web/site/package-lock.json web/site/src/plugins
git commit -m "add the remark plugin that turns docs/ into site pages"
```

---

### Task 7: Render the chapters from `docs/` with a clean article layout

The site renders the introduction (the home page) and the five level chapters from `docs/` through the plugin: a content collection restricted to those files (never `docs/**`), one route per chapter from `site.config.mjs` (the chapters have no frontmatter, so titles, order and routes live there), a layout with a chapter navigator and previous/next links, and a stylesheet in a clean article style: one readable column, light and dark themes that follow the system, light/dark syntax highlighting, tables and code that scroll instead of overflowing on a phone. `npm run build` now clears Astro's content cache first (it is keyed by the Markdown, not by the plugin, so a plugin change would otherwise be ignored).

**Files:**
- Create: `web/site/site.config.mjs`, `web/site/src/content.config.ts`, `web/site/src/layouts/Page.astro`, `web/site/src/styles/site.css`, `web/site/src/pages/[...slug].astro`
- Modify (replace entire contents): `web/site/astro.config.mjs`
- Modify: `web/site/package.json`

**Interfaces:**
- Consumes: `remarkRustdoc` (Task 6), the module `web/wasm/pkg` built with `FEATURES=threads` (for the gate page).
- Produces: routes `/` (introduction), `/levels/{naive,threaded,cache_friendly,simd,streaming}/`, and the existing `/gate/`, all under `/matmul_levels.rs/`; `site.config.mjs` exports `base`, `siteTitle`, `repoUrl`, `chapters`, `links`, `insertions`.

- [ ] **Step 1: Create the configuration and the content collection**


Create `web/site/site.config.mjs`:

````javascript
// Everything about the site that is not in docs/: the chapters have no frontmatter
// (rustdoc would show it as text), so their titles, order and routes live here.

// GitHub Pages serves this repository at /matmul_levels.rs/.
export const base = '/matmul_levels.rs/';
export const siteTitle = 'Matrix multiplication, level by level';
export const repoUrl = 'https://github.com/NonDairyNeutrino/matmul_levels.rs';

// Chapters rendered from docs/ (id = path under docs/, no extension), in reading order.
// `route` is relative to `base`; the introduction is the home page.
export const chapters = [
  { id: 'introduction', title: 'Introduction', route: '' },
  { id: 'levels/naive', title: 'Level 0: the naive loop', route: 'levels/naive/' },
  { id: 'levels/threaded', title: 'Level 1: threads', route: 'levels/threaded/' },
  { id: 'levels/cache_friendly', title: 'Level 2: cache blocking', route: 'levels/cache_friendly/' },
  { id: 'levels/simd', title: 'Level 3: registers and SIMD', route: 'levels/simd/' },
  { id: 'levels/streaming', title: 'Level 4: streaming', route: 'levels/streaming/' },
];

// Every intra-doc link target in the chapters must be listed (without the "crate::"
// prefix). A string is a route under `base`; null shows the text as plain code (no
// published API docs yet). Anything not listed fails the build.
export const links = {
  // Chapters.
  naive: 'levels/naive/',
  threaded: 'levels/threaded/',
  cache_friendly: 'levels/cache_friendly/',
  simd: 'levels/simd/',
  streaming: 'levels/streaming/',
  // API items and rustdoc-only pages.
  ...Object.fromEntries([
    'streaming::TileSource', 'streaming::TileSink', 'streaming::FileMatrix',
    'threaded::row_block_plan', 'streaming::StreamConfig::with_tile_shape',
    'streaming::StreamConfig::peak_buffer_bytes', 'simd::target_vector_isa',
    'simd::micro_tile_shape', 'naive::matmul', 'guide::in_memory', 'guide::getting_started',
    'design::architecture', 'Matrix', 'MatmulError',
    'TileSource', 'TileSink', 'StreamConfig::peak_buffer_bytes', 'StreamConfig::with_tile_shape',
    'target_vector_isa', 'micro_tile_shape', 'matrix', 'matmul', 'guide', 'design', 'error',
    'DimensionMismatch',
  ].map((key) => [key, null])),
};

// Figures and demos inserted after a heading of a chapter (by heading text).
export const insertions = [];
````

Create `web/site/src/content.config.ts`:

````typescript
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Only the chapters; never docs/** (that tree also holds docs/superpowers/).
// `../../docs` is web/site/../../docs on the host and /work/site/../../docs = /docs
// in the Node container (web/dev/node.sh mounts docs/ there, read-only).
const chapters = defineCollection({
  loader: glob({ pattern: ['introduction.md', 'levels/*.md'], base: '../../docs' }),
});

export const collections = { chapters };
````

- [ ] **Step 2: Replace `web/site/astro.config.mjs`**

Overwrite the whole file:

````javascript
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import remarkRustdoc from './src/plugins/remark-rustdoc.mjs';
import { base, insertions, links } from './site.config.mjs';

export default defineConfig({
  base,
  trailingSlash: 'always',
  vite: { worker: { format: 'es' } },
  markdown: {
    processor: unified({ remarkPlugins: [[remarkRustdoc, { base, links, insertions }]] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
  },
});
````

- [ ] **Step 3: Create the layout, the stylesheet and the chapter route**

Create `web/site/src/layouts/Page.astro`:

````astro
---
import '../styles/site.css';
import { chapters, repoUrl, siteTitle } from '../../site.config.mjs';

interface Props {
  title: string;
  previous?: { title: string; route: string } | null;
  next?: { title: string; route: string } | null;
}
const { title, previous = null, next = null } = Astro.props;
const base = import.meta.env.BASE_URL;
const here = Astro.url.pathname;
const pageTitle = title === 'Introduction' ? siteTitle : `${title} · ${siteTitle}`;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>{pageTitle}</title>
  </head>
  <body>
    <a class="skip" href="#content">Skip to the content</a>
    <header class="site-header">
      <a class="site-title" href={base}>{siteTitle}</a>
      <nav aria-label="Chapters">
        <ul>
          {chapters.map((chapter) => (
            <li>
              <a href={base + chapter.route} aria-current={here === base + chapter.route ? 'page' : undefined}>
                {chapter.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
    <main id="content">
      <article>
        <h1>{title}</h1>
        <slot />
      </article>
      <nav class="pager" aria-label="Previous and next chapter">
        {previous ? <a rel="prev" href={base + previous.route}>← {previous.title}</a> : <span />}
        {next ? <a rel="next" href={base + next.route}>{next.title} →</a> : <span />}
      </nav>
    </main>
    <footer class="site-footer">
      <a href={repoUrl}>Source on GitHub</a>
    </footer>
  </body>
</html>
````

Create `web/site/src/styles/site.css`:

````css
/* A clean article layout: one readable column, light and dark themes that follow the
   system, code that scrolls instead of wrapping. */
:root {
  color-scheme: light dark;
  --bg: #fbfbf8;
  --fg: #1d1d1b;
  --muted: #5d5d56;
  --accent: #1d5fbf;
  --border: #dcdcd2;
  --code-bg: #f1f1ea;
  --measure: 44rem;
  --gutter: 1rem;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14151a;
    --fg: #e8e8e3;
    --muted: #a3a39b;
    --accent: #7db0ff;
    --border: #2d2f38;
    --code-bg: #1c1e26;
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 1.0625rem/1.65 var(--font);
}
a { color: var(--accent); text-underline-offset: 0.15em; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

.skip { position: absolute; left: -999px; top: 0; padding: 0.5rem 1rem; background: var(--bg); }
.skip:focus { left: var(--gutter); z-index: 10; }

.site-header, main, .site-footer {
  width: min(var(--measure), 100% - 2 * var(--gutter));
  margin-inline: auto;
}
.site-header { padding-block: 1.25rem 0.5rem; border-bottom: 1px solid var(--border); }
.site-title { display: inline-block; font-weight: 700; font-size: 1.15rem; color: var(--fg); text-decoration: none; }
.site-header nav ul { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; margin: 0.5rem 0 0; padding: 0; list-style: none; font-size: 0.95rem; }
.site-header nav a { color: var(--muted); text-decoration: none; padding-block: 0.25rem; }
.site-header nav a:hover, .site-header nav a[aria-current='page'] { color: var(--fg); text-decoration: underline; }

main { padding-block: 2rem 3rem; }
article > h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 1.5rem; }
article h2 { font-size: 1.45rem; line-height: 1.3; margin: 2.5rem 0 0.75rem; }
article h3 { font-size: 1.15rem; margin: 1.75rem 0 0.5rem; }
article p, article ul, article ol { margin: 0 0 1rem; }
article li { margin-bottom: 0.25rem; }
blockquote { margin: 1rem 0; padding: 0.25rem 1rem; border-left: 4px solid var(--border); color: var(--muted); }

code { font: 0.9em var(--mono); background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 4px; }
pre { margin: 0 0 1.25rem; padding: 0.9rem 1rem; background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; overflow-x: auto; font: 0.875rem/1.5 var(--mono); }
pre code { background: none; padding: 0; font: inherit; }
/* Shiki emits both themes as variables; pick by the system theme. */
.astro-code, .astro-code span { color: var(--shiki-light); background-color: var(--shiki-light-bg); }
@media (prefers-color-scheme: dark) {
  .astro-code, .astro-code span { color: var(--shiki-dark); background-color: var(--shiki-dark-bg); }
}
.astro-code { border: 1px solid var(--border); }

table { display: block; max-width: 100%; margin: 0 0 1.25rem; overflow-x: auto; border-collapse: collapse; font-size: 0.95rem; }
th, td { padding: 0.4rem 0.75rem; border: 1px solid var(--border); text-align: left; vertical-align: top; }
th { background: var(--code-bg); }

figure.video { margin: 1.25rem 0; }
figure.video video { display: block; width: 100%; height: auto; border: 1px solid var(--border); border-radius: 6px; background: #000; }
figcaption { margin-top: 0.4rem; font-size: 0.9rem; color: var(--muted); }

.pager { display: flex; justify-content: space-between; gap: 1rem; margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); }
.pager a { max-width: 48%; }
.pager a[rel='next'] { text-align: right; margin-left: auto; }

.site-footer { padding-block: 1rem 2.5rem; color: var(--muted); font-size: 0.9rem; }
.site-footer a { color: var(--muted); }

@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
````

Create `web/site/src/pages/[...slug].astro`:

````astro
---
import { getCollection, render } from 'astro:content';
import Page from '../layouts/Page.astro';
import { chapters } from '../../site.config.mjs';

export async function getStaticPaths() {
  const entries = await getCollection('chapters');
  return chapters.map((chapter, index) => {
    const entry = entries.find((e) => e.id === chapter.id);
    if (!entry) throw new Error(`chapter ${chapter.id} not found in docs/`);
    return {
      params: { slug: chapter.route || undefined },
      props: { entry, chapter, previous: chapters[index - 1] ?? null, next: chapters[index + 1] ?? null },
    };
  });
}

const { entry, chapter, previous, next } = Astro.props;
const { Content } = await render(entry);
---
<Page title={chapter.title} previous={previous} next={next}>
  <Content />
</Page>
````

- [ ] **Step 4: Clear the content cache on every build**

In `web/site/package.json`, replace:

````text
"prebuild": "mkdir -p public && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js",
````

with:

````text
"prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js",
````

- [ ] **Step 5: Build the site**

With the bundler module built (`(cd web/wasm && FEATURES=threads ./build.sh)`, needed by the gate page) and the expected hashes generated (`(cd web/wasm && cargo run --release --example expected 2>/dev/null) > web/site/public/expected.json`):

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|unresolvable|page\(s\)"
```

Expected: `7 page(s) built` (the home page, five chapters and `/gate/`) and no `ERROR`. One Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning about `workerHelpers.js` is benign. If it fails with `unresolvable doc link "..."`, a link in `docs/` is not in the table in `site.config.mjs`: that is the safeguard working; stop and report BLOCKED with the exact target.

- [ ] **Step 6: Check the output**

```bash
grep -rl "crate::" web/site/dist || echo "none"       # expect: none
grep -rl "Ok::" web/site/dist || echo "none"          # expect: none (rustdoc-hidden lines removed)
ls web/site/dist web/site/dist/levels                 # index.html, gate, levels; naive threaded cache_friendly simd streaming
```

- [ ] **Step 7: Look at it (not gated, but do it)**

Serve `web/site/dist` under `/matmul_levels.rs/` and take screenshots with headless Firefox, then read the PNGs:

```bash
ROOT=$(mktemp -d); ln -s "$PWD/web/site/dist" "$ROOT/matmul_levels.rs"
(cd "$ROOT" && NO_ISOLATION=1 REPORT=/dev/null python3 -I "$OLDPWD/web/dev/serve.py" 8801 &) ; sleep 1
P=$(mktemp -d); echo 'user_pref("ui.systemUsesDarkTheme", 1);' > "$P/user.js"
timeout 60 firefox --headless --no-remote --profile "$P" --screenshot /tmp/dark.png --window-size=1000,1500 http://127.0.0.1:8801/matmul_levels.rs/levels/threaded/
```

Check: one readable column, the navigator wraps, tables and diagrams are legible, the dark theme has no unreadable text. Kill only the `serve.py 8801` you started, and delete the temporary directories. Report anything that looks wrong; do not change the design.

- [ ] **Step 8: Commit**

```bash
git add web/site/site.config.mjs web/site/astro.config.mjs web/site/src/content.config.ts web/site/src/layouts/Page.astro web/site/src/styles/site.css "web/site/src/pages/[...slug].astro" web/site/package.json
git commit -m "render the chapters from docs/ with a clean article layout"
```

---

### Task 8: Check the built site for leftovers and service worker use

`check-dist.mjs` inspects the built site and exits 1 on: any `crate::` (an unrewritten link) or rustdoc-hidden line (`Ok::<`) in a page; a chapter that is missing or does not have exactly one `<h1>`; a **chapter that loads the service worker** (only pages that need threads may: it forces a reload, and readers of the chapters must never see one); a video the pages reference that was not copied into `dist/media/`. `gate-g3.sh` runs it after the build.

**Files:**
- Create: `web/site/check-dist.mjs`
- Modify: `web/site/package.json`, `web/site/gate-g3.sh`

- [ ] **Step 1: Create the checker**


Create `web/site/check-dist.mjs`:

````javascript
// Checks the built site (dist/) for the things that must never ship:
//   - intra-doc link text ("crate::") or rustdoc-hidden lines ("Ok::<") in any page;
//   - a chapter that is missing, or that does not have exactly one <h1>;
//   - a chapter that loads the service worker (only pages that need threads may:
//     it forces a reload, and readers of the chapters must never see one);
//   - a video the pages reference that was not copied into dist/media/.
// Run it with `npm run check` after `npm run build`. Exits 1 on any problem.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { base, chapters } from './site.config.mjs';

const dist = new URL('./dist/', import.meta.url).pathname;
const problems = [];

function* pages(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* pages(path);
    else if (entry.name === 'index.html') yield path;
  }
}

for (const page of pages(dist)) {
  const html = readFileSync(page, 'utf8');
  const name = page.slice(dist.length);
  if (html.includes('crate::')) problems.push(`${name}: contains "crate::" (an unrewritten intra-doc link)`);
  if (/Ok::(&lt;|<)/.test(html)) problems.push(`${name}: contains a rustdoc-hidden line ("Ok::<")`);
  for (const [, file] of html.matchAll(new RegExp(`${base}media/([\\w.-]+)`, 'g'))) {
    if (!existsSync(join(dist, 'media', file))) problems.push(`${name}: references media/${file}, which is not in dist/media/`);
  }
}

for (const chapter of chapters) {
  const file = join(dist, chapter.route, 'index.html');
  if (!existsSync(file)) {
    problems.push(`${chapter.route || '(home)'}: page was not built`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const h1 = (html.match(/<h1[ >]/g) ?? []).length;
  if (h1 !== 1) problems.push(`${chapter.route || '(home)'}: ${h1} <h1> elements, expected 1`);
  if (html.includes('coi-serviceworker')) problems.push(`${chapter.route || '(home)'}: loads the service worker; chapters must not`);
}

if (problems.length > 0) {
  console.error('check-dist: FAIL');
  for (const problem of problems) console.error(' -', problem);
  process.exit(1);
}
console.log(`check-dist: PASS (${[...pages(dist)].length} pages)`);
````

- [ ] **Step 2: Add the script and run it from the G3 gate**

In `web/site/package.json`, replace (include the final line break):

````text
    "test": "node --test src/plugins/"

````

with:

````text
    "test": "node --test src/plugins/",
    "check": "node check-dist.mjs"

````

In `web/site/gate-g3.sh`, replace (include the final line break):

````text
../dev/node.sh site npm run build

````

with:

````text
../dev/node.sh site npm run build
../dev/node.sh site npm run check

````

- [ ] **Step 3: Verify it passes on the real build and fails on bad ones**

```bash
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"      # expect: check-dist: PASS (7 pages)
```

Negative controls (edit the built output, never the sources, and rebuild afterwards):

```bash
cp web/site/dist/levels/naive/index.html /tmp/naive.bak
echo '<p>crate::oops Ok::&lt;()></p><script src="coi-serviceworker.js"></script>' >> web/site/dist/levels/naive/index.html
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"
# expect: check-dist: FAIL with three lines: contains "crate::", contains a rustdoc-hidden line, loads the service worker
cp /tmp/naive.bak web/site/dist/levels/naive/index.html
```

(`npm run check` exits 1 on failure, which `npm` reports; the `grep` hides that exit code.)

- [ ] **Step 4: Commit**

```bash
git add web/site/check-dist.mjs web/site/package.json web/site/gate-g3.sh
git commit -m "check the built site for leftovers and service worker use"
```

---

### Task 9: Embed the two animations in their chapters

The Manim videos already tracked under `anim/media/videos/` are copied into the site at build time (not committed twice): `NaiveMatMul.mp4` after the Level 0 chapter's "The idea" heading, and `ParallelNaiveMatMul.mp4` after Level 1's "What changed from level 0" heading, where it shows one row of the output per thread, the one-row case of the chapter's row blocks (the caption says so). `ParallelCacheOptimalMatMul.mp4` is column-major and contradicts the row-major prose, so it is not used. The placement lives in `site.config.mjs` (`insertions`); if a heading named there disappears from `docs/`, the build fails.

**Files:**
- Modify: `web/site/site.config.mjs`, `web/site/package.json`, `.gitignore`

- [ ] **Step 1: Add the insertions**


In `web/site/site.config.mjs`, replace (include the final line break):

````text
// Figures and demos inserted after a heading of a chapter (by heading text).
export const insertions = [];

````

with:

````text
const video = (file, caption) =>
  `<figure class="video"><video controls playsinline preload="metadata" src="${base}media/${file}"></video>` +
  `<figcaption>${caption}</figcaption></figure>`;

// Figures and demos inserted after a heading of a chapter (by heading text).
export const insertions = [
  {
    chapter: 'levels/naive',
    afterHeading: 'The idea',
    html: video('NaiveMatMul.mp4', 'The textbook triple loop, animated.'),
  },
  {
    chapter: 'levels/threaded',
    afterHeading: 'What changed from level 0',
    html: video(
      'ParallelNaiveMatMul.mp4',
      'Three threads, one row of the output each: the one-row case of the row blocks described below.',
    ),
  },
];

````

- [ ] **Step 2: Copy the videos at build time**

In `web/site/package.json`, replace:

````text
"prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js",
````

with:

````text
"prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public/media && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js && cp ../../anim/media/videos/naive_matmul/480p15/NaiveMatMul.mp4 ../../anim/media/videos/naive_matmul_parallel/480p15/ParallelNaiveMatMul.mp4 public/media/",
````

- [ ] **Step 3: Ignore the copies**

In `.gitignore`, replace (include the final line break):

````text
web/site/public/coi-serviceworker.js

````

with:

````text
web/site/public/coi-serviceworker.js
web/site/public/media/

````

- [ ] **Step 4: Build and check**

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|page\(s\)"        # 7 page(s) built
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"          # check-dist: PASS (7 pages)
ls web/site/dist/media                                                        # NaiveMatMul.mp4 ParallelNaiveMatMul.mp4
grep -c "<video" web/site/dist/levels/naive/index.html web/site/dist/levels/threaded/index.html web/site/dist/levels/simd/index.html
# expect 1, 1 and 0
git status --short                                                            # only the three files below; media/ is ignored
```

- [ ] **Step 5: Commit**

```bash
git add web/site/site.config.mjs web/site/package.json .gitignore
git commit -m "embed the two animations in their chapters"
```

---

### Task 10: The Pages workflow (manual and pull-request builds only)

Builds the whole site on GitHub's runners (the pinned nightly and stable Rust, the `wasm-bindgen` CLI at `=0.2.130` cached between runs, Node 26, the plugin tests, the Astro build, the dist checker) and, on a manual run, deploys it with the official Pages actions. Pull requests build but never deploy. There is deliberately **no** `push` trigger yet: the site is not published until the playground (C3) is in; adding `push` for `trunk` is then a two-line change. It cannot be run locally, so it is checked by parsing it and by reading it against the commands the earlier tasks ran.

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Create the workflow**


Create `.github/workflows/pages.yml`:

````yaml
name: Pages

# Builds the site (the wasm modules and the Astro project) and deploys it to GitHub
# Pages. One manual step for the repository owner: Settings > Pages > Source =
# "GitHub Actions". It runs on request and on pull requests (build only, no deploy).
# Add a `push` trigger for `trunk` when the site is ready to publish.
on:
  workflow_dispatch:
  pull_request:
    branches: [ "trunk" ]

permissions:
  contents: read

concurrency:
  group: pages
  cancel-in-progress: false

env:
  CARGO_TERM_COLOR: always
  # Must equal the `wasm-bindgen` pin in web/wasm/Cargo.toml.
  WASM_BINDGEN_VERSION: "0.2.130"

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Install the Rust toolchains (the pinned nightly for the threaded build, stable for the rest)
      run: rustup toolchain install stable nightly-2025-11-15 --profile minimal -c rust-src -t wasm32-unknown-unknown

    - name: Cache the wasm-bindgen CLI
      id: wasm-bindgen
      uses: actions/cache@v4
      with:
        path: ~/.cargo/bin/wasm-bindgen
        key: wasm-bindgen-cli-${{ env.WASM_BINDGEN_VERSION }}

    - name: Install the wasm-bindgen CLI
      if: steps.wasm-bindgen.outputs.cache-hit != 'true'
      run: cargo install wasm-bindgen-cli --version =${{ env.WASM_BINDGEN_VERSION }} --locked

    - name: Build the threaded wasm module (bundler mode)
      working-directory: web/wasm
      env:
        FEATURES: threads
      run: ./build.sh

    - uses: actions/setup-node@v4
      with:
        # The local Docker image is node:latest (v26 when this was written).
        node-version: 26
        cache: npm
        cache-dependency-path: web/site/package-lock.json

    - name: Install, test, build and check the site
      working-directory: web/site
      run: |
        npm ci
        npm test
        npm run build
        npm run check

    - uses: actions/upload-pages-artifact@v3
      with:
        path: web/site/dist

  deploy:
    if: github.event_name != 'pull_request'
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
    - id: deployment
      uses: actions/deploy-pages@v4
````

- [ ] **Step 2: Check that it parses and has the intended shape**

From the repository root (this uses the `yaml` package that Astro installed in `web/site/node_modules`):

```bash
docker run --rm -v "$PWD/.github/workflows:/wf:ro" -v "$PWD/web/site/node_modules:/nm:ro" -e NODE_PATH=/nm node:latest node -e "
const { parse } = require('yaml');
const w = parse(require('fs').readFileSync('/wf/pages.yml', 'utf8'));
console.log(Object.keys(w.jobs).join(','), Object.keys(w.on).join(','), w.jobs.build.steps.length);
"
```

Expected exactly: `build,deploy workflow_dispatch,pull_request 8`.

- [ ] **Step 3: Read it once against the local commands**

Confirm by reading: the `wasm-bindgen` version (`0.2.130`) equals the pin in `web/wasm/Cargo.toml`; the threaded build runs with `FEATURES: threads` (the bundler build the site needs); the site steps are `npm ci`, `npm test`, `npm run build`, `npm run check` in `web/site`; the artifact path is `web/site/dist`; `deploy` is skipped for pull requests and has `pages: write` and `id-token: write`. Report any mismatch.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "add the Pages workflow for manual and pull-request builds"
```

After the whole plan is merged, the repository owner enables Pages once (Settings, Pages, Source = GitHub Actions) and may run the workflow manually to see it work.

---

### Task 11: Document the site pipeline and the lite build in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Apply the edits**


In `CLAUDE.md`, replace:

````text
`web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). For now it holds the stage B gate page, not the real site.
````

with:

````text
`web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). It renders the chapters from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build) and keeps the stage B gate page at `/gate/`.
````

In `CLAUDE.md`, replace:

````text
cd web/wasm && cargo test                       # native tests of the shared case generator
````

with:

````text
cd web/wasm && cargo test                       # native tests of the shared case generator (add --features threads for the rayon tests)
./build-lite.sh                                 # stable, single-threaded build into pkg-lite/ (no nightly, no threads)
````

In `CLAUDE.md`, replace:

````text
./gate.sh g1|g2|probe|g5 [--no-build]           # build, then run a gate in headless Firefox; --no-build reuses pkg/
````

with:

````text
./gate.sh g1|g2|probe|g5|lite [--no-build]      # build, then run a gate in headless Firefox; --no-build reuses pkg/ (pkg-lite/ for lite)
````

In `CLAUDE.md`, replace:

````text
(cd ../site && ./gate-g3.sh [--no-build])       # Astro production build (Node in Docker) served under /matmul_levels.rs/ with no isolation headers; coi-serviceworker supplies them
````

with:

````text
(cd ../site && ./gate-g3.sh [--no-build])       # Astro production build (Node in Docker) served under /matmul_levels.rs/ with no isolation headers; coi-serviceworker supplies them
web/dev/node.sh site npm test                   # the prose plugin's unit tests
web/dev/node.sh site npm run build              # the site into web/site/dist (needs FEATURES=threads ./build.sh first, for the gate page)
web/dev/node.sh site npm run check              # checks the built site (no crate::, one <h1>, chapters never load the service worker)
````

In `CLAUDE.md`, replace:

````text
Nightly and wasm dependencies live only in `web/wasm`;
````

with:

````text
Astro caches rendered docs in `web/site/node_modules/.astro` keyed by the Markdown, not by the plugin, so `npm run build` clears it first (a plugin change would otherwise be silently ignored). Nightly and wasm dependencies live only in `web/wasm`;
````

- [ ] **Step 2: Verify**

```bash
grep -n "build-lite\|npm run check\|node_modules/.astro\|site.config.mjs" CLAUDE.md | cut -c1-110
```

Expected: four or more lines (the "What this is" paragraph, the Commands block, and the Notes).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "document the site pipeline and the lite build in CLAUDE.md"
```

---

## After this plan

If every task passes, the site shell is done: the chapters render from `docs/` in a clean layout with the two animations, links and output are checked at build time, the lite build and its gate exist, and the Pages workflow builds on request. Next: **C2** (the step-through: `partition_plan` and `env_info` in the wrapper, the custom element placed in chapters 1 to 4, a browser gate for it, and the `/gate/` page's replacement by the playground in C3).
