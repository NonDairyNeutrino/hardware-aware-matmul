# Stage C: the website

Parent roadmap: `docs/superpowers/specs/2026-11-05-website-design.md`. This
spec replaces its "Stage C" and "Stage D" sections. Stage B is merged and proved
that the real crate runs on a rayon thread pool in the browser, from an Astro
production build served under `/matmul_levels.rs/` without server-set isolation
headers (findings:
`docs/superpowers/specs/2026-11-05-stage-b-threads-spike-findings-part-two.md`).

## Goal

A public site that teaches the five matmul levels and lets visitors run the
real Rust code in their browser. The first release contains:

1. the chapters (the introduction and the five level pages), rendered from the
   Markdown in `docs/`;
2. an interactive **step-through** inside the chapters, showing how the work is
   split (which rows or tiles go to which thread);
3. a **playground** page that runs the real levels live, with timings, sliders
   for thread count and block sizes, and a check that every level gives the
   same answer.

Constraints carried over: `docs/` stays the single source of truth for prose
(shared with rustdoc); the core crate stays dependency-free, `forbid(unsafe_code)`
and MSRV 1.73; every level returns bit-for-bit identical results; Node runs only
in Docker locally (`web/dev/node.sh`); no commit trailers, one-line messages.

## Decisions

| Topic | Choice |
|---|---|
| First release | Chapters + step-through + playground, built as three plans in order and published together |
| Look and feel | Clean article style: restrained typography, generous spacing, light and dark themes following the system, syntax-highlighted code, a simple chapter navigator; the demos are the colourful part |
| wasm builds | Two builds of one crate: **lite** (stable Rust, no threads) for the chapters and as the playground fallback; **threads** (pinned nightly) for the playground |
| Isolation | `coi-serviceworker` is served from the site root (its scope must cover `/_astro/`, where the worker and wasm live) but only pages that need threads load it, so only the playground pays the one-time reload; chapters never load it and never reload |
| Framework | Astro (pinned 7.4.7), no UI framework; demos are vanilla custom elements |
| Hosting | GitHub Pages from `trunk` via Actions; publishing is gated until all three plans are merged |

## Architecture

```
web/
  wasm/             wrapper crate: lite and threads builds from one source tree
    pkg-lite/       generated: stable build, plan functions + single-threaded runs
    pkg/            generated: threaded build (bundler mode for the site)
  site/             Astro project
    site.config.mjs chapters, link table, demo placement, videos
    src/plugins/    remark/rehype plugins for the prose pipeline
    src/components/ step-through and playground custom elements
    src/pages/      chapters, playground
    public/         generated at build: coi-serviceworker.js, expected.json, media/ (videos)
  dev/              node.sh, serve.py, run_page.sh, check_report.py (existing)
```

### Wrapper crate: lite and threads builds

`web/wasm` gains a cargo feature `threads` (default off):

- `threads` enables the optional dependencies `rayon` and `wasm-bindgen-rayon`,
  `RayonRunner`, `init_thread_pool` and the stage B probes.
- Without it the crate builds on **stable** (verified: 7 s, 110 KB before
  optimisation) and runs every level on the calling thread through a new
  `InlineRunner`.
- `no-bundler` implies `threads`. The bundler build for the site is
  `FEATURES=threads`; `FEATURES=` (empty) now means the lite build.
- The wasm rustflags (atomics, shared memory, TLS exports) move from
  `.cargo/config.toml` into `build.sh`, applied only to threaded builds, so the
  lite build gets no atomics flags. `-Z build-std` stays on the command line.
- A new `build-lite.sh` runs `cargo +stable build` and `wasm-bindgen --target web`
  into `pkg-lite/`.

### Wrapper API (both builds)

- `partition_plan(level, rows, inner, cols, threads, tile_rows, tile_cols,
  tile_depth) -> Result<String, JsError>`: JSON from the core crate's own plan
  functions. Levels 0 to 3: `{"kind":"rows","blocks":[[start,end],...]}` from
  `threaded::row_block_plan` (level 0 is one block). Level 4:
  `{"kind":"tiles","tiles":[{"rows":[a,b],"cols":[a,b]},...],"depth":[[a,b],...],
  "workers":w}` from `streaming::tile_plan`. Display sizes only: `rows`, `cols`
  and `inner` are capped at 64 so the JSON stays small. Every argument is
  validated and returns `Err`, never panics (the threaded build is `panic=abort`).
- `env_info() -> String`: `{"isa":"SSE2","micro_tile":[4,4],"threads":false}`
  from `target_vector_isa()`, `micro_tile_shape()` and the build's `threads` flag.
- `run_level(level, n, threads, tile_k, tile_j, tile_rows, tile_cols,
  tile_depth) -> Result<String, JsError>`: the bit hash of the level's product on
  the rough operands. It generalises `run_case` (which keeps its signature for the
  gates, with level 4 fixed at 64 x 64 x 64) by taking the level 4 tile shape.
  Timing is done by the page around the call.

### Prose pipeline

Prototyped against the real files: Astro renders `docs/introduction.md` and
`docs/levels/*.md` from outside its project folder, with these steps:

- Content collection with a `glob` loader restricted to those files, `base:
  '../../docs'`. Never `docs/**` (that tree also holds `docs/superpowers/`).
  `node.sh` mounts `docs/` read-only at `/docs` so the same relative path works in
  the container and on a CI runner.
- Astro 7's default Markdown processor does not run remark plugins; install
  `@astrojs/markdown-remark` (exact version) and set
  `markdown.processor: unified({ remarkPlugins: [...] })`.
- A remark plugin: strips rustdoc-hidden lines (`# ` and bare `#`, unescapes `##`)
  inside `rust` fences only; demotes headings one level (the page layout supplies
  the title; all 48 headings in the chapters are level 1 today); drops
  reference-style definitions after resolving them; rewrites `crate::...` links
  and shortcut references (`` [`naive`] ``) through an explicit table in
  `site.config.mjs`. A string is a route under the base path; `null` renders the
  text as plain code. **Any target not in the table fails the build.**
- Demos are placed after named headings by the same plugin, from a `demos` list in
  `site.config.mjs` (chapter, heading text, element). The Markdown stays free of
  site markup.
- Chapter titles, order and page routes live in `site.config.mjs` because the
  chapters have no frontmatter (rustdoc would show it as text).
- The existing Manim videos are copied at build time: `naive_matmul` into the
  Level 0 chapter and `naive_matmul_parallel` into Level 1 (one row of C per
  thread, the one-row case of the chapter's row blocks, captioned as such).
  `naive_matmul_parallel_cache` is column-major and contradicts the prose, so it
  stays out until re-rendered.

### Step-through (in the chapters)

A custom element `<step-through level="N">`, loaded only on chapter pages, using
the lite build. Controls: output rows, columns and inner size (4 to 16),
threads (1 to 8), and level-specific parameters. It draws the output matrix `C`
as a grid coloured by owner, from `partition_plan`, with play, pause and scrub.

- Level 1: row blocks, each in its thread's colour (deterministic).
- Level 2: the same row blocks plus an overlay of the `tile_k x tile_j` cache
  blocks over `B` (geometry from the numbers the user chose).
- Level 3: row blocks plus the `MR x NR` micro-tile over `C`, from `env_info()`.
- Level 4: tiles numbered in claim order, captioned "claimed in this order by
  whichever worker is free" (there is no fixed worker-to-tile mapping).
- Level 0: none (the chapter is prose and a video).

Honours `prefers-reduced-motion` (no auto-play), is keyboard operable, and shows
the real plan JSON on request ("show the plan").

### Playground

A page at `/matmul_levels.rs/playground/`. A Web Worker owns the wasm module; the
page never calls it directly.

- Controls: matrix size `n` (64 to 1024, powers of two, default 256), levels to
  run (0 to 4), threads (1 up to the pool size), repeats (1, 3, 5; the median is
  reported), cache block sizes (levels 2 to 4), level 4 tile shape. A Run button
  and a Cancel button.
- Output: time per level with bars and speedup against level 0 and against the
  previous level; a prominent **"same answer" indicator** that is true only when
  every selected level returned the same bit hash; the build in use (threads or
  single-threaded, ISA, micro-tile); a note that browser timings are indicative.
- Worker protocol: the page posts a run request, the worker streams one result per
  level. Every request has a timeout scaled to `n` and the selected levels; on
  timeout or Cancel the page terminates the Worker and starts a fresh one (a panic
  on the pool hangs the caller, and a pool cannot be resized).
- The pool size is fixed per Worker at `min(hardwareConcurrency, 8)`; the threads
  control is the number of jobs over that pool.
- **Isolation state machine** on page load: if `crossOriginIsolated`, use the
  threaded build. Otherwise `coi-serviceworker` (loaded by this page only) registers
  and reloads once, with a visible message. If the page is still
  not isolated after that (service workers blocked or unsupported), use the lite
  build and cap threads at 1, with a banner saying so. The `sessionStorage` load
  counter is cleared once the page is isolated.

### Deployment

`.github/workflows/pages.yml`: checkout; pinned nightly and stable Rust with the
wasm target; the `wasm-bindgen` CLI at `=0.2.130`; Node (version pinned, matching
the local image); `npm ci`; both wasm builds; `astro build`; upload and deploy via
the official Pages actions. Triggers: `workflow_dispatch` only until all three
plans are merged (so nothing publishes early), then also push to `trunk`. Pull
requests build without deploying. One manual step for the repository owner:
Settings, Pages, Source = GitHub Actions.

## Plans

Three plans, built in order, each ending in a working, tested increment:

- **C1, site shell and prose:** the lite/threads split in the wrapper crate,
  `site.config.mjs`, the content collection and remark plugin (with unit tests),
  layout and theming, chapter and home pages, the chapter navigator, videos, the
  Pages workflow (dispatch-only), `node.sh` mounting `docs/`.
- **C2, step-through:** `partition_plan` and `env_info` (native tests), the custom
  element and its placement in chapters 1 to 4, browser gate for it.
- **C3, playground:** `run_level`, the worker and protocol, the page, the
  isolation state machine with single-threaded fallback, browser gates for the
  threaded path and the fallback path; then turn on the push trigger.

## Testing

- Core and wrapper: native `cargo test` (plan JSON shape and validation, level 4
  tile shape in `run_level`, `InlineRunner` equals `StdRunner` on all levels); the
  lite build must compile on stable.
- Prose plugin: `node --test` unit tests in Docker (hidden lines, heading demotion,
  link rewriting for each kind, unknown link fails the build).
- Build: `astro build` must pass; a check that no built page contains `crate::`.
- Browser gates, scripted and headless like stage B: the step-through renders the
  plan from the real wasm (`level 1, 10 rows, 4 threads` gives blocks `0..3, 3..6,
  6..9, 9..10`); the playground reports "same answer" for all levels at a small
  `n` in threaded mode, and in the fallback mode with service workers disabled in
  the throwaway profile. A build check (`web/site/check-dist.mjs`) fails if any
  chapter page references the service worker.
- Manual: a visual pass in light and dark themes and at phone width.

## Risks and open items

- **Service worker scope**: a service worker only adds the isolation headers to
  responses inside its scope, and Astro serves the worker script and wasm from
  `/_astro/`, so a worker scoped to a playground folder does not work (found in
  C1: the worker script is blocked). The scope is the whole site; chapters stay
  free of reloads because they never load the registering script. A visitor who has
  used the playground will have the service worker controlling chapter pages too,
  which is harmless (no third-party embeds).
- **Astro caches rendered docs** in `node_modules/.astro` keyed by the Markdown, not
  by the plugin, so `npm run build` clears it first.
- **Real GitHub Pages** (HTTPS, CDN caching, service worker updates) is untested
  until the first deploy; the playground's fallback covers a failure.
- **Astro 7 is new**: pin exact versions of `astro` and `@astrojs/markdown-remark`;
  the legacy `markdown.remarkPlugins` key is deprecated, use `unified(...)`.
- **Browsers**: only Firefox 159 has been exercised. Chromium on CI is a follow-up.
- **simd128** is not enabled; level 3 is scalar in the browser. A later experiment.
- Timings above `n = 1024` and the largest `n` per level under the 1 GiB cap are
  unmeasured; the UI stops at 1024.

## Out of scope for the first release

- The guide, architecture and runner pages (dead links and stale numbering; they
  return when fixed) and published rustdoc API links.
- Re-rendered animations for levels 2 to 4, and the file-backed (`FileMatrix`)
  demo.
- Search, analytics, comments, localisation.
- Running the browser gates in CI.
