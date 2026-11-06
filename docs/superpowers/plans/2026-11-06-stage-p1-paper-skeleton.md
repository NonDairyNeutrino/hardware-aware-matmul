# Stage P1: The Paper Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A` or `git add .`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Give the site the front of a scientific paper's structure: an **abstract** as the landing page, the **introduction** on its own page, and the five level chapters grouped as the **methods** in the navigation, with the output checker and `CLAUDE.md` updated. Publishable on its own (no empty sections: results, discussion and conclusion appear later, in P2 and P3).

**Architecture:** `site.config.mjs` gives each page a `section`; the layout groups consecutive pages of a section into one navigation entry (a labelled group when there are several, a plain link when there is one). The abstract is a new Markdown page, `docs/paper/abstract.md`, rendered by the existing prose pipeline through a content-collection glob that gains exactly `paper/*.md`. The landing page is headed by the site title with the abstract under it. No new dependencies.

**Tech Stack:** Astro 7.4.7 (existing), the remark plugin (existing, unchanged), Node from the `node:latest` Docker image.

**Spec:** `docs/superpowers/specs/2026-11-06-paper-structure-design.md` (plan P1 of P1 to P3).

## Global Constraints

- `docs/` is the single source of truth for prose: pages are rendered, never copied. The content collection pattern list is explicit (`introduction.md`, `levels/*.md`, `paper/*.md`); never `docs/**` (that tree also holds `docs/superpowers/`).
- `docs/paper/` is not included in rustdoc: do not `include_str!` it anywhere, and do not touch `src/`.
- The core crate `naive_matmul` is not modified; the wrapper crate is not touched.
- The page routes of the level chapters do not change. The abstract is the home page (`/`); the introduction moves to `/introduction/`.
- No benchmark numbers anywhere in the prose (the results come in P2, as generated data).
- Chapters with a demo still load only the step-through script, and chapters never load the service worker (the existing checker enforces both; do not weaken it).
- Node runs only in Docker (`web/dev/node.sh`). No new npm packages.
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- Docker with the `node:latest` image (do not pull anything; if docker tries to, stop and report BLOCKED). Firefox 159 for the optional screenshots (only kill processes you started, by PID; never `pkill -f`).
- The site build imports generated wasm modules and one data file, all gitignored build outputs that should already exist: `web/wasm/pkg-lite/`, `web/wasm/pkg/` and `web/site/public/expected.json`. If `npm run build` fails because they are missing: `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"; (cd web/wasm && ./build-lite.sh && FEATURES=threads ./build.sh); (cd web/wasm && mkdir -p ../site/public && cargo run --release --example expected 2>/dev/null > ../site/public/expected.json)`.
- Before any browser step check nothing listens on the port you use (`ss -ltnp | grep PORT`); an earlier stray server made gates fail with "page never reported".

## Verified beforehand

The code in this plan was built and run end to end on this machine before the plan was written (the Astro build, the output checker with a negative control, screenshots at desktop and phone width), and the whole sequence was replayed against a fresh copy of the repository with the final files compared byte for byte. If a step's result differs from what it states, stop and report BLOCKED with the output.

---

### Task 1: The abstract is the landing page and the introduction moves to `/introduction/`

The home page was the Introduction. It becomes the **abstract**, a new Markdown page, `docs/paper/abstract.md` (about 150 words, qualitative: it makes no claim about measurements, which do not exist yet), rendered by the existing prose pipeline: the content collection's pattern list gains exactly `paper/*.md`, and `site.config.mjs` lists the abstract first (route `''`) and gives the Introduction its own route, `introduction/`. The landing page is headed by the site title, with the abstract's own heading (demoted by the pipeline to a second-level heading) under it; every other page is headed by its own title.

**Files:**
- Create: `docs/paper/abstract.md`
- Modify: `web/site/src/content.config.ts`, `web/site/site.config.mjs`, `web/site/src/layouts/Page.astro`

**Interfaces:**
- Produces: the page id `paper/abstract` (route `''`), the Introduction at route `introduction/`; `Page.astro` shows the site title as the `<h1>` on the home page only.

- [ ] **Step 1: Write the abstract**


Create `docs/paper/abstract.md`:

````markdown
# Abstract

Dense matrix multiplication is the standard example of code whose speed depends far
more on how it is written than on what it computes. This project implements the same
`f64` product five ways in safe, dependency-free Rust, each level changing one idea:
the textbook triple loop; splitting the output rows across threads; reordering the
loops and blocking for the cache; keeping a block of the output in vector registers;
and streaming tiles of the matrices through small buffers so that they need not fit in
memory at all. Every level returns bit-for-bit identical results, so any difference in
speed comes only from how the work is organised. Each level is explained as a method,
with an interactive diagram, driven by the real code compiled to WebAssembly, that
shows how the level divides the work.
````


- [ ] **Step 2: Let the content collection see `docs/paper/`**

In `web/site/src/content.config.ts`, replace:

````text
import { glob } from 'astro/loaders';

// Only the chapters; never docs/** (that tree also holds docs/superpowers/).
// `../../docs` is web/site/../../docs on the host and /work/site/../../docs = /docs
// in the Node container (web/dev/node.sh mounts docs/ there, read-only).
const chapters = defineCollection({
  loader: glob({ pattern: ['introduction.md', 'levels/*.md'], base: '../../docs' }),
});
````

with:

````text
import { glob } from 'astro/loaders';

// Only the paper's pages (the introduction, the levels, docs/paper/); never docs/** (that
// tree also holds docs/superpowers/).
// `../../docs` is web/site/../../docs on the host and /work/site/../../docs = /docs
// in the Node container (web/dev/node.sh mounts docs/ there, read-only).
const chapters = defineCollection({
  loader: glob({ pattern: ['introduction.md', 'levels/*.md', 'paper/*.md'], base: '../../docs' }),
});
````

- [ ] **Step 3: List the abstract first and move the introduction**

In `web/site/site.config.mjs`, replace:

````text
export const repoUrl = 'https://github.com/NonDairyNeutrino/matmul_levels.rs';

// Chapters rendered from docs/ (id = path under docs/, no extension), in reading order.
// `route` is relative to `base`; the introduction is the home page.
export const chapters = [
  { id: 'introduction', title: 'Introduction', route: '' },
  { id: 'levels/naive', title: 'Level 0: the naive loop', route: 'levels/naive/' },
  { id: 'levels/threaded', title: 'Level 1: threads', route: 'levels/threaded/' },
````

with:

````text
export const repoUrl = 'https://github.com/NonDairyNeutrino/matmul_levels.rs';

// The site is laid out as a paper: abstract (the home page), introduction, methods (the
// levels), and later results, discussion and conclusion. Pages rendered from docs/ (id =
// path under docs/, no extension), in reading order. `route` is relative to `base`.
export const chapters = [
  { id: 'paper/abstract', title: 'Abstract', route: '' },
  { id: 'introduction', title: 'Introduction', route: 'introduction/' },
  { id: 'levels/naive', title: 'Level 0: the naive loop', route: 'levels/naive/' },
  { id: 'levels/threaded', title: 'Level 1: threads', route: 'levels/threaded/' },
````

- [ ] **Step 4: Head the landing page with the site title**

In `web/site/src/layouts/Page.astro`, replace:

````text
const base = import.meta.env.BASE_URL;
const here = Astro.url.pathname;
const pageTitle = title === 'Introduction' ? siteTitle : `${title} · ${siteTitle}`;
---
<!doctype html>
````

with:

````text
const base = import.meta.env.BASE_URL;
const here = Astro.url.pathname;
// The landing page (the abstract) is headed by the site title; every other page by its own.
const isHome = here === base;
const pageTitle = isHome ? siteTitle : `${title} · ${siteTitle}`;
---
<!doctype html>
````

In `web/site/src/layouts/Page.astro`, replace:

````text
    <main id="content">
      <article>
        <h1>{title}</h1>
        <slot />
      </article>
````

with:

````text
    <main id="content">
      <article>
        <h1>{isHome ? siteTitle : title}</h1>
        <slot />
      </article>
````

- [ ] **Step 5: Build and check**

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|rror|page\(s\)"
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"
ls web/site/dist/introduction
grep -o '<h1[^>]*>[^<]*</h1>' web/site/dist/index.html web/site/dist/introduction/index.html
```

Expected: `9 page(s) built` (the abstract, the introduction, five levels and the two gate pages) and no error; `check-dist: PASS (9 pages)`; `web/site/dist/introduction` holds `index.html`; and the headings `<h1>Matrix multiplication, level by level</h1>` for the home page and `<h1>Introduction</h1>` for the introduction.

If the build says it cannot find `paper/abstract` (or an unresolvable link), stop and report BLOCKED with the exact message.

- [ ] **Step 6: Commit**

```bash
git add docs/paper/abstract.md web/site/src/content.config.ts web/site/site.config.mjs web/site/src/layouts/Page.astro
git commit -m "make the abstract the landing page and move the introduction to its own page"
```

---

### Task 2: Group the methods in the navigation

Each page in `chapters` gains a `section`; the layout merges consecutive pages of one section into one navigation entry. A section with one page (abstract, introduction) is a plain link; the five levels, all in `methods`, become a labelled group, **Methods**, with the levels as its links. `sectionTitles` gives the label. The previous/next links keep following the order of `chapters`. Results, discussion and conclusion will join the list when they exist.

**Files:**
- Modify: `web/site/site.config.mjs`, `web/site/src/layouts/Page.astro`, `web/site/src/styles/site.css`

**Interfaces:**
- Produces: `chapters[].section`, `sectionTitles` (exported from `site.config.mjs`); in the HTML, `<li class="group"><span class="group-label">Methods</span><ul>…</ul></li>` inside the `Chapters` navigation.

- [ ] **Step 1: Add the sections to the configuration**


In `web/site/site.config.mjs`, replace:

````text
// levels), and later results, discussion and conclusion. Pages rendered from docs/ (id =
// path under docs/, no extension), in reading order. `route` is relative to `base`.
export const chapters = [
  { id: 'paper/abstract', title: 'Abstract', route: '' },
  { id: 'introduction', title: 'Introduction', route: 'introduction/' },
  { id: 'levels/naive', title: 'Level 0: the naive loop', route: 'levels/naive/' },
  { id: 'levels/threaded', title: 'Level 1: threads', route: 'levels/threaded/' },
  { id: 'levels/cache_friendly', title: 'Level 2: cache blocking', route: 'levels/cache_friendly/' },
  { id: 'levels/simd', title: 'Level 3: registers and SIMD', route: 'levels/simd/' },
  { id: 'levels/streaming', title: 'Level 4: streaming', route: 'levels/streaming/' },
];

// Every intra-doc link target in the chapters must be listed (without the "crate::"
````

with:

````text
// levels), and later results, discussion and conclusion. Pages rendered from docs/ (id =
// path under docs/, no extension), in reading order. `route` is relative to `base`.
// `section` groups pages in the navigation: a section with several pages is shown as a
// labelled group (see `sectionTitles`), a section with one page as a plain link.
export const chapters = [
  { id: 'paper/abstract', title: 'Abstract', route: '', section: 'abstract' },
  { id: 'introduction', title: 'Introduction', route: 'introduction/', section: 'introduction' },
  { id: 'levels/naive', title: 'Level 0: the naive loop', route: 'levels/naive/', section: 'methods' },
  { id: 'levels/threaded', title: 'Level 1: threads', route: 'levels/threaded/', section: 'methods' },
  { id: 'levels/cache_friendly', title: 'Level 2: cache blocking', route: 'levels/cache_friendly/', section: 'methods' },
  { id: 'levels/simd', title: 'Level 3: registers and SIMD', route: 'levels/simd/', section: 'methods' },
  { id: 'levels/streaming', title: 'Level 4: streaming', route: 'levels/streaming/', section: 'methods' },
];

// Labels for the sections that group several pages.
export const sectionTitles = { methods: 'Methods' };

// Every intra-doc link target in the chapters must be listed (without the "crate::"
````

- [ ] **Step 2: Render grouped entries in the layout**

In `web/site/src/layouts/Page.astro`, replace:

````text
import '../styles/site.css';
import StepThroughLoader from '../components/StepThroughLoader.astro';
import { chapters, repoUrl, siteTitle } from '../../site.config.mjs';

interface Props {
````

with:

````text
import '../styles/site.css';
import StepThroughLoader from '../components/StepThroughLoader.astro';
import { chapters, repoUrl, sectionTitles, siteTitle } from '../../site.config.mjs';

interface Props {
````

In `web/site/src/layouts/Page.astro`, replace:

````text
const isHome = here === base;
const pageTitle = isHome ? siteTitle : `${title} · ${siteTitle}`;
---
<!doctype html>
````

with:

````text
const isHome = here === base;
const pageTitle = isHome ? siteTitle : `${title} · ${siteTitle}`;
// Consecutive pages of one section form one navigation entry.
const entries = chapters.reduce((groups, chapter) => {
  const last = groups[groups.length - 1];
  if (last && last.section === chapter.section) last.items.push(chapter);
  else groups.push({ section: chapter.section, items: [chapter] });
  return groups;
}, [] as { section: string; items: typeof chapters }[]);
---
<!doctype html>
````

In `web/site/src/layouts/Page.astro`, replace:

````text
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
````

with:

````text
      <nav aria-label="Chapters">
        <ul>
          {entries.map((entry) =>
            entry.items.length === 1 ? (
              <li>
                <a href={base + entry.items[0].route} aria-current={here === base + entry.items[0].route ? 'page' : undefined}>
                  {entry.items[0].title}
                </a>
              </li>
            ) : (
              <li class="group">
                <span class="group-label">{sectionTitles[entry.section] ?? entry.section}</span>
                <ul>
                  {entry.items.map((chapter) => (
                    <li>
                      <a href={base + chapter.route} aria-current={here === base + chapter.route ? 'page' : undefined}>
                        {chapter.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      </nav>
````

- [ ] **Step 3: Style the group**

In `web/site/src/styles/site.css`, replace:

````text
.site-header nav a { color: var(--muted); text-decoration: none; padding-block: 0.25rem; }
.site-header nav a:hover, .site-header nav a[aria-current='page'] { color: var(--fg); text-decoration: underline; }

main { padding-block: 2rem 3rem; }
````

with:

````text
.site-header nav a { color: var(--muted); text-decoration: none; padding-block: 0.25rem; }
.site-header nav a:hover, .site-header nav a[aria-current='page'] { color: var(--fg); text-decoration: underline; }
.site-header nav li.group { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.75rem; }
.site-header nav .group-label { color: var(--fg); font-weight: 600; }
.site-header nav li.group ul { margin: 0; }

main { padding-block: 2rem 3rem; }
````

- [ ] **Step 4: Build and check**

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|rror|page\(s\)"
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"
grep -o '<li class="group"><span class="group-label">[^<]*</span>' web/site/dist/index.html web/site/dist/levels/simd/index.html
grep -c 'aria-current="page"' web/site/dist/levels/simd/index.html
```

Expected: `9 page(s) built`, `check-dist: PASS (9 pages)`, the group label `Methods` printed once for each of the two files, and `1` (exactly one current-page link on the page).

- [ ] **Step 5: Look at it (not gated, but do it)**

Serve `web/site/dist` under `/matmul_levels.rs/` and screenshot the home page at a desktop and a phone width, then read the PNGs:

```bash
REPO=$PWD; SC=$(mktemp -d); ln -s "$REPO/web/site/dist" "$SC/matmul_levels.rs"
ss -ltnp | grep 8871 && echo "port busy: stop"
cd "$SC"; NO_ISOLATION=1 REPORT=/dev/null python3 -I "$REPO/web/dev/serve.py" 8871 > /dev/null 2>&1 & SRV=$!; cd "$REPO"
sleep 1; PROFILE=$(mktemp -d)
timeout 90 firefox --headless --no-remote --profile "$PROFILE" --screenshot "$SC/home.png" --window-size=1000,900 http://127.0.0.1:8871/matmul_levels.rs/
timeout 90 firefox --headless --no-remote --profile "$PROFILE" --screenshot "$SC/phone.png" --window-size=390,900 http://127.0.0.1:8871/matmul_levels.rs/
kill $SRV; rm -rf "$PROFILE"; ss -ltnp | grep 8871 || echo "port free"
```

Check: the site title as the heading, then the Abstract heading and text; the navigation shows `Abstract`, `Introduction` and a bold `Methods` label with the five levels beside or under it, wrapping cleanly on the phone width; the current page is underlined; nothing overflows. The last command must print `port free`; if the port is still held, kill the python PID you started. Report anything that looks wrong; do not change the design. Delete `$SC` afterwards.

- [ ] **Step 6: Commit**

```bash
git add web/site/site.config.mjs web/site/src/layouts/Page.astro web/site/src/styles/site.css
git commit -m "group the methods in the navigation"
```

---

### Task 3: Check the landing page's heading and abstract

`check-dist.mjs` already requires exactly one `<h1>` per page. It now also requires the landing page's `<h1>` to be the site title and the abstract (a second-level heading `Abstract`) to be present, so a configuration change that quietly turns the landing page into something else fails the build gate.

**Files:**
- Modify: `web/site/check-dist.mjs`

- [ ] **Step 1: Apply the edits**


In `web/site/check-dist.mjs`, replace:

````text
//     any script at all;
//   - an unlinked intra-doc shortcut left as literal "[code]" text;
//   - a video the pages reference that was not copied into dist/media/.
// Run it with `npm run check` after `npm run build`. Exits 1 on any problem.
````

with:

````text
//     any script at all;
//   - an unlinked intra-doc shortcut left as literal "[code]" text;
//   - a landing page that is not headed by the site title with the abstract under it;
//   - a video the pages reference that was not copied into dist/media/.
// Run it with `npm run check` after `npm run build`. Exits 1 on any problem.
````

In `web/site/check-dist.mjs`, replace:

````text
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, chapters, demos } from './site.config.mjs';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
````

with:

````text
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, chapters, demos, siteTitle } from './site.config.mjs';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
````

In `web/site/check-dist.mjs`, replace:

````text
  const h1 = (html.match(/<h1[ >]/g) ?? []).length;
  if (h1 !== 1) problems.push(`${chapter.route || '(home)'}: ${h1} <h1> elements, expected 1`);
  const where = chapter.route || '(home)';
  if (html.includes('coi-serviceworker')) problems.push(`${where}: loads the service worker; chapters must not`);
````

with:

````text
  const h1 = (html.match(/<h1[ >]/g) ?? []).length;
  if (h1 !== 1) problems.push(`${chapter.route || '(home)'}: ${h1} <h1> elements, expected 1`);
  if (chapter.route === '') {
    const heading = /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1];
    if (heading !== siteTitle) problems.push(`(home): the <h1> is ${JSON.stringify(heading)}, expected the site title`);
    if (!/<h2[^>]*>Abstract<\/h2>/.test(html)) problems.push('(home): the abstract is missing');
  }
  const where = chapter.route || '(home)';
  if (html.includes('coi-serviceworker')) problems.push(`${where}: loads the service worker; chapters must not`);
````

- [ ] **Step 2: Check it passes on the real build**

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|page\(s\)"
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"      # check-dist: PASS (9 pages)
```

- [ ] **Step 3: Negative controls**

Edit only the **built output**, one at a time, and restore it (copy `dist` aside first, inside your scratchpad, and copy it back after each):

```bash
# 1. remove the abstract heading
sed -i 's|<h2 id="abstract">Abstract</h2>||' web/site/dist/index.html
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"
#    expect: check-dist: FAIL and the line  - (home): the abstract is missing
# 2. make the landing page's heading something else
sed -i 's|<h1>Matrix multiplication, level by level</h1>|<h1>Introduction</h1>|' web/site/dist/index.html
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"
#    expect: check-dist: FAIL and a line ending  expected the site title
```

After restoring `dist` the check must print `check-dist: PASS (9 pages)` again.

- [ ] **Step 4: Commit**

```bash
git add web/site/check-dist.mjs
git commit -m "check the landing page's heading and abstract"
```

---

### Task 4: Describe the paper structure in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Apply the edits**


In `CLAUDE.md`, replace:

````text
## What this is

A teaching-oriented Rust crate (`naive_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `matmul_levels.rs`; the crate name is `naive_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). It renders the chapters from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch and on pull requests (no push trigger until the playground lands); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

with:

````text
## What this is

A teaching-oriented Rust crate (`naive_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `matmul_levels.rs`; the crate name is `naive_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). The site is laid out as a paper: abstract (`docs/paper/abstract.md`, the landing page), introduction, methods (the levels), and later results, discussion and conclusion (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`); `chapters` and `sectionTitles` in `site.config.mjs` give the order and the navigation groups. It renders those pages from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch and on pull requests (no push trigger until the playground lands); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

In `CLAUDE.md`, replace:

````text

- Trunk branch is `trunk`; `Cargo.lock` is gitignored.
- `docs/superpowers/` holds specs, plans and findings for the website work. It is not product documentation (excluded from the package), so don't glob `docs/**`. Astro caches rendered docs in `web/site/node_modules/.astro` keyed by the Markdown, not by the plugin, so `npm run build` clears it first (a plugin change would otherwise be silently ignored). Nightly and wasm dependencies live only in `web/wasm`; the core crate stays dependency-free, `forbid(unsafe_code)` and MSRV 1.73.
````

with:

````text

- Trunk branch is `trunk`; `Cargo.lock` is gitignored.
- `docs/paper/` holds the paper's own pages (abstract and, later, results, discussion, conclusion); the site renders them but rustdoc does not include them. `docs/superpowers/` holds specs, plans and findings for the website work. It is not product documentation (excluded from the package), so don't glob `docs/**`. Astro caches rendered docs in `web/site/node_modules/.astro` keyed by the Markdown, not by the plugin, so `npm run build` clears it first (a plugin change would otherwise be silently ignored). Nightly and wasm dependencies live only in `web/wasm`; the core crate stays dependency-free, `forbid(unsafe_code)` and MSRV 1.73.
````

- [ ] **Step 2: Verify**

```bash
grep -n "docs/paper\|paper-structure-design\|sectionTitles" CLAUDE.md | cut -c1-120
```

Expected: at least two lines (the "What this is" paragraph and the Notes).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "describe the paper structure in CLAUDE.md"
```

---

## After this plan

If every task passes, the site opens on an abstract, the introduction is its own page, and the five levels are grouped as the Methods, with the checker guarding the landing page. It is publishable as it stands: run the `Pages` workflow from `trunk` (and decide the repository name before that, because the site address is built from it). Next: **P2**, the reference-run script and `results.json`, the number placeholders in the prose plugin, the Results page and the playground.
