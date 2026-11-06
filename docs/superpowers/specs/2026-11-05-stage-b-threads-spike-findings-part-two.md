# Stage B findings, part two: gates G4, G5 and G3

Spec: `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-design.md`.
Plan: `docs/superpowers/plans/2026-11-05-stage-b-spike-part-two.md`.
Part one (G1 and G2): `docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings.md`.

## Verdict

**G4, G5 and G3 are done, and G3 and G4 pass.** Levels 1 to 4, including level 4,
run on a rayon thread pool in Firefox, and all five levels return the native answer bit for bit.
The same module works from an Astro production build served under
`/matmul_levels.rs/` by a server that sends no cross-origin-isolation headers:
`coi-serviceworker` supplied them, after one automatic page reload. G5 measured
the limits below, except the largest `n` per level, which is derived from the memory cap rather than measured.

**Recommendation for stages C and D: GO**, with GitHub Pages as the host and
`coi-serviceworker` for isolation. The fallback (a host that sets headers, such
as Cloudflare Pages or Netlify `_headers`) is not needed for what was tested, but
real GitHub Pages was not tested (see "Not tested").

## Environment

| Item | Value |
|---|---|
| Browser | Mozilla Firefox 159.0.1 (headless) |
| Node (Docker image `node:latest`) | v26.13.0 |
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

The spec asked for two tile shapes. The browser runs used one (64 x 64 x 64) and
varied the cache blocks instead (32 x 64, and once 7 x 2). Other tile shapes
with a runner are covered only by the native test
`streaming_runners_never_change_the_bits` (16 x 24 x 20, 1 x 1 x 1 and
1000-cubed tiles; 1, 3 and 8 threads; an inline runner and `StdRunner`).

`threads` is the number of jobs (workers), handed to a fixed pool of 4, as for
the other levels. A panic in a source or sink now reaches the caller of
`matmul_streaming` as `StdRunner`'s generic "a scoped thread panicked" message
rather than the original payload (a runner that runs jobs inline rethrows
the original, and so does rayon on a target that unwinds; the browser build is
`panic=abort`, see G5).

## G5: measured limits

Output of `./gate.sh g5` from the run that produced this record:

```text
probe {"hash": "c3bc2df46a8aee26", "init_ms": 141.48, "kind": "pool", "outcome": "ok", "pool_threads": 1, "run_ms": 36.48000000000002, "threads": 1}
probe {"hash": "c3bc2df46a8aee26", "init_ms": 31, "kind": "pool", "outcome": "ok", "pool_threads": 4, "run_ms": 15.040000000000006, "threads": 4}
probe {"hash": "c3bc2df46a8aee26", "init_ms": 40.8, "kind": "pool", "outcome": "ok", "pool_threads": 8, "run_ms": 12.480000000000004, "threads": 8}
probe {"first_pool": 4, "kind": "reinit", "outcome": "ok", "pool_after": 4, "second_error": "Error: called `Result::unwrap_throw()` on an `Err` value", "second_init": "error"}
probe {"kind": "panic", "outcome": "hung", "timeout_ms": 30000}
probe {"checksum": "65536", "kind": "memory", "mib": 256, "outcome": "ok"}
probe {"checksum": "131072", "kind": "memory", "mib": 512, "outcome": "ok"}
probe {"checksum": "196608", "kind": "memory", "mib": 768, "outcome": "ok"}
probe {"checksum": "229376", "kind": "memory", "mib": 896, "outcome": "ok"}
probe {"checksum": "256000", "kind": "memory", "mib": 1000, "outcome": "ok"}
probe {"error": "unreachable executed", "kind": "memory", "mib": 1100, "outcome": "error"}
GATE G5: PASS
```

`GATE G5: PASS` means only that the page ran every probe and reported. G5 has no pass condition on the numbers, and a probe that errored or hung still prints PASS.

What it shows:

- **Pool start-up** took from about 30 ms to about half a second. The run pasted above gave 141/31/41 ms for 1/4/8 threads; four earlier runs of this gate (not pasted) gave 145/98/209, 110/30/97, 56/120/209 and 37/110/517 ms. It varies a lot from run to run. In all five runs the 8-thread pool started more slowly than the 4-thread pool, and the 1-thread pool was not reliably the fastest. Treat it as tens to hundreds of milliseconds, not a benchmark, and start the pool once per Worker, ahead of the first call.
- **A pool cannot be resized.** A second `initThreadPool` with a different size fails with `unwrap_throw() on an Err value` (rayon's global pool is built once) and the pool stays at its first size. Changing the thread count in the UI therefore means a fresh Worker, or varying the number of jobs over a fixed pool.
- **A panic in a pool job hangs the caller.** The probe's call had not returned after 30 seconds, and no error reached JavaScript. Under `panic=abort` the job traps, which presumably leaves the thread that called `run` waiting for a job that never finishes (the hang was observed; the mechanism was not inspected). Every call must have a timeout and a way to terminate the Worker; the probe page does this with a 30 second timer and `worker.terminate()`.
- **The 1 GiB memory cap is real.** Allocating 1000 MiB and writing one byte in every 4 KiB of it worked; 1100 MiB aborted with `unreachable executed` (a wasm trap). The cap comes from `--max-memory=1073741824` in the build flags and could be raised at build time. For scale: three `n x n` `f64` matrices take `24 n^2` bytes, so levels 0 to 3 should fit under about 1000 MiB up to roughly `n = 6,000`, and level 4 with a `MemorySink` holds the same three matrices plus small tile buffers, so about the same. These figures are derived: the largest `n` for each level was not measured, and the wrapper rejects `n > 2048`. The `n = 512` timings above are already tens to hundreds of milliseconds, so running time is likely to limit `n` before memory does, but that was not measured at larger `n`.

## G3: the production build under a Pages-style subpath

Pass. Output of `./gate-g3.sh` from the run that produced this record (the Astro
build lines are trimmed):

```text
{
  "gate": "g2",
  "isolated": true,
  "cores": 8,
  "pool_init_ms": 47.559999999999995,
  "pool_threads": 4,
  "ok": true,
  "base": "/matmul_levels.rs/",
  "loads": 1
}
ok  level 0 n  256 threads 1 block 32x64     121.7 ms  c3bc2df46a8aee26
ok  level 1 n  256 threads 1 block 32x64     119.4 ms  c3bc2df46a8aee26
ok  level 1 n  256 threads 2 block 32x64      32.7 ms  c3bc2df46a8aee26
ok  level 1 n  256 threads 4 block 32x64      24.7 ms  c3bc2df46a8aee26
ok  level 2 n  256 threads 1 block 32x64      39.0 ms  c3bc2df46a8aee26
ok  level 2 n  256 threads 2 block 32x64      12.1 ms  c3bc2df46a8aee26
ok  level 2 n  256 threads 4 block 32x64       9.8 ms  c3bc2df46a8aee26
ok  level 3 n  256 threads 1 block 32x64      27.9 ms  c3bc2df46a8aee26
ok  level 3 n  256 threads 2 block 32x64       9.1 ms  c3bc2df46a8aee26
ok  level 3 n  256 threads 4 block 32x64       9.0 ms  c3bc2df46a8aee26
ok  level 4 n  256 threads 1 block 32x64      21.2 ms  c3bc2df46a8aee26
ok  level 4 n  256 threads 2 block 32x64      16.4 ms  c3bc2df46a8aee26
ok  level 4 n  256 threads 4 block 32x64      10.2 ms  c3bc2df46a8aee26
ok  level 0 n  512 threads 1 block 32x64     412.3 ms  d1033dfddebffe59
ok  level 1 n  512 threads 1 block 32x64     500.1 ms  d1033dfddebffe59
ok  level 1 n  512 threads 2 block 32x64     318.5 ms  d1033dfddebffe59
ok  level 1 n  512 threads 4 block 32x64     199.9 ms  d1033dfddebffe59
ok  level 2 n  512 threads 1 block 32x64     141.9 ms  d1033dfddebffe59
ok  level 2 n  512 threads 2 block 32x64     121.2 ms  d1033dfddebffe59
ok  level 2 n  512 threads 4 block 32x64      62.7 ms  d1033dfddebffe59
ok  level 3 n  512 threads 1 block 32x64     105.4 ms  d1033dfddebffe59
ok  level 3 n  512 threads 2 block 32x64      61.8 ms  d1033dfddebffe59
ok  level 3 n  512 threads 4 block 32x64      50.1 ms  d1033dfddebffe59
ok  level 4 n  512 threads 1 block 32x64     119.0 ms  d1033dfddebffe59
ok  level 4 n  512 threads 2 block 32x64      78.1 ms  d1033dfddebffe59
ok  level 4 n  512 threads 4 block 32x64      48.5 ms  d1033dfddebffe59
ok  level 3 n  256 threads 4 block 7x2      23.2 ms  c3bc2df46a8aee26
ok  level 2 n  256 threads 4 block 1x1      57.2 ms  c3bc2df46a8aee26
ok  level 4 n  256 threads 4 block 7x2      22.9 ms  c3bc2df46a8aee26
speedup level 1 n 512: 1 -> 4 threads = 2.50x (indicative only)
speedup level 2 n 512: 1 -> 4 threads = 2.26x (indicative only)
speedup level 3 n 512: 1 -> 4 threads = 2.10x (indicative only)
speedup level 4 n 512: 1 -> 4 threads = 2.46x (indicative only)
GATE G3: PASS
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
- The largest `n` for each of levels 1 to 4 under the memory cap (the spec asked for it; only raw allocations and the formula above were checked), and any `n` above 2048.
- Level 4 with tile shapes other than 64 x 64 x 64 in the browser.
- Machines with fewer than 8 hardware threads, and pool sizes other than 1, 4 and 8.
- Contexts where service workers are unavailable or blocked (for example some private-browsing modes). The page would stay non-isolated there, which is why stage D needs the single-threaded fallback.
- Calling the module from the main thread. The advice to use a Worker rests on `Atomics.wait` being disallowed there, which was not exercised.

## Consequences for stages C and D

- Use the real crate in the browser for all five levels (levels 1 to 4 through `RayonRunner`; level 0 is single-threaded), inside a Web Worker (rayon waits with `Atomics.wait`, which the main thread may not do).
- Host on GitHub Pages with `coi-serviceworker`. Expect one reload on a visitor's first visit, and tell them (the script's `quiet` option and a visible message help).
- Treat the pool size as fixed per Worker; vary `threads` as a job count, or start a new Worker to change the pool.
- Wrap every call in a timeout and terminate the Worker on expiry; a panic in a job cannot be caught.
- Cap `n` in the UI by running time and by the 1 GiB limit; expose the limit in the build flags if bigger inputs matter.
- Keep Node in Docker (`web/dev/node.sh`); in CI use the official Node setup action with a pinned version instead of `node:latest`.
