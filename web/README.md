# The website

The site at <https://www.natchap.me/hardware-aware-matmul/> presents the crate as a
paper and lets readers run the benchmark on their own machine. `web/` is excluded
from the published crate. Commands for building, testing and deploying are in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md). This file explains how the pieces work.

## Layout

| Directory | What it is |
|-----------|------------|
| `web/wasm` | A separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in `rust-toolchain.toml`) that wraps the levels for WebAssembly. |
| `web/dev` | Stdlib-only tooling: a dev server, a headless-Firefox page runner, the gate report checker, the results assembler, the reference run, and `node.sh`. |
| `web/site` | The Astro site. Node runs only in Docker, through `web/dev/node.sh`. |

### `web/wasm`

It has two builds. The threaded build uses a rayon-backed `RayonRunner` and needs
the pinned nightly. Without the `threads` feature it is a stable, single-threaded
`InlineRunner` build, the "lite" build. Both enable `+simd128`, so level 3
vectorises in the browser.

The bench API (`bench_prepare`, `bench_multiply`, `bench_hash`, over `cases::Bench`)
times the multiplication alone.

## The paper

The site is laid out as a paper: abstract (the landing page), introduction,
methods (the levels), results, discussion and conclusion. The design is in
`docs/superpowers/specs/2026-11-06-paper-structure-design.md`.

- `chapters` and `sectionTitles` in `web/site/site.config.mjs` give the page
  order and the navigation groups.
- The site renders its pages from `docs/`. The remark plugin in
  `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links
  through the table in `site.config.mjs`. A link that is not in the table fails
  the build.
- The glossary plugin, `remark-glossary.mjs`, reads the `# Terms used in the chapters`
  table in `docs/paper/primer.md`; that heading and the two-column `term | definition`
  row format are load-bearing, and a missing table fails the build. A new primer
  term must be marked on some chapter or be listed in `unmarked` in
  `remark-glossary.test.mjs`. `levelStory` in `site.config.mjs` is plain text inserted
  unescaped, so it holds no numbers, `{{`, or `&<>`. Under `astro dev` a primer edit
  needs a restart, because the terms are read once in `astro.config.mjs`.
- `docs/paper/` holds the paper's own pages. The site renders them but rustdoc
  does not. The site's Introduction is `docs/paper/introduction.md`.
  `docs/introduction.md` is the crate's rustdoc front page and is not rendered on
  the site.
- Astro caches rendered docs in `web/site/node_modules/.astro`, keyed by the
  Markdown and not by the plugin. `npm run build` clears the cache first, because
  a plugin change would otherwise be silently ignored.

## Results

The Results page is generated from `web/site/src/data/results.json` by
`web/site/src/results/` (the lookup and the renderers). That file is written only
by the reference run (see CONTRIBUTING).

Prose cites numbers only through `{{metric subject selectors}}` placeholders, which the remark plugin
resolves. A placeholder that does not resolve fails the build. Examples:

- `{{ms simd n=1024 native}}` is a level's time.
- `{{env cpu}}` is the environment. Also `{{env l1d|l2|l3|triad_max|peak_max}}`.
- `{{triad t=N}}` is the hardware probe's memory bandwidth in GB/s.
- `{{peak t=N}}` is the rate of an arithmetic test loop in GFLOP/s.
- `{{frac LEVEL ...}}` is a level's native throughput as a share of that rate.

The full grammar is the header comment of `web/site/src/results/lookup.mjs`.
Times print through `formatMs`: whole milliseconds below 10 s, and seconds with
one decimal from 10 s.

A placeholder keeps a number current but does not keep a sentence true.
`web/site/src/results/claims.test.mjs` checks each ranking and margin the prose
states in words against the committed `results.json`. After a new reference run, a
failure there means the run flipped the claim: reword the prose and the test, never
the data.

`environment.hardware` (the hardware probe), `environment.caches` (read from
Linux sysfs) and `environment.counters` (hardware event counts from
`web/dev/perf_counters.py`, passed to `results.py` with `--counters`) are optional in
`results.json`. Older files lack them and still validate.

## The step-through

A `<step-through>` custom element (`web/site/src/components/`) is placed by the
`demos` list in `site.config.mjs` in the chapters for levels 1, 2, 3 and 5 (level 4 has a
static pack figure instead). It draws the real work
partition from the wrapper's `partition_plan` and `env_info` on the lite module, so
chapters need no threads and no service worker. Its pure model and figures
(`step-model.mjs`, `cache-figure.mjs`, `register-figure.mjs`, `reuse-figure.mjs`)
are unit-tested.

## The playground

`/playground/` lets readers run the benchmark on their own machine. It lives in
`web/site/src/playground/`:

| File | Role |
|------|------|
| `request.mjs` | Clamps every request and sets the time budget. |
| `summary.mjs` | Summarises a run. |
| `isolation.mjs` | Decides threaded or lite. |
| `batching.mjs` | Times short runs on a coarse clock. |
| `controller.mjs` | The worker protocol, with cancel and timeout by terminating the worker. A start timeout covers the time before the worker's `ready`, and the run's budget counts from `ready`. A threaded start that fails or hangs reruns once on the lite build. |
| `worker.js` | Owns the wasm module. |
| `ui.js`, `main.js` | The page. |
| `gate.js` | The gates' driver. Built only when `GATE=1`, through the `__GATE_BUILD__` define in `astro.config.mjs`, so production does not ship it. |

The `.mjs` modules are pure and unit-tested.

### The service worker

The playground is the ONLY reading page that registers the service worker (one
reload, to enable threads). That is why it is an `extraPages` entry and not a
chapter.

- The scope is `playground/` alone. The script is served from
  `playground/coi-serviceworker.js`. The real root copy ships only in `GATE=1`
  builds, for the G3 page and the C3 migrate scenario.
- Vite writes every worker and its wasm under `playground/_worker/`
  (`vite.worker.rolldownOptions` in `astro.config.mjs`). A worker script is
  matched to a service worker by its own URL and needs the isolation headers too.
- The chapters are not controlled by the current deploy.

**Kill-switch.** Earlier versions registered the service worker at the site root,
so returning visitors' browsers may still hold that registration, and it keeps
controlling the chapters until its next update check. Production therefore serves
a kill-switch at the root `coi-serviceworker.js`
(`src/playground/kill-switch-sw.js`, copied there by `prebuild` unless
`GATE=1`). It adds no headers, unregisters itself, and reloads each page it
controlled, once. Keep it a few months after the move, then delete it and its
check.

`main.js` does not wait for the kill-switch. It unregisters the root registration
and, if the old worker controls the playground (whose workers would then get no
headers, so neither build could start), reloads once, guarded by a
`sessionStorage` flag, before it registers its own.

## Gate pages and `check-dist`

The gate pages (`web/site/src/gate-pages/`) are the stage B gate at `/gate/`, the
step-through gate at `/gate/step-through/`, and the migrate scenario page. They
are built only when `GATE=1`, which the gate scripts set and `node.sh` passes into
the container, so the production build never contains them.

`npm run check` (`web/site/check-dist.mjs`) checks the built site. It fails if:

- **Any page** contains `crate::` (an unrewritten intra-doc link), a rustdoc-hidden
  line (`Ok::<`), or an unlinked intra-doc shortcut shown as literal `[code]`; or it
  references a video that is not in `dist/media/`.
- **A chapter** is missing, does not have exactly one `<h1>`, or loads or registers the
  service worker (directly, or through any script it loads); or its step-through demos
  differ from `demos` in `site.config.mjs`; or it has a demo but loads no script, or has
  none and loads one.
- **The landing page** is not headed by the site title and subtitle with the abstract
  under them.
- **A paper page** (abstract, results, discussion, conclusion) has an unresolved `{{`
  placeholder, or `NaN`, `undefined`, `Infinity` or `null` where a number should be.
  The Results page must also have exactly the tables and charts that `site.config.mjs`
  inserts, and link to the playground.
- **The playground page** is missing, has no script, or its scripts never load the
  service worker. It is the one reading page that may.
- **The service worker** is missing from `playground/`, or a worker script sits outside
  `playground/` (`playground/_worker/` must exist). Its scope is `playground/`, and a
  worker is given the isolation headers only inside it.
- **The root `coi-serviceworker.js`** is not the kill-switch in a production build, or not
  the real copy in a `GATE=1` build.
- **A production build** contains the gate pages or the playground's gate driver, or a
  `GATE=1` build lacks the gate pages.

The C3 gate (`gate-c3.sh`) checks `sw_scopes`. Its migrate scenario plays a
returning visitor, with the old root service worker registered first. The page must
leave it and run threaded. Its other scenarios are threaded after the service
worker enables isolation, the lite fallback with service workers disabled
(`FIREFOX_PREFS` in `web/dev/run_page.sh`), cancel and timeout recovery, and the
move to lite when the threaded worker fails to start.
