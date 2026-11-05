# Interactive explainer website: roadmap and first two stages

Revision 2. This replaces the single-spec draft after a review against the
source. The work is split into five stages (A to E). **This document specifies
A and C in detail** (a crate and docs foundation, then a stable single-threaded
site). B, D and E are recorded as a roadmap with the known hazards, and each
gets its own spec before it starts.

## Goal

A public site that teaches the five matmul levels and, over time, lets visitors
run the **real Rust code** in the browser: step through partitioning, benchmark
the levels, and tune parameters.

Constraints carried over from the project:

- `naive_matmul` stays dependency-free, `#![forbid(unsafe_code)]`, MSRV 1.73.
- `docs/` stays the single source of truth for prose (rustdoc and site).
- Every level stays bit-for-bit identical. New parameters must never change
  per-element summation order (increasing `k`, starting from zero).

## Roadmap

| Stage | What | Depends on | Spec |
|---|---|---|---|
| A | Crate and docs foundation: green CI, honest invariant tests, public plan functions, runtime `BlockConfig` | none | this document |
| B | Threads spike: nightly WASM threads, Astro production build, Pages subpath, service worker | A | later |
| C | Site on stable, single-threaded WASM: prose pipeline, `StepThrough` demo, deployment | A | this document |
| D | Threaded `Benchmark` and `Tuner` on the nightly build | A, B, C | later |
| E | Animations: re-render and add missing levels | C | later |

C ships a real, deployed site without any nightly toolchain or threading. B is
the risky experiment and does not block it.

## Decisions (unchanged from the first draft)

| Topic | Choice |
|---|---|
| Interactivity | Real Rust compiled to WASM |
| Demo scope | Step-through, benchmark of all levels, parameter tuning |
| Threads | Nightly `build-std` with atomics and shared memory (stage B and D) |
| Hosting | GitHub Pages via Actions |
| Site stack | Astro rendering `docs/*.md`, demo components embedded per chapter |

---

## Stage A: crate and docs foundation

All changes are behaviour-preserving for existing callers. Each item can land as
its own PR.

### A1. Make CI green

`cargo test` currently fails in the doc-test phase (`error[E0583]: file not
found for module design / guide / reference`), so `rust.yml` is red on trunk.
`CLAUDE.md`'s claim that normal `cargo test` skips these is wrong.

- Add `src/design.rs`, `src/guide.rs`, `src/reference.rs`, each a
  `#![doc = include_str!(...)]` of the matching pages under `docs/`.
- `docs/reference/` is empty. Either add the pages the intro links to or drop
  the `reference` module and its links. Decide by listing which `crate::`
  links in the existing prose have no target, then cut or write them.
- Correct `CLAUDE.md` once `cargo test` is green.

### A2. Fix stale prose

The site would publish this verbatim, so fix it first:

- "Level N of 3" headings in the level chapters, against "Level 3 of 4" in
  `simd.md`: make them consistent (levels 0 to 4).
- `threaded.md:88` says "Level 3 uses a work queue"; it is level 4.
- `getting_started.md` and `architecture.md` say "four levels/implementations".
- `simd.md:203` and `CLAUDE.md` say level 4 reuses the micro-kernel. It does not:
  `streaming/kernel.rs` is level 2's `axpy` kernel with `TILE_K` and `TILE_J`.

### A3. Invariant tests that can fail

`tests/levels.rs` uses small-integer operands "so every sum is exact", so a
reassociating change would still pass. `simd::matmul` is missing from
`product_at_every_level`, and `assert_eq!` on `f64` treats `-0.0 == 0.0`.

- Add `simd::matmul` to `product_at_every_level`.
- Add a second operand set of non-exact values (mixed magnitudes from a seeded
  pseudo-random generator written inline; no dependencies).
- Compare with `f64::to_bits()`.
- Keep the integer set; it still pins down the arithmetic.

### A4. Public plan functions

The partition currently lives inline (`threaded.rs:62-67`, duplicated in
`cache_friendly.rs:102-108`; level 4 builds a private `Plan` at
`streaming/multiply.rs:122-137`). The site must show what the code does, so the
drivers should call the same functions the site calls.

- Level 1 and 2: `row_block_plan(rows, threads) -> Vec<Range<usize>>`; the
  drivers use it for `chunks_mut` sizing.
- Level 4: `tile_plan(...)` returns the tile grid (row, column, depth ranges and
  the order in which tiles are numbered). Workers claim tiles from an atomic
  counter, so **there is no fixed thread-to-tile mapping**. The plan exposes
  tile order only, and the site labels its animation "tiles are claimed in this
  order by whichever worker is free".
- Unit tests: every output element is covered exactly once, for sizes that
  divide evenly and sizes that do not, including zero-sized matrices.

### A5. Runtime `BlockConfig` for levels 2, 3 and 4

- `BlockConfig { tile_k: NonZeroUsize, tile_j: NonZeroUsize }`, in the style of
  `StreamConfig`. `NonZeroUsize` because `step_by(0)` panics
  (`cache_friendly.rs:47`, `simd.rs:205`).
- Thread it through level 2's kernel, level 3's `accumulate_tile`, and
  `StreamConfig` into `streaming/kernel.rs`. Existing `matmul` functions pass
  today's defaults (`TILE_K = 32`, `TILE_J = 64`).
- `RowBlockKernel` is a bare `fn` pointer (`threaded.rs:37`) and cannot carry a
  config. Change it to a generic closure parameter on `multiply_by_row_blocks`.
- Move level 2 onto `multiply_by_row_blocks` so the two copies of the driver
  become one. Level 4's driver (scoped threads returning `io::Result`) stays
  separate by design.
- **Micro-tile size stays a compile-time constant.** `MR` and `NR` are array
  dimensions (`[[f64; NR]; MR]`), so a runtime slider would need const-generic
  variants for a fixed menu. That is out of scope; the site only reports
  `micro_tile_shape()`.
- Tests: the extended A3 comparison runs across several `BlockConfig` values
  and thread counts.

### A6. Smaller core items

- `target_vector_isa()` returns "none (scalar code)" on `wasm32` even with
  `+simd128`. Add a `simd128` arm and a matching row in the `simd.md` table.
- CI: add an MSRV job (1.73) and a stable
  `cargo check --target wasm32-unknown-unknown` for the core crate, so new
  public API cannot silently break either.

### A7. Repo hygiene for what comes next

- Root `Cargo.toml`: add `exclude = ["web/", "anim/", ".github/", "docs/superpowers/"]`
  to `[package]` so the site and media stay out of the published crate.
- `.gitignore`: add `node_modules/`, `.astro/`, `web/wasm/pkg/`, and a negation
  `!web/wasm/Cargo.lock` (the root ignores `Cargo.lock`, but the wrapper needs
  its lockfile tracked). Note that the existing `lib/` rule would ignore
  `web/site/src/lib/`; avoid that directory name or anchor the rule to the root.

---

## Stage C: site on stable, single-threaded WASM

Stage C needs only the pure plan functions from A4 and `env_info`, so it uses
stable Rust and plain static hosting. No service worker, no atomics.

### Layout

```
web/
  wasm/        wasm-bindgen wrapper crate (stable)
  site/        Astro project
    public/    served assets
    site.config.ts   chapter titles, order, level numbers, demo placement
```

- `web/wasm/Cargo.toml` contains an **empty `[workspace]` table**. The root has
  no workspace, so a root-level `exclude` would have nothing to attach to; this
  keeps the wrapper independent. It depends on `naive_matmul` by path.
- `web/wasm/Cargo.lock` is tracked. CI installs the `wasm-bindgen` CLI at the
  exact version in that lock (prefer `cargo build` plus the pinned CLI over
  `wasm-pack`).

### WASM wrapper API

Pure functions only; no threads, no timing, no I/O.

- `partition_plan(level, rows, cols, inner, threads, block) -> Plan`,
  serialised for the page. Validates every parameter and returns an error value
  instead of panicking.
- `env_info() -> { isa, micro_tile }` from `target_vector_isa()` and
  `micro_tile_shape()`.

### Prose pipeline

Content sources for v1: `docs/introduction.md` and `docs/levels/*.md`. The
guide and architecture pages are **cut from v1**: they contain dead links and
stale numbering and can return once fixed.

- The Astro content glob is restricted to those files. It never globs `docs/**`
  (that tree also holds `docs/superpowers/`).
- The chapters have no frontmatter, and none can be added (`include_str!` would
  render it as text in rustdoc). Titles, order, level numbers and demo placement
  live in `site.config.ts`.
- A remark step strips rustdoc-hidden lines (`# `, bare `#`, `##`) **only inside
  `rust` fences**. There are seven such lines today, all `# Ok::<...>(())`.
  Other fence types and headings are untouched.
- A link-rewriting step maps `crate::...` intra-doc links and shortcut
  references (``[`naive`]``) to chapter routes or docs.rs. **Unresolvable links
  fail the build.** This is what keeps dead links from shipping.
- Demos are mounted by heading slug from `site.config.ts` through a rehype
  step, since MDX component tags cannot appear in the shared Markdown.
- Chapters have several H1s and no page title; the layout supplies the title
  and the plugin demotes in-page H1s.

### `StepThrough` demo

A grid (4x4 up to 16x16) coloured by the plan from `partition_plan`:

- Levels 1 and 2: rows coloured by owning thread (deterministic).
- Level 4: tiles numbered in claim order, captioned as above.
- Level 3: shows the register-block shape from `micro_tile_shape()`.
- Play and scrub controls, parameter inputs (rows, threads, block sizes).

### Animations

Reference the Manim mp4s already tracked under `anim/media/videos/` (480p15,
1.1 to 2.1 MB each); copy them into the build output at build time rather than
committing duplicates. Embed only where the content matches the prose:
`naive_matmul` in chapter 0 and, after checking that it describes row blocks,
`naive_matmul_parallel` in chapter 1. **`naive_matmul_parallel_cache` is
column-major** (one column of C per thread) and contradicts the row-major
prose, so it is not embedded until re-rendered (stage E). Levels 3 and 4 have no
video yet.

### Deployment

New `.github/workflows/pages.yml`: stable Rust with the `wasm32-unknown-unknown`
target, pinned `wasm-bindgen` CLI, Node, `astro build`, deploy to GitHub Pages.
Astro needs `site` and `base: '/matmul_levels.rs/'` set, since this is a project
site served from a subpath.

### Testing

- `astro build` succeeds in CI, including the link check.
- Native `cargo test` for the wrapper's pure logic (parameter validation, plan
  serialisation).
- Manual browser check of `StepThrough` at the extremes (1 thread, more threads
  than rows, zero-sized input rejected cleanly).

---

## Stages B, D, E: roadmap and known hazards

Recorded from the review so the later specs start informed. Not designed yet.

**B: threads spike.** Prove, in a real Astro production build served from a
Pages subpath with the service worker, that a rayon-backed pool runs the crate.
Needs a pluggable runner: `std::thread::scope` does not work on
`wasm32-unknown-unknown`, so levels 1 to 4 need public `*_with_runner` entry
points over a fork-join trait (for example boxed `FnOnce() + Send + 'env` jobs,
which `rayon::scope` accepts). Build recipe beyond `+atomics,+bulk-memory,
+mutable-globals,+simd128` and `-Z build-std=std,panic_abort`: the
`--shared-memory`, `--max-memory`, `--import-memory` link args, the
`__wasm_init_tls` / `__tls_size` / `__tls_align` / `__tls_base` exports,
`wasm-bindgen --target web`, a pinned dated nightly, and the `rust-src`
component. `rust-toolchain.toml` and `.cargo/config.toml` apply only when run
from the wrapper directory.

**D: threaded demos.** Hazards to design for:
- `panic=abort` makes any panic a trap and can hang a rayon scope; validate all
  parameters before calling in.
- The rayon global pool is built once; the thread slider cannot resize it
  (fixed pool at `hardwareConcurrency`, capped slider, or re-create the Worker).
- A default 1 GiB memory cap bounds `n` to roughly 2000 to 4000; set slider
  limits.
- No cancellation inside a Worker; cap `n` per level or warn on cost.
- `Instant::now()` panics on wasm; time with `performance.now()` or `web-time`,
  with warm-up runs, and label timings indicative only.
- The demo checksum is a hash of `to_bits()` over non-exact data, so cross-level
  equality is meaningful.
- Non-isolated fallback: the atomics build needs `SharedArrayBuffer`, so ship a
  second stable build with an inline runner for that case.
- `coi-serviceworker` must be a separate same-origin file at or above `base`,
  reloads the page on first visit, and with `require-corp` blocks third-party
  fonts and embeds (self-host everything). `astro dev` needs the headers via
  Vite `server.headers`.

**E: animations.** Re-render the parallel-cache scene row-major, add scenes for
levels 3 and 4, and optionally render Manim in CI.

## Out of scope

- `FileMatrix` demos (no filesystem in the browser).
- Runtime micro-tile size selection (compile-time constants by design).
- Rendering Manim in CI (stage E, optional).
