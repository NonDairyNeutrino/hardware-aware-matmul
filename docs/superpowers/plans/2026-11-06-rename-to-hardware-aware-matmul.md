# Rename to `hardware-aware-matmul` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A` or `git add .`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Rename the project so its name says what it is about: using the hardware well (threads, cache, vector registers, memory), with matrix multiplication as the worked example rather than the subject. The repository and crate become `hardware-aware-matmul` / `hardware_aware_matmul`; the wasm wrapper package becomes `hardware_aware_matmul_web`; the site is served at `/hardware-aware-matmul/` and titled **Mechanical sympathy** ("Five levels of matrix multiplication in Rust").

**Architecture:** Three mechanical commits, each leaving the repository green: (1) the crate, with its direct users (docs, tests, README, the wrapper's `use` lines); (2) the wasm wrapper's package name and everything that loads its generated files; (3) the site's address, title and package name. The only manual step, renaming the repository on GitHub and redeploying, is described at the end and is **not** part of any task.

**Tech Stack:** Rust (stable, `1.73` for the MSRV build, the pinned `nightly-2025-11-15` for `web/wasm`), `wasm-bindgen` `=0.2.130`, Astro 7.4.7, Node from the `node:latest` Docker image, headless Firefox.

**Context:** The naming discussion and decisions are in the conversation that produced this plan; the paper-structure spec (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`) is unaffected, and the P1 plan is regenerated after this rename.

## Global Constraints

- **Exact rename rules.** `naive_matmul` as a whole word (regex `\bnaive_matmul\b`) becomes `hardware_aware_matmul`; `naive_matmul_web` becomes `hardware_aware_matmul_web`; `matmul_levels.rs` becomes `hardware-aware-matmul`; `matmul-levels-site` becomes `hardware-aware-matmul-site`. The word boundary matters: `naive_matmul_parallel` and `naive_matmul_parallel_cache` are the names of Manim scenes, and the directories `naive_matmul`, `naive_matmul_parallel` and `naive_matmul_parallel_cache` under `anim/` are generated Manim output that the site build copies videos from. **Nothing under `anim/` is renamed, and the video paths in `web/site/package.json`'s `prebuild` script are not touched.**
- **History stays as written.** `docs/superpowers/` (earlier specs, plans and findings) keeps the old names; it is a record of what was true then. Do not edit it.
- The module `naive` (level 0) keeps its name: it really is the naive loop. Only the crate name changes.
- No behaviour change anywhere: the same tests pass with the same counts, and the bit-for-bit invariant is untouched.
- MSRV 1.73, no new dependencies, `#![forbid(unsafe_code)]`, `wasm-bindgen` stays `=0.2.130`.
- Node runs only in Docker (`web/dev/node.sh`).
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- Rust: stable, `1.73` (for the MSRV build), `nightly-2025-11-15` with `rust-src` and the `wasm32-unknown-unknown` target; the `wasm-bindgen` CLI at `$HOME/.cargo/bin/wasm-bindgen`. In every shell that builds or runs gates: `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`.
- Docker with the `node:latest` image (do not pull anything). Firefox 159 for the headless gates. Gates run one at a time on port 8765: **before any gate check that nothing listens there** (`ss -ltnp | grep 8765`); an earlier stray server made gates fail with "page never reported". Kill only processes you started, by PID (never `pkill -f`).
- Wasm builds take 30 to 60 seconds cold; give shell commands generous timeouts (up to 600000 ms).

---

### Task 1: Rename the crate to `hardware_aware_matmul`

The crate's package name, library name and every `use naive_matmul::...` in the sources, tests, doc examples, README and the wasm wrapper's own `use` lines. One `sed` over an explicit list of files does the renaming; the crate description is then rewritten by hand to say what the project is about. The wrapper's *package* name (`naive_matmul_web`) is Task 2 and is deliberately not matched here.

**Files:**
- Modify: `Cargo.toml`, `README.md`, `CLAUDE.md`, everything under `src/`, `tests/` and `docs/` except `docs/superpowers/`, and in `web/wasm`: `Cargo.toml`, `Cargo.lock`, `src/*.rs`, `examples/expected.rs`

**Interfaces:**
- Produces: the library is `hardware_aware_matmul` (`use hardware_aware_matmul::{naive, threaded, ...}`); the module names (`naive`, `threaded`, `cache_friendly`, `simd`, `streaming`) are unchanged. The wrapper still builds: it depends on the crate by path under the new name.

- [ ] **Step 1: Record the baseline**

From the repository root:

```bash
cargo test 2>&1 | grep "test result"        # note the counts (they must be identical after the rename)
cargo doc --no-deps 2>&1 | grep -c "^warning" || true     # baseline warning count (here: 0)
git grep -n -E "\bnaive_matmul\b" -- . ':!docs/superpowers' ':!anim' ':!web/site/package.json' ':!web/wasm/Cargo.lock' ':!Cargo.lock' | wc -l   # 86 lines to change
```

- [ ] **Step 2: Rename**

```bash
git grep -l -E "\bnaive_matmul\b" -- Cargo.toml README.md CLAUDE.md docs src tests web/wasm/Cargo.toml web/wasm/Cargo.lock web/wasm/src web/wasm/examples ':!docs/superpowers' \
  | xargs sed -i -E 's/\bnaive_matmul\b/hardware_aware_matmul/g'
```

Check what it touched and that nothing it should leave alone changed:

```bash
git status --short | head -60
git diff --stat | tail -1
git grep -n -E "\bnaive_matmul\b" -- . ':!docs/superpowers' ':!anim' ':!web/site/package.json' ':!Cargo.lock' || echo "no crate-name references left"
git grep -n "naive_matmul_web" | wc -l     # unchanged: Task 2 handles these
git diff --stat -- anim web/site/package.json | wc -l    # 0 lines: nothing there changed
```

Expected: `no crate-name references left`, and nothing under `anim/` or in `web/site/package.json` changed.

- [ ] **Step 3: Say what the crate is about**


In `Cargo.toml`, replace:

````text
description = "Streaming, multithreaded, cache-friendly dense matrix multiplication"
````

with:

````text
description = "Dense matrix multiplication as a worked example of using the hardware well: threads, cache, SIMD and streaming"
````

- [ ] **Step 4: Verify**

```bash
cargo build 2>&1 | tail -1                      # Finished ...
cargo test 2>&1 | grep "test result"            # the same counts as the baseline, all "0 failed"
cargo doc --no-deps 2>&1 | grep -c "^warning" || true     # the baseline count (0)
cargo +1.73 build 2>&1 | tail -1                # the MSRV build: Finished ...
```

Then the wasm wrapper, which depends on the renamed crate (from `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`; this also updates the tracked `Cargo.lock`):

```bash
cargo test 2>&1 | grep -E "^(warning|error)|test result" | head -3        # 15 passed, no warnings
cargo test --features threads 2>&1 | grep "test result" | head -1         # 17 passed
cargo +stable build --release --target wasm32-unknown-unknown --target-dir target-lite 2>&1 | grep -E "^(warning|error)|Finished"   # Finished, no warnings
```

If any count differs from the baseline, stop and report BLOCKED with the output: a rename must not change behaviour.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml README.md CLAUDE.md docs src tests web/wasm/Cargo.toml web/wasm/Cargo.lock web/wasm/src web/wasm/examples
git commit -m "rename the crate to hardware_aware_matmul"
```

(`git add docs` stages only what changed; `docs/superpowers/` is untouched.)

---

### Task 2: Rename the wasm wrapper package to `hardware_aware_matmul_web`

`wasm-bindgen` names its generated files after the wrapper's package (`naive_matmul_web.js`, `naive_matmul_web_bg.wasm`), so the new name reaches the build scripts, the gate scripts, the workers and the site's loader. One `sed` over the files that mention it.

**Files:**
- Modify (the files `git grep -l naive_matmul_web` lists, 16 of them): `web/wasm/Cargo.toml`, `web/wasm/Cargo.lock`, `web/wasm/build.sh`, `web/wasm/build-lite.sh`, `web/wasm/gate.sh`, `web/wasm/examples/expected.rs`, `web/wasm/www/limits-worker.js`, `web/wasm/www/lite-worker.js`, `web/wasm/www/worker.js`, `web/site/gate-c2.sh`, `web/site/gate-g3.sh`, `web/site/src/components/wasm-lite.js`

**Interfaces:**
- Produces: the wrapper is `hardware_aware_matmul_web` (the generated modules are `pkg/hardware_aware_matmul_web.js` and `pkg-lite/hardware_aware_matmul_web.js`); the `partition_plan`/`env_info`/`run_case` exports are unchanged.

- [ ] **Step 1: Rename**

```bash
git grep -l "naive_matmul_web" | xargs sed -i 's/naive_matmul_web/hardware_aware_matmul_web/g'
git grep -n "naive_matmul_web" || echo "no wrapper-name references left"
git status --short
```

Expected: `no wrapper-name references left`, and exactly the twelve files above modified. Generated `pkg/` and `pkg-lite/` are ignored build output: delete them so nothing stale (with the old file names) is picked up: `rm -rf web/wasm/pkg web/wasm/pkg-lite`.

- [ ] **Step 2: Build everything and run the gates**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"` and port 8765 free:

```bash
cargo test 2>&1 | grep "test result" | head -1                 # 15 passed
./gate.sh lite 2>&1 | grep -E "GATE|isolated"                  # "isolated": false, GATE LITE: PASS
./gate.sh g2 2>&1 | grep GATE                                  # builds the threaded module, then GATE G2: PASS
./gate.sh probe --no-build 2>&1 | grep GATE                    # GATE PROBE: PASS
```

From `web/site`:

```bash
./gate-c2.sh 2>&1 | grep -E "page\(s\)|check-dist|GATE|FAIL|REFUS"     # 8 page(s) built, check-dist: PASS (8 pages), GATE STEPTHROUGH: PASS
./gate-g3.sh --no-build 2>&1 | grep -E "GATE|FAIL|REFUS"               # GATE G3: PASS
```

Then `(cd web/wasm && ./build.sh)` so the plain gates work again. If a gate fails with "the page never reported", first check for a stray server on 8765 (`ss -ltnp | grep 8765`) before suspecting the code; do not weaken a gate.

- [ ] **Step 3: Commit**

```bash
git add web/wasm/Cargo.toml web/wasm/Cargo.lock web/wasm/build.sh web/wasm/build-lite.sh web/wasm/gate.sh web/wasm/examples/expected.rs web/wasm/www/limits-worker.js web/wasm/www/lite-worker.js web/wasm/www/worker.js web/site/gate-c2.sh web/site/gate-g3.sh web/site/src/components/wasm-lite.js
git commit -m "rename the wasm wrapper package to hardware_aware_matmul_web"
```

---

### Task 3: Serve the site at `/hardware-aware-matmul/` and title it "Mechanical sympathy"

The site's address is built from the repository name, so the base path, the gate scripts' URLs and directory names, the report checker's expectations, the repository link and the site's package name all follow. The site title becomes **Mechanical sympathy**, with the subtitle "Five levels of matrix multiplication in Rust" shown in the browser title of the home page; the subtitle is a new `siteSubtitle` export.

**Files:**
- Modify: `web/site/site.config.mjs`, `web/site/src/layouts/Page.astro`, `web/site/package.json`, `web/site/package-lock.json`, `web/site/gate-c2.sh`, `web/site/gate-g3.sh`, `web/dev/check_report.py`, `CLAUDE.md`

**Interfaces:**
- Produces: `base = '/hardware-aware-matmul/'`, `repoUrl = 'https://github.com/NonDairyNeutrino/hardware-aware-matmul'`, `siteTitle`, `siteSubtitle` (all exported from `site.config.mjs`).

- [ ] **Step 1: Rename the address, the repository link and the package**

```bash
git grep -l "matmul_levels\.rs\|matmul-levels-site" -- . ':!docs/superpowers' \
  | xargs sed -i -e 's/matmul_levels\.rs/hardware-aware-matmul/g' -e 's/matmul-levels-site/hardware-aware-matmul-site/g'
git grep -n "matmul_levels\|matmul-levels" -- . ':!docs/superpowers' || echo "no old-name references left"
git status --short
```

Expected: `no old-name references left`, and the files above modified except `web/site/src/layouts/Page.astro`, which changes in Step 2.

- [ ] **Step 2: Title the site**


In `web/site/site.config.mjs`, replace:

````text
export const siteTitle = 'Matrix multiplication, level by level';
````

with:

````text
export const siteTitle = 'Mechanical sympathy';
export const siteSubtitle = 'Five levels of matrix multiplication in Rust';
````

In `web/site/src/layouts/Page.astro`, replace:

````text
import { chapters, repoUrl, siteTitle } from '../../site.config.mjs';
````

with:

````text
import { chapters, repoUrl, siteSubtitle, siteTitle } from '../../site.config.mjs';
````

In `web/site/src/layouts/Page.astro`, replace:

````text
const pageTitle = title === 'Introduction' ? siteTitle : `${title} · ${siteTitle}`;
````

with:

````text
const pageTitle = title === 'Introduction' ? `${siteTitle}: ${siteSubtitle}` : `${title} · ${siteTitle}`;
````

- [ ] **Step 3: Build, check and run the gates**

From the repository root:

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|rror|page\(s\)"        # 8 page(s) built
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"               # check-dist: PASS (8 pages)
ls web/site/dist/media                                                           # NaiveMatMul.mp4 ParallelNaiveMatMul.mp4 (the anim/ paths were not renamed)
grep -o '<title>[^<]*</title>' web/site/dist/index.html web/site/dist/levels/simd/index.html
```

Expected titles: `Mechanical sympathy: Five levels of matrix multiplication in Rust` for the home page and `Level 3: registers and SIMD · Mechanical sympathy` for a chapter.

With port 8765 free (`ss -ltnp | grep 8765`), from `web/site` with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"` (Task 2 ended by rebuilding the plain module, so the first gate does a full build, which leaves the bundler module in place for the second):

```bash
./gate-c2.sh 2>&1 | grep -E "page\(s\)|GATE|FAIL|REFUS"        # 8 page(s) built, GATE STEPTHROUGH: PASS
./gate-g3.sh --no-build 2>&1 | grep -E "GATE|FAIL|REFUS"       # GATE G3: PASS
```

Both now serve and check the site under `/hardware-aware-matmul/`. Afterwards run `(cd ../wasm && ./build.sh)` so the plain gates work again.

- [ ] **Step 4: Commit**

```bash
git add web/site/site.config.mjs web/site/src/layouts/Page.astro web/site/package.json web/site/package-lock.json web/site/gate-c2.sh web/site/gate-g3.sh web/dev/check_report.py CLAUDE.md
git commit -m "serve the site at /hardware-aware-matmul/ and title it Mechanical sympathy"
```

---

## After this plan: renaming the repository on GitHub (manual, not a task)

The code is renamed; the repository and the live site still use the old name until you do this. Do it **after** merging, in this order:

1. **Rename the repository** (Settings, General, Repository name, or `gh repo rename hardware-aware-matmul`). GitHub redirects old git URLs, but **not** Pages: `…/matmul_levels.rs/` will stop working and the site will be served at `…/hardware-aware-matmul/` once redeployed.
2. **Update the local checkout's remote** if you use one by name: `git remote set-url origin git@github.com:NonDairyNeutrino/hardware-aware-matmul.git` (the redirect keeps the old one working for a while). The local directory name does not matter.
3. **Redeploy** the site: run the `Pages` workflow from `trunk` (Actions tab, or `gh workflow run pages.yml --ref trunk`), then open `https://www.natchap.me/hardware-aware-matmul/` (the custom domain keeps serving project sites under the repository name).
4. If anything linked to the old address, update it; nothing in this repository does.
5. Optionally rename the local directory, and tell me, because the memory notes mention the old path.

Next: regenerate the P1 plan (the paper skeleton) against the renamed `trunk`, with the abstract rewritten to say that the arithmetic never changes and the gains come only from how the hardware is used.
