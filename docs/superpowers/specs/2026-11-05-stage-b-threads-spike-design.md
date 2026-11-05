# Stage B: WASM threads spike

Parent spec: `docs/superpowers/specs/2026-11-05-website-design.md` (roadmap,
stage B). Stage A is merged: `row_block_plan`, `tile_plan`, `BlockConfig`
and `matmul_with_config` exist, the MSRV 1.73 build and the `wasm32` library
check pass locally.

## Purpose

Answer one question, cheaply and early: **can the real `naive_matmul` levels
run with real threads in a browser, served from GitHub Pages?** The answer
decides whether stage D (threaded Benchmark and Tuner) is built on the real
crate or on a fallback, and it shapes the wrapper crate that stage C also uses.

This is a time-boxed spike, not a feature. It has go/no-go gates. If a gate
fails the spike stops and reports; it does not push on.

## What we know and what we do not

Checked against upstream docs on 2026-11-05:

- `wasm-bindgen-rayon` needs a pinned nightly, `rust-src`, `-Z
  build-std=panic_abort,std`, `-C target-feature=+atomics,+bulk-memory`, the
  linker args `--shared-memory`, `--import-memory`, `--max-memory=...` and the
  four TLS exports (`__wasm_init_tls`, `__tls_size`, `__tls_align`,
  `__tls_base`), and `wasm-bindgen --target web`. Its README states it was
  tested with `nightly-2025-11-15`, so expect to move the pin.
- The README sets `--max-memory` to 1 GiB, does not name the required HTTP
  headers (it only says cross-origin isolation is needed), and does not
  describe panic behaviour beyond using `panic_abort`.
- `coi-serviceworker` must be a separate same-origin file (not bundled, not
  from a CDN), must sit in or above the folder of the page, and reloads the
  page on first visit. Its defaults use `Cross-Origin-Embedder-Policy:
  credentialless`, falling back to `require-corp`.

Not established, and tested by the spike rather than assumed:

- Whether the standard library's `std::thread::scope` can spawn at all on
  `wasm32-unknown-unknown`, even with atomics and a `build-std` rebuild. Our
  design assumes it cannot and routes around it with a runner trait.
- Whether a current nightly builds the recipe above at all.
- Whether the worker and wasm imports survive an Astro production build and a
  GitHub Pages subpath.

## Core API: a pluggable runner

The core crate stays dependency-free. Spawning is abstracted behind a small
public trait with a std-based default.

- `pub trait Runner: Sync` with one method that runs a batch of jobs to
  completion, jobs borrowing from the caller:
  `fn run<'env>(&self, jobs: Vec<Box<dyn FnOnce() + Send + 'env>>)`.
  Rayon's `scope` accepts exactly this shape, and so does
  `std::thread::scope`.
- `pub struct StdRunner;` runs the jobs on `std::thread::scope` (today's
  behaviour, and the default used by every existing `matmul`).
- Entry points `*_with_runner` for levels 1 to 4 take `&impl Runner`. The
  existing functions delegate with `StdRunner`; signatures and results do not
  change.
- Level 4's workers return `io::Result`; the runner returns nothing, so
  worker results travel through shared slots (a `Mutex<Vec<Option<...>>>`),
  and a panic still propagates as today.

The trait is part of the spike because gate G2 needs it. It is merged into the
core crate only if G2 passes.

## Wrapper and tooling

- `web/wasm/`: a separate crate (empty `[workspace]` table, tracked
  `Cargo.lock`, its own `rust-toolchain.toml` pinning the nightly). It depends
  on `naive_matmul` by path, on `wasm-bindgen` pinned with `=` to match the CLI
  version, and on `wasm-bindgen-rayon`. The core crate never sees the nightly.
- A `RayonRunner` in the wrapper implements `Runner` with `rayon::scope`.
- Build with `cargo build --release --target wasm32-unknown-unknown` then the
  `wasm-bindgen` CLI (`--target web`). No `wasm-pack`.
- A tiny stdlib-only Python dev server (`web/dev-server.py`) serves a
  directory with COOP/COEP headers and the right wasm MIME type, so G1 and G2
  can be checked without Node.
- Gate G3 uses a minimal Astro project, since stage C is Astro. That needs Node.

## Gates

Each gate states its pass condition and what a failure means.

**G1: a worker pool starts and runs in parallel.**
A page served with isolation headers calls `initThreadPool(n)` and runs a
trivial rayon `par_iter` sum in a Web Worker, in Firefox. Pass: correct
result and `crossOriginIsolated === true`.
Failure: stop. Fall back to the Web-Worker-per-row-block design (JavaScript
partitions the rows; each worker runs the single-threaded kernel on its
slice). Record the error.

**G2: the real crate, with threads, gives the native answer.**
Add `Runner`, `StdRunner` and the level 1 to 3 `*_with_runner` functions;
implement `RayonRunner`. Multiply `rough_operands`-style matrices (a seeded
generator, same as `tests/levels.rs`) of n = 256 and 512 at 1, 2 and 4 threads
in the browser and compare an FNV-1a hash of the result's `to_bits()` with the
native result for the same inputs. Pass: hashes equal for every level and
thread count, and the 4-thread run is measurably faster than the 1-thread run
(indicative only).
Failure on equality: a real bug; stop and investigate (bits must match).
Failure on speed only: record it; correctness is the gate.

**G3: it survives a production build on a Pages-style subpath.**
A minimal Astro project mounts the same demo, `astro build` runs, and the
output is served from `/matmul_levels.rs/` by a local static server that does
**not** set COOP/COEP, with `coi-serviceworker` placed so it controls the
page. Pass: after the automatic first-load reload the page is
`crossOriginIsolated` and G2 still passes from the built bundle.
Failure: record the cause. If the bundler is at fault, try the workarounds in
the wasm-bindgen-rayon README. If the service worker cannot work under a
project subpath, the fallback is a host that sets headers (Cloudflare Pages or
Netlify `_headers`), which changes the stage C and D deployment plan.

**G4: level 4 works with the runner.**
Add `matmul_streaming_with_runner` and run it with `MemorySink` at 1, 2 and 4
threads and two tile shapes. Pass: hashes equal to native.
Failure: record; level 4 may then be limited to a single-threaded mode on the
site.

**G5: measure the limits.** Record, with numbers: the largest n that fits the
memory cap for each of levels 1 to 4; what a panic inside a worker does (does
the page hang, trap, or recover); the cost of `initThreadPool` at 1, 4 and 8
threads; and whether the pool can be re-initialised with a different size
without reloading.

## Outputs

- `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md`: per
  gate pass or fail, the pinned nightly and CLI versions that worked, the exact
  build flags, measured limits, and a go/no-go recommendation for stage D with
  the consequences for stage C.
- If G1 and G2 pass: `Runner`/`StdRunner`/`*_with_runner` merged into the core
  crate with tests (every level's `*_with_runner` bit-identical to `matmul`
  under `StdRunner`), and `web/wasm/` kept as the seed of the wrapper crate.
- If G1 fails: no core change; the findings document recommends the fallback
  design and the spike code is discarded.

## Testing

- Core: unit and integration tests that every `*_with_runner` with
  `StdRunner` is bit-identical to the plain function across thread counts and
  `BlockConfig` values (extend `tests/levels.rs`). A test `Runner` that runs
  jobs sequentially on the calling thread proves the trait is
  runner-agnostic.
- MSRV and `wasm32` library checks (already in CI) must stay green: the
  runner trait must not use anything newer than 1.73.
- Browser gates are manual, in Firefox, recorded in the findings. No browser
  test framework is added in the spike.

## Environment needed (installs on your machine, so your call)

- A pinned nightly with `rust-src` and the wasm target, e.g.
  `rustup toolchain install nightly-2025-11-15 --profile minimal -c rust-src
  -t wasm32-unknown-unknown`.
- `wasm-bindgen-cli` (`cargo install wasm-bindgen-cli`, version matched to the
  crate during the spike).
- Node.js and npm for G3 only (on Arch: `pacman -S nodejs npm`).
- Firefox is already installed; no Chromium is, so cross-browser testing is
  out of scope.

## Out of scope

- The site itself, the Benchmark and Tuner UI, and any real page design
  (stages C and D).
- Cancellation of long runs, a worker-pool resize UI, and the single-threaded
  fallback build for non-isolated pages (stage D design).
- Cross-browser testing and CI for the browser (a later decision).
