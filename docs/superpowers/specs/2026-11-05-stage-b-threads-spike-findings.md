# Stage B findings, part one: gates G1 and G2

Spec: `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-design.md`.
Plan: `docs/superpowers/plans/2026-11-05-stage-b-spike-part-one.md`.
Gates G3 (production build on a Pages subpath), G4 (level 4) and G5 (limits)
are not covered here.

## Verdict

**G1 and G2 pass.** The real `naive_matmul` levels 1 to 3 run on a rayon thread
pool in a browser and return, bit for bit, the answer native Rust computes. The
fallback design (JavaScript splitting rows across plain Web Workers) is not
needed for these levels. The `Runner` trait is merged into the core crate.

## Environment

| Item | Value |
|---|---|
| Browser | Mozilla Firefox 159.0.1 (headless) |
| Rust nightly | `nightly-2025-11-15` (rustc 1.93.0-nightly, b6d7ff3aa 2025-11-14) |
| `wasm-bindgen` crate and CLI | `0.2.130` (pinned with `=`; the two must match) |
| `wasm-bindgen-rayon` | 1.3.0 |
| `rayon` | 1.12.0 |
| Machine | 8 hardware threads |

## The build recipe that works

- `rust-toolchain.toml`: the pinned nightly, component `rust-src`, target `wasm32-unknown-unknown`.
- Rust flags for the wasm target: `-C target-feature=+atomics,+bulk-memory` and the linker arguments `--shared-memory`, `--max-memory=1073741824`, `--import-memory`, and exports of `__wasm_init_tls`, `__tls_size`, `__tls_align`, `__tls_base`.
- `-Z build-std=panic_abort,std` is passed on the command line (in `build.sh`), not in `.cargo/config.toml`: a `[unstable] build-std` entry there would also apply to native `cargo test`, which has no `--target`.
- `wasm-bindgen --target web`. Only `cargo build` and the CLI are used; no `wasm-pack`.
- The compiler warns `unstable feature specified for -Ctarget-feature: atomics`; this is expected.
- Without a bundler the `no-bundler` feature of `wasm-bindgen-rayon` is required. Without it each pool worker requests the package directory (`GET /pkg/`) and the pool never starts.
- The page must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`); `web/dev/serve.py` sets both.

## G1: the pool starts and runs in parallel

Pass. In a Web Worker with `initThreadPool(4)`: `crossOriginIsolated` was true, the
pool had 4 threads, starting it took tens of milliseconds, and a parallel sum of
5,000,000 squares returned the same value as an independent Python computation
(`2499487497200`).

## G2: the real crate with threads gives the native answer

Pass. Levels 0 to 3 at n = 256 and 512 with 1, 2 and 4 threads, plus
`simd` with block 7x2 and `cache_friendly` with block 1x1 (22 cases), all return
the hash that native Rust computes with the naive level for the same
order-sensitive operands. Output of `./gate.sh g2 --no-build` from the run that
produced this record:

```text
ok  level 0 n  256 threads 1 block 32x64     128.1 ms  c3bc2df46a8aee26
ok  level 1 n  256 threads 1 block 32x64     134.2 ms  c3bc2df46a8aee26
ok  level 1 n  256 threads 2 block 32x64      42.7 ms  c3bc2df46a8aee26
ok  level 1 n  256 threads 4 block 32x64      22.5 ms  c3bc2df46a8aee26
ok  level 2 n  256 threads 1 block 32x64      36.4 ms  c3bc2df46a8aee26
ok  level 2 n  256 threads 2 block 32x64       8.5 ms  c3bc2df46a8aee26
ok  level 2 n  256 threads 4 block 32x64       8.5 ms  c3bc2df46a8aee26
ok  level 3 n  256 threads 1 block 32x64      19.5 ms  c3bc2df46a8aee26
ok  level 3 n  256 threads 2 block 32x64       7.1 ms  c3bc2df46a8aee26
ok  level 3 n  256 threads 4 block 32x64       7.7 ms  c3bc2df46a8aee26
ok  level 0 n  512 threads 1 block 32x64     475.6 ms  d1033dfddebffe59
ok  level 1 n  512 threads 1 block 32x64     427.1 ms  d1033dfddebffe59
ok  level 1 n  512 threads 2 block 32x64     329.0 ms  d1033dfddebffe59
ok  level 1 n  512 threads 4 block 32x64     193.7 ms  d1033dfddebffe59
ok  level 2 n  512 threads 1 block 32x64     121.6 ms  d1033dfddebffe59
ok  level 2 n  512 threads 2 block 32x64      65.2 ms  d1033dfddebffe59
ok  level 2 n  512 threads 4 block 32x64      61.1 ms  d1033dfddebffe59
ok  level 3 n  512 threads 1 block 32x64      86.6 ms  d1033dfddebffe59
ok  level 3 n  512 threads 2 block 32x64      86.4 ms  d1033dfddebffe59
ok  level 3 n  512 threads 4 block 32x64      54.4 ms  d1033dfddebffe59
ok  level 3 n  256 threads 4 block 7x2      19.1 ms  c3bc2df46a8aee26
ok  level 2 n  256 threads 4 block 1x1      63.0 ms  c3bc2df46a8aee26
speedup level 1 n 512: 1 -> 4 threads = 2.20x (indicative only)
speedup level 2 n 512: 1 -> 4 threads = 1.99x (indicative only)
speedup level 3 n 512: 1 -> 4 threads = 1.59x (indicative only)
```

Timings are indicative only (one browser, one machine, no warm-up); the gate is
about the bits.

## Probe: the standard-library runner in the browser

`StdRunner` (the default, built on `std::thread::scope`) does not work on
`wasm32-unknown-unknown`, even in the atomics build with a live pool: the call
traps with `RuntimeError: unreachable executed` (an unsupported thread spawn
aborting under `panic=abort`). This is why levels 1 to 3 need a `Runner`.

```text
"std_runner_works": false,
"std_error": "RuntimeError: unreachable executed",
```

## Consequences

- Stage C and D can use the real crate in the browser for levels 1 to 3 through `RayonRunner`.
- The wrapper crate (`web/wasm`) is the seed of the site's wasm module; its build needs the pinned nightly, the matching CLI, and isolation headers.
- Level 4 still has its own worker loop and needs the same treatment (gate G4).
- Not yet tested: a production bundle on a GitHub Pages subpath with `coi-serviceworker` (G3); level 4 (G4); memory limits, panic behaviour in a worker, pool start-up cost across sizes and pool resizing (G5); browsers other than Firefox.
