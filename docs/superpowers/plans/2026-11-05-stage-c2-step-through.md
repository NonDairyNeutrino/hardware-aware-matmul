# Stage C2: The Step-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A` or `git add .`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Add the interactive step-through to chapters 1 to 4: a `<step-through>` element that draws how each level splits the output matrix between threads (or tiles), using the real Rust plan functions compiled to WebAssembly, with a browser gate that proves it, plus the hardening and housekeeping deferred from C1.

**Architecture:** The wrapper crate gets two new functions available in both builds, `partition_plan` (JSON from the core crate's own `row_block_plan` and `tile_plan`) and `env_info` (ISA and micro-tile). A pure JavaScript model (`step-model.mjs`, unit-tested with `node --test`) turns a plan into what is drawn; a vanilla custom element draws it as SVG on the **lite** (stable, single-threaded) module, so chapters need no threads, no isolation and no service worker. Chapters get the element through the existing `insertions` mechanism, driven by a new `demos` list. A new gate page and `gate-c2.sh` run the production build in headless Firefox without isolation and compare what was drawn with what the core crate's documented examples say.

**Tech Stack:** Rust (stable for the lite build, the pinned `nightly-2025-11-15` for the threaded one), `wasm-bindgen` `=0.2.130`; Astro 7.4.7; a vanilla JavaScript custom element (no new dependencies); Node from the `node:latest` Docker image; headless Firefox; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-stage-c-site-design.md` (plan C2 of C1 to C3).

## Global Constraints

- The core crate `naive_matmul` is not modified: it stays dependency-free, `#![forbid(unsafe_code)]`, MSRV 1.73. Everything here lives under `web/`, `.github/` and `CLAUDE.md`.
- The partition shown must be exactly what the levels run: `partition_plan` calls the core crate's `row_block_plan` and `tile_plan`, never a reimplementation.
- `web/wasm` keeps its empty `[workspace]` table and tracked `Cargo.lock`; `wasm-bindgen` stays pinned `=0.2.130`; the wrapper adds no dependencies (the JSON is written by hand).
- Chapters never load the service worker, directly or through any script they load, and a chapter without a demo loads no script at all. The step-through uses the lite build so it needs neither threads nor isolation.
- `docs/` is rendered, never edited. Demos are placed by `site.config.mjs`, never by markup in the Markdown.
- The wasm module never panics on page input: `partition_plan` validates every argument and returns an error (the threaded build is `panic=abort`).
- Node runs only in Docker (`web/dev/node.sh`). No new npm packages.
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- Rust: `nightly-2025-11-15` (with `rust-src` and the `wasm32-unknown-unknown` target), stable (also with the wasm target) and `1.73`; the `wasm-bindgen` CLI 0.2.130 at `$HOME/.cargo/bin/wasm-bindgen`. In every shell that builds or runs gates: `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`.
- Docker with the `node:latest` image (do not pull anything; if docker tries to, stop and report BLOCKED). Firefox 159 for the headless gates (only kill processes whose command line contains `--headless`, never other Firefox). Gates run one at a time (port 8765). Do not use `pkill -f` (it can match your own shell); kill by PID.
- A cold wasm build takes 30 to 60 seconds; give shell commands a generous timeout (600000 ms).
- The site build needs three generated inputs: `web/wasm/pkg-lite/` (`./build-lite.sh`), `web/wasm/pkg/` (`FEATURES=threads ./build.sh`) and `web/site/public/expected.json` (`cd web/wasm && cargo run --release --example expected > ../site/public/expected.json`). `gate-c2.sh` and `gate-g3.sh` produce all three.

## Verified beforehand

The code in this plan was built and run end to end on this machine before the plan was written (native tests, both wasm builds, the new browser gate and its negative controls, the production build and the hardened checker with its negative controls, screenshots of the chapters), and the whole sequence was replayed against a fresh copy of the repository with the final files compared byte for byte. If a step's result differs from what it states, stop and report BLOCKED with the output.

---

### Task 1: `partition_plan` and `env_info` in the wasm wrapper

The step-through must draw what the levels really run, so the wrapper exposes the core crate's own plans as JSON: `partition_plan` (row blocks for levels 0 to 3 from `row_block_plan`, output tiles in claim order for level 4 from `tile_plan`) and `env_info` (the vector ISA and micro-tile shape from `simd`, and whether this is the threaded build). Both are in the lite and the threaded builds. Sizes are display sizes and every argument is validated, because the threaded build is `panic=abort`. The JSON is written by hand: no new dependency. The expected values in the tests are the examples from the core crate's own documentation.

**Files:**
- Create: `web/wasm/src/plan.rs`
- Modify: `web/wasm/src/lib.rs`

**Interfaces:**
- Produces (Rust): `naive_matmul_web::plan::{partition_plan_json, env_info_json, MAX_DIM, MAX_THREADS}`.
- Produces (wasm exports, both builds): `partition_plan(level, rows, inner, cols, threads, tile_rows, tile_cols, tile_depth) -> Result<String, JsError>` and `env_info() -> String`. Row plans are `{"kind":"rows","blocks":[[start,end],...]}`; level 4 is `{"kind":"tiles","tiles":[{"rows":[a,b],"cols":[a,b]},...],"depth":[[a,b],...],"workers":w}`; `env_info` is `{"isa":"SSE2","micro_tile":[4,4],"threads":false}`.
- Changes: `cargo test` in `web/wasm` runs 14 tests by default; `cargo test --features threads` runs 16.

- [ ] **Step 1: Create the module with its tests**


Create `web/wasm/src/plan.rs`:

````rust
//! The work partition each level would use, as JSON for the step-through demo.
//!
//! These functions call the core crate's own plan functions (`row_block_plan`,
//! `tile_plan`), so what the page draws is exactly what the levels run. Sizes are
//! display sizes: the page asks about a few rows and columns, never a real
//! multiplication, so every argument is validated and bounded here and an error is
//! returned instead of a panic (the threaded build is `panic=abort`).

use std::num::NonZeroUsize;

use naive_matmul::simd::{micro_tile_shape, target_vector_isa};
use naive_matmul::streaming::{tile_plan, StreamConfig};
use naive_matmul::threaded::row_block_plan;

/// The largest `rows`, `inner`, `cols` and tile edge accepted, so the JSON stays small.
pub const MAX_DIM: usize = 64;
/// The most threads (jobs) accepted.
pub const MAX_THREADS: usize = 8;

fn bounded(name: &str, value: usize, max: usize) -> Result<usize, String> {
    if (1..=max).contains(&value) {
        Ok(value)
    } else {
        Err(format!("{name} must be in 1..={max}, got {value}"))
    }
}

fn ranges(ranges: impl Iterator<Item = std::ops::Range<usize>>) -> String {
    let items: Vec<String> = ranges.map(|r| format!("[{},{}]", r.start, r.end)).collect();
    format!("[{}]", items.join(","))
}

/// The partition of an `rows × inner` by `inner × cols` product at `level` (0 to 4).
///
/// Levels 0 to 3 give `{"kind":"rows","blocks":[[start,end],...]}` from
/// [`row_block_plan`] (level 0 is one block, whatever `threads` is). Level 4 gives
/// `{"kind":"tiles","tiles":[{"rows":[a,b],"cols":[a,b]},...],"depth":[[a,b],...],
/// "workers":w}` from [`tile_plan`] with the given tile shape; the tile arguments
/// are ignored by the other levels.
#[allow(clippy::too_many_arguments)]
pub fn partition_plan_json(
    level: u32,
    rows: usize,
    inner: usize,
    cols: usize,
    threads: usize,
    tile_rows: usize,
    tile_cols: usize,
    tile_depth: usize,
) -> Result<String, String> {
    let rows = bounded("rows", rows, MAX_DIM)?;
    let inner = bounded("inner", inner, MAX_DIM)?;
    let cols = bounded("cols", cols, MAX_DIM)?;
    let threads = bounded("threads", threads, MAX_THREADS)?;
    let workers = NonZeroUsize::new(threads).expect("bounded to at least 1");
    match level {
        0 => Ok(format!("{{\"kind\":\"rows\",\"blocks\":[[0,{rows}]]}}")),
        1..=3 => {
            let blocks = ranges(row_block_plan(rows, workers).into_iter());
            Ok(format!("{{\"kind\":\"rows\",\"blocks\":{blocks}}}"))
        }
        4 => {
            let tile_rows = bounded("tile_rows", tile_rows, MAX_DIM)?;
            let tile_cols = bounded("tile_cols", tile_cols, MAX_DIM)?;
            let tile_depth = bounded("tile_depth", tile_depth, MAX_DIM)?;
            let config = StreamConfig::new(workers).with_tile_shape(tile_rows, tile_cols, tile_depth);
            let plan = tile_plan(rows, inner, cols, &config);
            let tiles: Vec<String> = plan
                .tiles
                .iter()
                .map(|t| {
                    format!(
                        "{{\"rows\":[{},{}],\"cols\":[{},{}]}}",
                        t.rows.start, t.rows.end, t.cols.start, t.cols.end
                    )
                })
                .collect();
            let depth = ranges(plan.depth_slices.into_iter());
            Ok(format!(
                "{{\"kind\":\"tiles\",\"tiles\":[{}],\"depth\":{depth},\"workers\":{threads}}}",
                tiles.join(",")
            ))
        }
        other => Err(format!("level must be 0 to 4, got {other}")),
    }
}

/// What this build is: `{"isa":"SSE2","micro_tile":[4,4],"threads":false}`.
///
/// `isa` and `micro_tile` come from the core crate for the target the module was
/// compiled for; `threads` is whether this is the threaded build.
pub fn env_info_json() -> String {
    let (mr, nr) = micro_tile_shape();
    format!(
        "{{\"isa\":\"{}\",\"micro_tile\":[{mr},{nr}],\"threads\":{}}}",
        target_vector_isa(),
        cfg!(feature = "threads")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_one_splits_ten_rows_over_four_threads() {
        // The example from `row_block_plan`'s own documentation.
        assert_eq!(
            partition_plan_json(1, 10, 6, 6, 4, 1, 1, 1).unwrap(),
            r#"{"kind":"rows","blocks":[[0,3],[3,6],[6,9],[9,10]]}"#
        );
    }

    #[test]
    fn levels_two_and_three_use_the_same_row_blocks() {
        let one = partition_plan_json(1, 10, 6, 6, 4, 1, 1, 1).unwrap();
        assert_eq!(partition_plan_json(2, 10, 6, 6, 4, 1, 1, 1).unwrap(), one);
        assert_eq!(partition_plan_json(3, 10, 6, 6, 4, 1, 1, 1).unwrap(), one);
    }

    #[test]
    fn level_zero_is_one_block_whatever_the_threads() {
        assert_eq!(
            partition_plan_json(0, 10, 6, 6, 8, 1, 1, 1).unwrap(),
            r#"{"kind":"rows","blocks":[[0,10]]}"#
        );
    }

    #[test]
    fn more_threads_than_rows_gives_one_row_per_block() {
        assert_eq!(
            partition_plan_json(1, 3, 4, 4, 8, 1, 1, 1).unwrap(),
            r#"{"kind":"rows","blocks":[[0,1],[1,2],[2,3]]}"#
        );
    }

    #[test]
    fn level_four_lists_tiles_in_claim_order_and_depth_slices() {
        // The example from `tile_plan`'s documentation: a 2 x 2 grid of 2 x 3 tiles.
        assert_eq!(
            partition_plan_json(4, 4, 6, 6, 2, 2, 3, 4).unwrap(),
            concat!(
                r#"{"kind":"tiles","tiles":["#,
                r#"{"rows":[0,2],"cols":[0,3]},{"rows":[0,2],"cols":[3,6]},"#,
                r#"{"rows":[2,4],"cols":[0,3]},{"rows":[2,4],"cols":[3,6]}],"#,
                r#""depth":[[0,4],[4,6]],"workers":2}"#
            )
        );
    }

    #[test]
    fn level_four_clips_the_edge_tiles() {
        let json = partition_plan_json(4, 5, 4, 5, 1, 4, 4, 4).unwrap();
        assert!(json.contains(r#"{"rows":[4,5],"cols":[4,5]}"#), "{json}");
    }

    #[test]
    fn bad_arguments_are_errors_not_panics() {
        for (args, needle) in [
            ((5, 4, 4, 4, 1, 1, 1, 1), "level must be 0 to 4"),
            ((1, 0, 4, 4, 1, 1, 1, 1), "rows must be in 1..=64"),
            ((1, 4, 65, 4, 1, 1, 1, 1), "inner must be in 1..=64"),
            ((1, 4, 4, 0, 1, 1, 1, 1), "cols must be in 1..=64"),
            ((1, 4, 4, 4, 0, 1, 1, 1), "threads must be in 1..=8"),
            ((1, 4, 4, 4, 9, 1, 1, 1), "threads must be in 1..=8"),
            ((4, 4, 4, 4, 1, 0, 1, 1), "tile_rows must be in 1..=64"),
            ((4, 4, 4, 4, 1, 1, 0, 1), "tile_cols must be in 1..=64"),
            ((4, 4, 4, 4, 1, 1, 1, 65), "tile_depth must be in 1..=64"),
        ] {
            let (l, r, i, c, t, tr, tc, td) = args;
            let err = partition_plan_json(l, r, i, c, t, tr, tc, td).unwrap_err();
            assert!(err.contains(needle), "{args:?}: {err}");
        }
    }

    #[test]
    fn the_other_levels_ignore_the_tile_arguments() {
        // Zero tile arguments are fine for levels 0 to 3.
        assert!(partition_plan_json(2, 4, 4, 4, 2, 0, 0, 0).is_ok());
    }

    #[test]
    fn env_info_matches_the_core_crate() {
        let (mr, nr) = micro_tile_shape();
        let json = env_info_json();
        assert!(json.contains(&format!("\"isa\":\"{}\"", target_vector_isa())), "{json}");
        assert!(json.contains(&format!("\"micro_tile\":[{mr},{nr}]")), "{json}");
        assert!(json.ends_with(&format!("\"threads\":{}}}", cfg!(feature = "threads"))), "{json}");
    }
}
````


- [ ] **Step 2: Declare the module and export the two functions**

In `web/wasm/src/lib.rs`, replace:

````text

pub mod cases;

use naive_matmul::runner::{Runner, StdRunner};
````

with:

````text

pub mod cases;
pub mod plan;

use naive_matmul::runner::{Runner, StdRunner};
````

In `web/wasm/src/lib.rs`, replace:

````text
) -> Result<String, JsError> {
    cases::run_hash(level, n, threads, tile_k, tile_j, &RayonRunner).map_err(|e| JsError::new(&e))
}
````

with:

````text
) -> Result<String, JsError> {
    cases::run_hash(level, n, threads, tile_k, tile_j, &RayonRunner).map_err(|e| JsError::new(&e))
}

/// The partition of a small product at `level` (0 to 4), as JSON: row blocks for
/// levels 0 to 3, output tiles in claim order for level 4. See [`plan`].
///
/// Display sizes only: `rows`, `inner`, `cols` and the tile edges are at most 64
/// and `threads` at most 8. Bad arguments return an error.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn partition_plan(
    level: u32,
    rows: usize,
    inner: usize,
    cols: usize,
    threads: usize,
    tile_rows: usize,
    tile_cols: usize,
    tile_depth: usize,
) -> Result<String, JsError> {
    plan::partition_plan_json(level, rows, inner, cols, threads, tile_rows, tile_cols, tile_depth)
        .map_err(|e| JsError::new(&e))
}

/// The build's vector instruction set, micro-tile shape and whether it has threads,
/// as JSON.
#[wasm_bindgen]
pub fn env_info() -> String {
    plan::env_info_json()
}
````

- [ ] **Step 3: Run the tests and the builds**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
cargo test 2>&1 | grep -E "^(warning|error)|test result"
# expect: test result: ok. 14 passed (then 0 doc tests), no warnings
cargo test --features threads 2>&1 | grep -E "^(warning|error)|test result"
# expect: test result: ok. 16 passed, no warnings
cargo +stable build --release --target wasm32-unknown-unknown --target-dir target-lite 2>&1 | grep -E "^(warning|error)|Finished"
# expect: Finished ... and nothing else (the lite build compiles on stable with the new exports)
./gate.sh lite 2>&1 | grep -E "GATE|isolated"
# expect: "isolated": false and GATE LITE: PASS (the existing 29 cases are unaffected)
```

- [ ] **Step 4: Commit**

```bash
git add web/wasm/src/plan.rs web/wasm/src/lib.rs
git commit -m "add partition_plan and env_info to the wasm wrapper"
```

---

### Task 2: The step-through's model, with tests

The element's rules live in a pure module with no DOM and no WebAssembly, so `node --test` can check them: which thread owns each row, how many steps a plan takes (a thread works through its rows one per step, all threads at once; a tiles plan takes one step per tile in claim order), which rows are done after a given step, the claim number of each cell, level 2's cache blocks over `B`, level 3's micro-tile lines, and the caption. The test inputs are the plans from the core crate's own examples.

**Files:**
- Create: `web/site/src/components/step-model.test.mjs`, `web/site/src/components/step-model.mjs`
- Modify: `web/site/package.json`

**Interfaces:**
- Produces (`step-model.mjs`): `OWNER_COUNT`, `parsePlan(json)`, `rowOwners(plan, rows)`, `stepCount(plan)`, `rowDone(plan, row, step)`, `tileOfCell(plan, rows, cols)`, `ownerColour(n)`, `cacheBlocks(inner, cols, tileK, tileJ)`, `microLines(extent, size)`, `caption(level, plan, step, total)`.

- [ ] **Step 1: Write the tests first**


Create `web/site/src/components/step-model.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OWNER_COUNT, cacheBlocks, caption, microLines, ownerColour, parsePlan, rowDone, rowOwners,
  stepCount, tileOfCell,
} from './step-model.mjs';

// The plan for level 1, 10 rows, 4 threads (from the core crate's own example).
const rows = parsePlan('{"kind":"rows","blocks":[[0,3],[3,6],[6,9],[9,10]]}');
// A 2 x 2 grid of 2 x 3 tiles over a 4 x 6 output.
const tiles = parsePlan(
  '{"kind":"tiles","tiles":[{"rows":[0,2],"cols":[0,3]},{"rows":[0,2],"cols":[3,6]},' +
    '{"rows":[2,4],"cols":[0,3]},{"rows":[2,4],"cols":[3,6]}],"depth":[[0,4],[4,6]],"workers":2}',
);

test('parsePlan rejects anything that is not a plan', () => {
  assert.throws(() => parsePlan('{"kind":"nope"}'), /unrecognised plan/);
  assert.throws(() => parsePlan('{"kind":"rows"}'), /unrecognised plan/);
});

test('rowOwners gives each row the block that computes it', () => {
  assert.deepEqual(rowOwners(rows, 10), [0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
});

test('a rows plan takes as many steps as its largest block has rows', () => {
  assert.equal(stepCount(rows), 3);
  assert.equal(stepCount(parsePlan('{"kind":"rows","blocks":[[0,10]]}')), 10);
});

test('rows finish one per step within each block, all blocks at once', () => {
  const done = (step) => [...Array(10).keys()].filter((r) => rowDone(rows, r, step));
  assert.deepEqual(done(0), []);
  assert.deepEqual(done(1), [0, 3, 6, 9]);
  assert.deepEqual(done(2), [0, 1, 3, 4, 6, 7, 9]);
  assert.deepEqual(done(3), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a tiles plan takes one step per tile', () => {
  assert.equal(stepCount(tiles), 4);
});

test('tileOfCell numbers each cell by the tile that covers it, in claim order', () => {
  assert.deepEqual(tileOfCell(tiles, 4, 6), [
    0, 0, 0, 1, 1, 1,
    0, 0, 0, 1, 1, 1,
    2, 2, 2, 3, 3, 3,
    2, 2, 2, 3, 3, 3,
  ]);
});

test('every cell of a real-shaped tiles plan is covered exactly once', () => {
  const edge = parsePlan(
    '{"kind":"tiles","tiles":[{"rows":[0,4],"cols":[0,4]},{"rows":[0,4],"cols":[4,5]},' +
      '{"rows":[4,5],"cols":[0,4]},{"rows":[4,5],"cols":[4,5]}],"depth":[[0,4]],"workers":1}',
  );
  assert.ok(!tileOfCell(edge, 5, 5).includes(-1));
});

test('owner colours wrap around the palette', () => {
  assert.equal(ownerColour(0), 0);
  assert.equal(ownerColour(OWNER_COUNT), 0);
  assert.equal(ownerColour(OWNER_COUNT + 3), 3);
});

test('cacheBlocks walks B in tile_k by tile_j pieces, clipped at the edges', () => {
  assert.deepEqual(cacheBlocks(5, 4, 3, 3), [
    { rows: [0, 3], cols: [0, 3] },
    { rows: [0, 3], cols: [3, 4] },
    { rows: [3, 5], cols: [0, 3] },
    { rows: [3, 5], cols: [3, 4] },
  ]);
});

test('microLines marks every MR-th or NR-th position inside the extent', () => {
  assert.deepEqual(microLines(10, 4), [4, 8]);
  assert.deepEqual(microLines(4, 4), []);
});

test('captions describe the plan that is drawn', () => {
  assert.match(caption(1, rows, 2, 3), /Step 2 of 3: each of the 4 threads has finished 2 rows/);
  assert.match(caption(4, tiles, 1, 4), /1 of 4 tiles done.*2 workers/);
  assert.match(caption(0, rows, 0, 3), /One thread/);
});
````


- [ ] **Step 2: Make `npm test` run the new directory too**

In `web/site/package.json`, replace:

````text
    "prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public/media && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js && cp ../../anim/media/videos/naive_matmul/480p15/NaiveMatMul.mp4 ../../anim/media/videos/naive_matmul_parallel/480p15/ParallelNaiveMatMul.mp4 public/media/",
    "build": "astro build",
    "test": "node --test src/plugins/",
    "check": "node check-dist.mjs"
  },
````

with:

````text
    "prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public/media && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js && cp ../../anim/media/videos/naive_matmul/480p15/NaiveMatMul.mp4 ../../anim/media/videos/naive_matmul_parallel/480p15/ParallelNaiveMatMul.mp4 public/media/",
    "build": "astro build",
    "test": "node --test src/plugins/ src/components/",
    "check": "node check-dist.mjs"
  },
````

- [ ] **Step 3: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module"`
Expected: `Cannot find module '/work/site/src/components/step-model.mjs'`.

- [ ] **Step 4: Write the model**


Create `web/site/src/components/step-model.mjs`:

````javascript
// What the step-through draws, as plain data, with no DOM and no WebAssembly: the
// element feeds it the JSON from `partition_plan` and draws the result. Keeping
// it separate makes the rules testable with `node --test`.

/** How many owner colours the stylesheet defines (`--owner-0` ...). */
export const OWNER_COUNT = 8;

/** Parses the `partition_plan` JSON and checks its shape. */
export function parsePlan(json) {
  const plan = typeof json === 'string' ? JSON.parse(json) : json;
  if (plan.kind === 'rows' && Array.isArray(plan.blocks)) return plan;
  if (plan.kind === 'tiles' && Array.isArray(plan.tiles) && Array.isArray(plan.depth)) return plan;
  throw new Error('unrecognised plan: ' + JSON.stringify(plan).slice(0, 80));
}

/** Rows plans: the block (and so thread) that owns each output row. */
export function rowOwners(plan, rows) {
  const owners = new Array(rows).fill(-1);
  plan.blocks.forEach(([start, end], block) => {
    for (let row = start; row < end; row += 1) owners[row] = block;
  });
  return owners;
}

/**
 * Number of steps. A thread works through its block one row per step, all
 * threads at once, so a rows plan takes as many steps as its largest block has
 * rows. A tiles plan takes one step per tile, in the order tiles are claimed.
 */
export function stepCount(plan) {
  if (plan.kind === 'rows') return Math.max(...plan.blocks.map(([a, b]) => b - a));
  return plan.tiles.length;
}

/** Rows plans: is output row `row` finished after `step` steps? */
export function rowDone(plan, row, step) {
  const block = plan.blocks.find(([a, b]) => row >= a && row < b);
  return block !== undefined && row - block[0] < step;
}

/**
 * Tiles plans: for each output cell (row-major, `rows` by `cols`), the claim
 * number of the tile that covers it. A plan from `partition_plan` covers every
 * cell exactly once.
 */
export function tileOfCell(plan, rows, cols) {
  const owners = new Array(rows * cols).fill(-1);
  plan.tiles.forEach((tile, claim) => {
    for (let r = tile.rows[0]; r < tile.rows[1]; r += 1) {
      for (let c = tile.cols[0]; c < tile.cols[1]; c += 1) owners[r * cols + c] = claim;
    }
  });
  return owners;
}

/** The colour index of the thread or worker slot `n`. */
export function ownerColour(n) {
  return ((n % OWNER_COUNT) + OWNER_COUNT) % OWNER_COUNT;
}

/**
 * Level 2's cache blocks over `B` (`inner` rows by `cols` columns): the
 * `tile_k` by `tile_j` pieces `B` is walked in, in the order the kernel visits
 * them, clipped at the edges.
 */
export function cacheBlocks(inner, cols, tileK, tileJ) {
  const blocks = [];
  for (let k = 0; k < inner; k += tileK) {
    for (let j = 0; j < cols; j += tileJ) {
      blocks.push({ rows: [k, Math.min(k + tileK, inner)], cols: [j, Math.min(j + tileJ, cols)] });
    }
  }
  return blocks;
}

/** Level 3's micro-tile grid lines over a block of `C`: positions of the lines. */
export function microLines(extent, size) {
  const lines = [];
  for (let at = size; at < extent; at += size) lines.push(at);
  return lines;
}

/** The sentence under the grid for the current step. */
export function caption(level, plan, step, total) {
  if (level === 0) return 'One thread computes every row, in order.';
  if (plan.kind === 'tiles') {
    const workers = plan.workers;
    return (
      `${step} of ${total} tiles done. Tiles are claimed in this order by whichever ` +
      `worker is free; with ${workers} worker${workers === 1 ? '' : 's'}, up to ${workers} ` +
      `tile${workers === 1 ? ' is' : 's are'} in flight at once.`
    );
  }
  const threads = plan.blocks.length;
  return (
    `Step ${step} of ${total}: each of the ${threads} thread${threads === 1 ? '' : 's'} has ` +
    `finished ${step} row${step === 1 ? '' : 's'} of its block (a block with fewer rows finishes early).`
  );
}
````

- [ ] **Step 5: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"`
Expected: `ℹ tests 23`, `ℹ pass 23`, `ℹ fail 0` (the 12 plugin tests and the 11 new ones), no `✖` lines.

- [ ] **Step 6: Commit**

```bash
git add web/site/package.json web/site/src/components/step-model.mjs web/site/src/components/step-model.test.mjs
git commit -m "add the step-through's model with tests"
```

---

### Task 3: The `<step-through>` element, placed in chapters 1 to 4

A vanilla custom element, `<step-through level="N">`, draws the output matrix `C` as an SVG grid coloured by owner, from the plan `partition_plan` returns (the real Rust code, on the **lite** module, so it works on any page: no threads, no isolation, no service worker). Controls: output rows, columns and inner size (4 to 16), threads (1 to 8) and the level's own parameters (level 2: cache block `k` and `j`; level 4: tile rows, columns and depth), Play, Step, a scrubber, and "Show the plan" with the raw JSON. Level 1 draws row blocks by thread; level 2 adds `B` with its cache blocks; level 3 adds the micro-tile grid inside each block (from `env_info`); level 4 draws tiles numbered in claim order. Nothing auto-plays.

The element reaches the pages through the existing `insertions` mechanism: a new `demos` list in `site.config.mjs` names, for each chapter, the heading the demo goes under, and the chapters in it load the script through a loader component (so a chapter without a demo loads no script). The site build now needs the lite module too, so `gate-g3.sh` builds it.

**Files:**
- Create: `web/site/src/components/wasm-lite.js`, `web/site/src/components/step-through.js`, `web/site/src/components/StepThroughLoader.astro`
- Modify: `web/site/src/styles/site.css`, `web/site/site.config.mjs`, `web/site/src/pages/[...slug].astro`, `web/site/src/layouts/Page.astro`, `web/site/gate-g3.sh`

**Interfaces:**
- Consumes: `partition_plan` and `env_info` (Task 1), `step-model.mjs` (Task 2), `web/wasm/pkg-lite/` from `./build-lite.sh`.
- Produces: the element `<step-through level="1..4" [rows cols inner threads tile-k tile-j tile-rows tile-cols tile-depth]>`; it sets `data-state` (`loading`, `ready` or `error`), `data-plan` (the plan JSON), `data-env` and `data-step`; cells are `rect[data-row][data-col][data-owner][data-done]`; `site.config.mjs` exports `demos`.

- [ ] **Step 1: Create the wasm loader and the element**


Create `web/site/src/components/wasm-lite.js`:

````javascript
// Loads the stable single-threaded build of the wrapper once per page. It has no
// thread pool, so it needs no cross-origin isolation and no service worker.
import init, { env_info, partition_plan } from '../../../wasm/pkg-lite/naive_matmul_web.js';

let ready;

/** Resolves to `{ partitionPlan, envInfo }` once the module is instantiated. */
export function loadPlans() {
  ready ??= init().then(() => ({ partitionPlan: partition_plan, envInfo: env_info }));
  return ready;
}
````

Create `web/site/src/components/step-through.js`:

````javascript
// <step-through level="1"> (levels 1 to 4) draws how a level splits the output matrix C between
// threads (or, at level 4, between tiles). The plan comes from the real Rust code
// compiled to WebAssembly (`partition_plan`), so it is exactly what the level runs.
// Optional attributes set the starting values: rows, cols, inner, threads, tile-k,
// tile-j, tile-rows, tile-cols, tile-depth.
import { loadPlans } from './wasm-lite.js';
import {
  cacheBlocks, caption, microLines, ownerColour, parsePlan, rowDone, rowOwners, stepCount,
  tileOfCell,
} from './step-model.mjs';

const CELL = 22; // pixels per matrix cell
const GUTTER = 28; // room for the thread labels

const FIELDS = {
  rows: { label: 'Output rows', min: 4, max: 16, value: 10 },
  cols: { label: 'Output columns', min: 4, max: 16, value: 8 },
  inner: { label: 'Inner size', min: 4, max: 16, value: 6 },
  threads: { label: 'Threads', min: 1, max: 8, value: 4 },
  tileK: { label: 'Cache block k', min: 1, max: 16, value: 3, attr: 'tile-k' },
  tileJ: { label: 'Cache block j', min: 1, max: 16, value: 4, attr: 'tile-j' },
  tileRows: { label: 'Tile rows', min: 1, max: 16, value: 4, attr: 'tile-rows' },
  tileCols: { label: 'Tile columns', min: 1, max: 16, value: 4, attr: 'tile-cols' },
  tileDepth: { label: 'Tile depth', min: 1, max: 16, value: 3, attr: 'tile-depth' },
};

function fieldsFor(level) {
  const keys = ['rows', 'cols', 'inner', 'threads'];
  if (level === 2) keys.push('tileK', 'tileJ');
  if (level === 4) keys.push('tileRows', 'tileCols', 'tileDepth');
  return keys;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function html(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

class StepThrough extends HTMLElement {
  connectedCallback() {
    if (this.dataset.state) return;
    this.level = Number(this.getAttribute('level'));
    this.params = {};
    for (const key of fieldsFor(this.level)) {
      const field = FIELDS[key];
      const given = Number(this.getAttribute(field.attr ?? key));
      this.params[key] = Number.isFinite(given) && given >= 1 ? given : field.value;
    }
    this.step = 0;
    this.timer = null;
    this.dataset.state = 'loading';
    this.build();
    loadPlans()
      .then((api) => {
        this.api = api;
        this.env = JSON.parse(api.envInfo());
        this.dataset.env = JSON.stringify(this.env);
        this.update();
        this.dataset.state = 'ready';
      })
      .catch((error) => {
        this.dataset.state = 'error';
        this.status.textContent = `The interactive demo could not start (${error}).`;
      });
  }

  disconnectedCallback() {
    this.pause();
  }

  build() {
    this.classList.add('step-through');
    this.controls = html('div', { class: 'st-fields' });
    for (const key of fieldsFor(this.level)) {
      const field = FIELDS[key];
      const input = html('input', { type: 'number', min: field.min, max: field.max, value: this.params[key], 'data-key': key });
      input.addEventListener('change', () => {
        const clamped = Math.min(field.max, Math.max(field.min, Math.round(Number(input.value)) || field.value));
        input.value = String(clamped);
        this.params[key] = clamped;
        this.step = 0;
        this.pause();
        this.update();
      });
      const label = html('label');
      label.append(field.label + ' ', input);
      this.controls.append(label);
    }
    this.playButton = html('button', { type: 'button', class: 'st-play' }, 'Play');
    this.playButton.addEventListener('click', () => (this.timer ? this.pause() : this.play()));
    this.stepButton = html('button', { type: 'button', class: 'st-step' }, 'Step');
    this.stepButton.addEventListener('click', () => {
      this.pause();
      this.setStep(this.step >= this.total ? 0 : this.step + 1);
    });
    this.scrub = html('input', { type: 'range', min: 0, max: 0, value: 0, 'aria-label': 'Step' });
    this.scrub.addEventListener('input', () => {
      this.pause();
      this.setStep(Number(this.scrub.value));
    });
    const bar = html('div', { class: 'st-bar' });
    bar.append(this.playButton, this.stepButton, this.scrub);
    this.figure = html('div', { class: 'st-figure' });
    this.status = html('p', { class: 'st-caption', 'aria-live': 'polite' }, 'Loading the demo…');
    this.details = html('details', { class: 'st-plan' });
    this.details.append(html('summary', {}, 'Show the plan'), (this.planText = html('pre')));
    this.replaceChildren(this.controls, bar, this.figure, this.status, this.details);
  }

  update() {
    const p = this.params;
    this.plan = parsePlan(
      this.api.partitionPlan(
        this.level, p.rows, p.inner, p.cols, p.threads,
        p.tileRows ?? 1, p.tileCols ?? 1, p.tileDepth ?? 1,
      ),
    );
    this.dataset.plan = JSON.stringify(this.plan);
    this.planText.textContent = JSON.stringify(this.plan, null, 1);
    this.total = stepCount(this.plan);
    this.step = Math.min(this.step, this.total);
    this.scrub.max = String(this.total);
    this.draw();
  }

  setStep(step) {
    this.step = Math.min(Math.max(step, 0), this.total);
    this.dataset.step = String(this.step);
    this.scrub.value = String(this.step);
    for (const cell of this.figure.querySelectorAll('rect[data-row]')) {
      cell.dataset.done = String(this.isDone(cell));
    }
    this.status.textContent = caption(this.level, this.plan, this.step, this.total);
    if (this.step >= this.total) this.pause();
  }

  isDone(cell) {
    const row = Number(cell.dataset.row);
    if (this.plan.kind === 'rows') return rowDone(this.plan, row, this.step);
    return Number(cell.dataset.claim) < this.step;
  }

  play() {
    if (this.step >= this.total) this.setStep(0);
    this.playButton.textContent = 'Pause';
    this.timer = setInterval(() => this.setStep(this.step + 1), 600);
  }

  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playButton) this.playButton.textContent = 'Play';
  }

  draw() {
    const { rows, cols, inner } = this.params;
    const width = GUTTER + cols * CELL + 2;
    const height = rows * CELL + 2;
    const canvas = svg('svg', {
      viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', class: 'st-grid',
      'aria-label': `The ${rows} by ${cols} output matrix C, coloured by which ${this.plan.kind === 'rows' ? 'thread' : 'tile'} computes each cell`,
    });
    const claim = this.plan.kind === 'tiles' ? tileOfCell(this.plan, rows, cols) : null;
    const owners = this.plan.kind === 'rows' ? rowOwners(this.plan, rows) : null;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const owner = owners ? owners[r] : claim[r * cols + c];
        const attrs = {
          x: GUTTER + c * CELL + 1, y: r * CELL + 1, width: CELL - 1, height: CELL - 1,
          class: `owner-${ownerColour(owner)}`, 'data-row': r, 'data-col': c, 'data-owner': owner,
        };
        if (claim) attrs['data-claim'] = owner;
        canvas.append(svg('rect', attrs));
      }
    }
    if (this.plan.kind === 'rows') this.labelBlocks(canvas, rows, cols);
    else this.labelTiles(canvas);
    this.figure.replaceChildren(canvas);
    if (this.level === 2) this.figure.append(this.drawB(inner, cols));
    this.setStep(this.step);
  }

  labelBlocks(canvas, rows, cols) {
    this.plan.blocks.forEach(([start, end], block) => {
      canvas.append(svg('text', { x: 2, y: start * CELL + CELL * 0.7, class: 'st-label' }, `T${block}`));
      canvas.append(svg('line', {
        x1: GUTTER, x2: GUTTER + cols * CELL, y1: start * CELL + 0.5, y2: start * CELL + 0.5, class: 'st-edge',
      }));
      if (this.level === 3) this.microGrid(canvas, start, end, cols);
    });
  }

  // Level 3: the register-blocked micro-tile inside each block, MR rows by NR columns.
  microGrid(canvas, start, end, cols) {
    const [mr, nr] = this.env.micro_tile;
    for (const at of microLines(end - start, mr)) {
      const y = (start + at) * CELL + 0.5;
      canvas.append(svg('line', { x1: GUTTER, x2: GUTTER + cols * CELL, y1: y, y2: y, class: 'st-micro' }));
    }
    for (const at of microLines(cols, nr)) {
      const x = GUTTER + at * CELL + 0.5;
      canvas.append(svg('line', { x1: x, x2: x, y1: start * CELL, y2: end * CELL, class: 'st-micro' }));
    }
  }

  labelTiles(canvas) {
    this.plan.tiles.forEach((tile, claim) => {
      canvas.append(svg('text', {
        x: GUTTER + tile.cols[0] * CELL + 3, y: tile.rows[0] * CELL + CELL * 0.7, class: 'st-label',
      }, String(claim)));
      canvas.append(svg('rect', {
        x: GUTTER + tile.cols[0] * CELL + 0.5, y: tile.rows[0] * CELL + 0.5,
        width: (tile.cols[1] - tile.cols[0]) * CELL, height: (tile.rows[1] - tile.rows[0]) * CELL, class: 'st-tile',
      }));
    });
  }

  // Level 2: the matrix B with the tile_k by tile_j cache blocks the kernel walks.
  drawB(inner, cols) {
    const blocks = cacheBlocks(inner, cols, this.params.tileK, this.params.tileJ);
    const width = cols * CELL + 2;
    const height = inner * CELL + 2;
    const canvas = svg('svg', {
      viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', class: 'st-grid st-b',
      'aria-label': `The ${inner} by ${cols} matrix B in ${blocks.length} cache blocks`,
    });
    blocks.forEach((block, index) => {
      canvas.append(svg('rect', {
        x: block.cols[0] * CELL + 1, y: block.rows[0] * CELL + 1,
        width: (block.cols[1] - block.cols[0]) * CELL - 1, height: (block.rows[1] - block.rows[0]) * CELL - 1,
        class: `owner-${ownerColour(index)} st-block`, 'data-block': index,
      }));
      canvas.append(svg('text', { x: block.cols[0] * CELL + 4, y: block.rows[0] * CELL + CELL * 0.7, class: 'st-label' }, String(index)));
    });
    const wrap = html('div', { class: 'st-b-wrap' });
    wrap.append(canvas);
    return wrap;
  }
}

if (!customElements.get('step-through')) customElements.define('step-through', StepThrough);
````

- [ ] **Step 2: Create the loader component**

Create `web/site/src/components/StepThroughLoader.astro`:

````astro
---
// Renders nothing. Rendering it on a page is what makes Astro include the
// step-through script there, so chapters without a demo do not load it.
---
<script>
  import './step-through.js';
</script>
````

- [ ] **Step 3: Add the styles**

Append to the end of `web/site/src/styles/site.css`:

````css
/* Step-through demo */
:root {
  --owner-0: hsl(210 70% 55%); --owner-1: hsl(30 85% 55%); --owner-2: hsl(140 55% 42%);
  --owner-3: hsl(330 65% 58%); --owner-4: hsl(265 55% 62%); --owner-5: hsl(55 75% 48%);
  --owner-6: hsl(185 65% 42%); --owner-7: hsl(0 70% 58%);
}
.owner-0 { fill: var(--owner-0); }
.owner-1 { fill: var(--owner-1); }
.owner-2 { fill: var(--owner-2); }
.owner-3 { fill: var(--owner-3); }
.owner-4 { fill: var(--owner-4); }
.owner-5 { fill: var(--owner-5); }
.owner-6 { fill: var(--owner-6); }
.owner-7 { fill: var(--owner-7); }
step-through { display: block; margin: 1.5rem 0; padding: 1rem; border: 1px solid var(--border); border-radius: 6px; }
.st-fields { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin-bottom: 0.75rem; }
.st-fields label { font-size: 0.9rem; }
.st-fields input { width: 4rem; }
.st-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
.st-bar input[type='range'] { flex: 1; min-width: 6rem; }
.st-figure { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: flex-start; overflow-x: auto; }
.st-grid { max-width: 100%; height: auto; }
.st-grid rect[data-row] { opacity: 0.2; }
.st-grid rect[data-done='true'] { opacity: 1; }
.st-block { opacity: 0.55; }
.st-label { font-size: 10px; fill: var(--fg); }
.st-edge { stroke: var(--fg); stroke-width: 1; }
.st-micro { stroke: var(--bg); stroke-width: 1; stroke-dasharray: 2 2; }
.st-tile { fill: none; stroke: var(--fg); stroke-width: 1; }
.st-caption { margin: 0.75rem 0 0; font-size: 0.9rem; }
.st-plan pre { max-height: 14rem; overflow: auto; }
@media (prefers-reduced-motion: no-preference) {
  .st-grid rect[data-row] { transition: opacity 0.2s; }
}
````

- [ ] **Step 4: Place the demos and load the script on the pages that have one**

In `web/site/site.config.mjs`, replace:

````text
  `<figcaption>${caption}</figcaption></figure>`;

// Figures and demos inserted after a heading of a chapter (by heading text).
export const insertions = [
  {
    chapter: 'levels/naive',
````

with:

````text
  `<figcaption>${caption}</figcaption></figure>`;

// Step-through demos (see src/components/step-through.js): the level they show and the
// heading of the chapter they go under. Levels 1 to 4 have one; level 0 has no plan to show.
export const demos = [
  { chapter: 'levels/threaded', afterHeading: 'What it gets right', level: 1 },
  { chapter: 'levels/cache_friendly', afterHeading: 'Change 2: cache blocking', level: 2 },
  { chapter: 'levels/simd', afterHeading: 'The micro-kernel', level: 3 },
  { chapter: 'levels/streaming', afterHeading: 'The algorithm', level: 4 },
];

// Figures and demos inserted after a heading of a chapter (by heading text).
export const insertions = [
  ...demos.map(({ chapter, afterHeading, level }) => ({
    chapter,
    afterHeading,
    html: `<step-through level="${level}"></step-through>`,
  })),
  {
    chapter: 'levels/naive',
````


In `web/site/src/pages/[...slug].astro`, replace:

````text
import { getCollection, render } from 'astro:content';
import Page from '../layouts/Page.astro';
import { chapters } from '../../site.config.mjs';

export async function getStaticPaths() {
````

with:

````text
import { getCollection, render } from 'astro:content';
import Page from '../layouts/Page.astro';
import { chapters, demos } from '../../site.config.mjs';

export async function getStaticPaths() {
````

In `web/site/src/pages/[...slug].astro`, replace:

````text
const { Content } = await render(entry);
---
<Page title={chapter.title} previous={previous} next={next}>
  <Content />
</Page>
````

with:

````text
const { Content } = await render(entry);
---
<Page title={chapter.title} previous={previous} next={next} interactive={demos.some((d) => d.chapter === chapter.id)}>
  <Content />
</Page>
````


In `web/site/src/layouts/Page.astro`, replace:

````text
---
import '../styles/site.css';
import { chapters, repoUrl, siteTitle } from '../../site.config.mjs';
````

with:

````text
---
import '../styles/site.css';
import StepThroughLoader from '../components/StepThroughLoader.astro';
import { chapters, repoUrl, siteTitle } from '../../site.config.mjs';
````

In `web/site/src/layouts/Page.astro`, replace:

````text
  previous?: { title: string; route: string } | null;
  next?: { title: string; route: string } | null;
}
const { title, previous = null, next = null } = Astro.props;
const base = import.meta.env.BASE_URL;
const here = Astro.url.pathname;
````

with:

````text
  previous?: { title: string; route: string } | null;
  next?: { title: string; route: string } | null;
  // The page has a step-through demo, so it loads the script that defines it.
  interactive?: boolean;
}
const { title, previous = null, next = null, interactive = false } = Astro.props;
const base = import.meta.env.BASE_URL;
const here = Astro.url.pathname;
````

In `web/site/src/layouts/Page.astro`, replace:

````text
      </nav>
    </main>
    <footer class="site-footer">
      <a href={repoUrl}>Source on GitHub</a>
````

with:

````text
      </nav>
    </main>
    {interactive && <StepThroughLoader />}
    <footer class="site-footer">
      <a href={repoUrl}>Source on GitHub</a>
````


In `web/site/gate-g3.sh`, replace:

````text
# its scope covers /_astro/ (the worker and wasm). Passes only if all 29 cases hash
# exactly like native Rust, the page reloaded, and the scope is /matmul_levels.rs/.
# usage: gate-g3.sh [--no-build]
# env: WASM_BINDGEN, NODE_IMAGE (default node:latest), PORT, TIMEOUT (seconds)
````

with:

````text
# its scope covers /_astro/ (the worker and wasm). Passes only if all 29 cases hash
# exactly like native Rust, the page reloaded, and the scope is /matmul_levels.rs/.
# The site build also needs the lite module (the step-through), so both are built.
# usage: gate-g3.sh [--no-build]
# env: WASM_BINDGEN, NODE_IMAGE (default node:latest), PORT, TIMEOUT (seconds)
````

In `web/site/gate-g3.sh`, replace:

````text
  fi
else
  (cd "$WASM" && FEATURES=threads ./build.sh)
fi
````

with:

````text
  fi
else
  (cd "$WASM" && ./build-lite.sh && FEATURES=threads ./build.sh)
fi
````



- [ ] **Step 5: Build both wasm modules, then the site**

From `web/wasm`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
./build-lite.sh && FEATURES=threads ./build.sh
mkdir -p ../site/public && cargo run --release --example expected 2>/dev/null > ../site/public/expected.json
```

From the repository root:

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|rror|page\(s\)"
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"
```

Expected: `7 page(s) built` and no error, then `check-dist: PASS (7 pages)`. If the build fails to resolve `pkg-lite/naive_matmul_web.js`, the lite module was not built: stop and report BLOCKED.

- [ ] **Step 6: Check which pages carry the demo and the script**

```bash
cd web/site/dist/levels && for c in threaded cache_friendly simd streaming naive; do echo "$c $(grep -c '<step-through' $c/index.html) $(grep -c 'StepThroughLoader' $c/index.html)"; done
```

Expected, exactly: `threaded 1 1`, `cache_friendly 1 1`, `simd 1 1`, `streaming 1 1`, `naive 0 0` (the chapter without a demo loads no script).

- [ ] **Step 7: Look at it (not gated, but do it)**

Screenshots must be taken after the wasm has loaded, and Firefox photographs on the page's `load` event, before that. Hold `load` open with a slow image in a **temporary copy** of the build, and look at the PNGs:

```bash
SC=$(mktemp -d); cp -a web/site/dist "$SC/matmul_levels.rs"
python3 - "$SC" <<'PYEOF'
import re, sys
for rel in ['levels/threaded', 'levels/cache_friendly', 'levels/simd', 'levels/streaming']:
    p = f'{sys.argv[1]}/matmul_levels.rs/{rel}/index.html'
    t = open(p).read()
    open(p, 'w').write(re.sub(r'(<body[^>]*>)', r'\1<img src="/slow.gif" width="1" height="1" alt="">', t, count=1))
PYEOF
cat > "$SC/slow.py" <<'PYEOF'
import http.server, os, sys, time
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/slow.gif'):
            time.sleep(4)
            self.send_response(200); self.send_header('Content-Type', 'image/gif'); self.end_headers()
            self.wfile.write(bytes.fromhex('47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b'))
        else:
            super().do_GET()
    def log_message(self, *a): pass
os.chdir(sys.argv[2]); http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PYEOF
python3 -I "$SC/slow.py" 8832 "$SC" & SRV=$!
sleep 1; PROFILE=$(mktemp -d)
timeout 120 firefox --headless --no-remote --profile "$PROFILE" --screenshot "$SC/cache.png" --window-size=900,2600 http://127.0.0.1:8832/matmul_levels.rs/levels/cache_friendly/
timeout 120 firefox --headless --no-remote --profile "$PROFILE" --screenshot "$SC/streaming.png" --window-size=900,2600 http://127.0.0.1:8832/matmul_levels.rs/levels/streaming/
kill $SRV; rm -rf "$PROFILE"
```

Read `$SC/cache.png` and `$SC/streaming.png`. Check: the grid is coloured (never black), thread labels `T0..` sit at the left of each block, level 2 shows `B` with four numbered cache blocks, level 4 shows numbered tiles with the edge tile clipped, the caption reads sensibly, and nothing overflows the column. Report anything that looks wrong; do not change the design. Delete `$SC` afterwards.

- [ ] **Step 8: Commit**

```bash
git add web/site/src/components/wasm-lite.js web/site/src/components/step-through.js web/site/src/components/StepThroughLoader.astro web/site/src/styles/site.css web/site/site.config.mjs "web/site/src/pages/[...slug].astro" web/site/src/layouts/Page.astro web/site/gate-g3.sh
git commit -m "add the step-through demo to chapters 1 to 4"
```

---

### Task 4: The step-through browser gate

`gate-c2.sh` builds both wasm modules and the site, then loads `/gate/step-through/` from the production build in headless Firefox on a page **without** isolation headers and **without** a service worker. The page mounts one element per level (fixed parameters), drives level 1 like a reader (one Step, then the scrubber to the end, then threads changed to 3) and reports the plans, what was drawn and the service worker registrations. `check_report.py stepthrough` compares them with the core crate's own documented examples: 10 rows over 4 threads is `0..3, 3..6, 6..9, 9..10`; the 2 by 2 tile grid; and so on.

**Files:**
- Create: `web/site/src/pages/gate/step-through/index.astro`, `web/site/gate-c2.sh`
- Modify: `web/dev/check_report.py`

**Interfaces:**
- Consumes: the element and its `data-*` attributes (Task 3).
- Produces: `./gate-c2.sh [--no-build]`; `check_report.py stepthrough REPORT.json`.

- [ ] **Step 1: Create the gate page and the gate script**


Create `web/site/src/pages/gate/step-through/index.astro`:

````astro
---
// Gate C2: mounts one <step-through> per level 1 to 4 with fixed parameters, drives
// the first, and reports what the real wasm plan produced and what was drawn. Like
// the chapters, it never loads the service worker.
import StepThroughLoader from '../../../components/StepThroughLoader.astro';
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>gate: step-through</title>
  </head>
  <body>
    <step-through id="l1" level="1" rows="10" cols="8" inner="6" threads="4"></step-through>
    <step-through id="l2" level="2" rows="8" cols="8" inner="6" threads="2" tile-k="3" tile-j="4"></step-through>
    <step-through id="l3" level="3" rows="8" cols="8" inner="6" threads="2"></step-through>
    <step-through id="l4" level="4" rows="8" cols="8" inner="6" threads="2" tile-rows="4" tile-cols="4" tile-depth="3"></step-through>
    <StepThroughLoader />
    <script>
      async function post(result) {
        await fetch('/report', { method: 'POST', body: JSON.stringify(result) });
      }

      const ids = ['l1', 'l2', 'l3', 'l4'];
      const base = import.meta.env.BASE_URL;

      function ready(el) {
        return new Promise((resolve, reject) => {
          const started = performance.now();
          const poll = () => {
            if (el.dataset.state === 'ready') resolve();
            else if (el.dataset.state === 'error') reject(new Error(el.id + ': ' + el.textContent));
            else if (performance.now() - started > 20000) reject(new Error(el.id + ' never became ready'));
            else setTimeout(poll, 50);
          };
          poll();
        });
      }

      const doneRows = (el) => [...new Set([...el.querySelectorAll('rect[data-row][data-done="true"]')].map((r) => Number(r.dataset.row)))];

      async function main() {
        const result = { gate: 'stepthrough', base, isolated: self.crossOriginIsolated };
        try {
          const els = ids.map((id) => document.getElementById(id));
          await Promise.all(els.map(ready));
          result.elements = els.map((el) => ({
            id: el.id,
            level: Number(el.getAttribute('level')),
            plan: JSON.parse(el.dataset.plan),
            env: JSON.parse(el.dataset.env),
            owners_by_row: [...Array(Number(el.querySelector('input[data-key="rows"]').value)).keys()]
              .map((r) => Number(el.querySelector(`rect[data-row="${r}"][data-col="0"]`).dataset.owner)),
            micro_lines: el.querySelectorAll('.st-micro').length,
            b_blocks: el.querySelectorAll('.st-block').length,
            tiles_drawn: el.querySelectorAll('.st-tile').length,
            done_at_start: doneRows(el),
          }));
          // Drive level 1 like a reader: one Step, then to the end by the scrubber.
          const l1 = els[0];
          l1.querySelector('.st-step').click();
          result.after_step = { step: l1.dataset.step, done: doneRows(l1), caption: l1.querySelector('.st-caption').textContent };
          const scrub = l1.querySelector('input[type="range"]');
          scrub.value = scrub.max;
          scrub.dispatchEvent(new Event('input'));
          result.at_end = { step: l1.dataset.step, done: doneRows(l1) };
          // Change a parameter: 3 threads over 10 rows gives blocks of 4, 4 and 2.
          const threads = l1.querySelector('input[data-key="threads"]');
          threads.value = '3';
          threads.dispatchEvent(new Event('change'));
          result.three_threads = JSON.parse(l1.dataset.plan);
          result.sw_scopes = (await navigator.serviceWorker?.getRegistrations?.() ?? []).map((r) => r.scope);
          result.ok = true;
        } catch (e) {
          result.ok = false;
          result.error = String((e && e.stack) || e);
        }
        await post(result);
      }
      main();
    </script>
  </body>
</html>
````

Create `web/site/gate-c2.sh` (then `chmod +x`):

````bash
#!/usr/bin/env bash
# Gate C2: the step-through element, from an Astro production build under
# /matmul_levels.rs/ on a page with NO isolation headers and NO service worker, in
# headless Firefox. The page at /gate/step-through/ mounts levels 1 to 4 on the lite
# wasm module, reports the plans and what was drawn; check_report.py compares them
# with what the core crate's own examples say they must be.
# usage: gate-c2.sh [--no-build]        env: WASM_BINDGEN, NODE_IMAGE, PORT, TIMEOUT
set -euo pipefail
cd "$(dirname "$0")"
SITE=$PWD
WASM=$SITE/../wasm

if [ "${1:-}" != "--no-build" ]; then
  (cd "$WASM" && ./build-lite.sh && FEATURES=threads ./build.sh)
fi

mkdir -p "$WASM/target" "$SITE/public"
if ! (cd "$WASM" && cargo run --release --example expected 2> target/expected-build.log) > "$SITE/public/expected.json"; then
  cat "$WASM/target/expected-build.log"
  echo "FAIL: could not generate the expected hashes"
  exit 1
fi

[ -d node_modules ] || ../dev/node.sh site npm ci --no-audit --no-fund
../dev/node.sh site npm run build
../dev/node.sh site npm run check

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
ln -s "$SITE/dist" "$ROOT/matmul_levels.rs"
export NO_ISOLATION=1 REPORT="$WASM/target/c2-report.json" LOG="$WASM/target/c2-server.log"
rm -f "$LOG"
../dev/run_page.sh "$ROOT" "matmul_levels.rs/gate/step-through/" "${TIMEOUT:-120}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I ../dev/check_report.py stepthrough "$REPORT"
````

- [ ] **Step 2: Teach the report checker the new gate**

In `web/dev/check_report.py`, replace:

````text
  probe  informational: records whether StdRunner works in the browser
  lite   g2's cases on the stable single-threaded build, on a page that is NOT isolated
  g5     informational: records limits (pool start-up, re-init, panic, memory)
"""
````

with:

````text
  probe  informational: records whether StdRunner works in the browser
  lite   g2's cases on the stable single-threaded build, on a page that is NOT isolated
  stepthrough  the chapters' <step-through> element on the lite build, from the Astro
         production build, with no isolation and no service worker
  g5     informational: records limits (pool start-up, re-init, panic, memory)
"""
````

In `web/dev/check_report.py`, replace:

````text
G2_CASES = 29
SPEEDUP_LEVELS = (1, 2, 3, 4)
````

with:

````text
G2_CASES = 29
SPEEDUP_LEVELS = (1, 2, 3, 4)


def rows(blocks):
    return {"kind": "rows", "blocks": blocks}


def check_stepthrough(report):
    """Compares what the step-through page drew with what the core crate's plans say."""
    problems = []
    if report.get("base") != "/matmul_levels.rs/":
        problems.append("wrong base path: %r" % report.get("base"))
    if report.get("sw_scopes") != []:
        problems.append("a service worker was registered (%r); the demo must not need one" % report.get("sw_scopes"))
    elements = {e["level"]: e for e in report.get("elements", [])}
    if sorted(elements) != [1, 2, 3, 4]:
        return problems + ["expected elements for levels 1 to 4, got %r" % sorted(elements)]
    for level, e in elements.items():
        env = e["env"]
        ok_tile = isinstance(env.get("micro_tile"), list) and len(env["micro_tile"]) == 2 and all(
            isinstance(x, int) and x > 0 for x in env["micro_tile"])
        if not (env.get("isa") and ok_tile and env.get("threads") is False):
            problems.append("level %d: bad env %r (the lite build has no threads)" % (level, env))
    one = elements[1]
    # `row_block_plan`'s own documented example: 10 rows over 4 threads.
    if one["plan"] != rows([[0, 3], [3, 6], [6, 9], [9, 10]]):
        problems.append("level 1 plan is %r" % one["plan"])
    if one["owners_by_row"] != [0, 0, 0, 1, 1, 1, 2, 2, 2, 3]:
        problems.append("level 1 row owners are %r" % one["owners_by_row"])
    if one["done_at_start"] != []:
        problems.append("level 1 started with rows already done: %r" % one["done_at_start"])
    after = report.get("after_step", {})
    if after.get("step") != "1" or after.get("done") != [0, 3, 6, 9]:
        problems.append("after one Step, expected rows 0,3,6,9 done at step 1, got %r" % after)
    if "Step 1 of 3" not in after.get("caption", ""):
        problems.append("caption after one Step is %r" % after.get("caption"))
    end = report.get("at_end", {})
    if end.get("step") != "3" or end.get("done") != list(range(10)):
        problems.append("at the end, expected every row done at step 3, got %r" % end)
    if report.get("three_threads") != rows([[0, 4], [4, 8], [8, 10]]):
        problems.append("after changing threads to 3 the plan is %r" % report.get("three_threads"))
    for level in (2, 3):
        if elements[level]["plan"] != rows([[0, 4], [4, 8]]):
            problems.append("level %d plan is %r" % (level, elements[level]["plan"]))
    # Level 2: B is 6 x 8 in 3 x 4 cache blocks.
    if elements[2]["b_blocks"] != 4:
        problems.append("level 2 drew %r cache blocks over B, expected 4" % elements[2]["b_blocks"])
    # Level 3: micro-tile lines inside two 4-row blocks of an 8-column output.
    mr, nr = elements[3]["env"]["micro_tile"]
    want = 2 * (len(range(mr, 4, mr)) + len(range(nr, 8, nr)))
    if elements[3]["micro_lines"] != want:
        problems.append("level 3 drew %r micro-tile lines, expected %d for %dx%d" % (elements[3]["micro_lines"], want, mr, nr))
    four = elements[4]
    if four["plan"].get("kind") != "tiles" or len(four["plan"].get("tiles", [])) != 4:
        problems.append("level 4 plan is %r" % four["plan"])
    elif four["plan"]["depth"] != [[0, 3], [3, 6]] or four["plan"]["workers"] != 2:
        problems.append("level 4 depth/workers are %r / %r" % (four["plan"]["depth"], four["plan"]["workers"]))
    if four["tiles_drawn"] != 4:
        problems.append("level 4 drew %r tiles" % four["tiles_drawn"])
    return problems
````

In `web/dev/check_report.py`, replace:

````text
    if not report.get("ok"):
        problems.append("page reported an error: " + str(report.get("error")))
    if gate == "lite":
        if report.get("isolated"):
            problems.append("the lite gate must run on a page that is NOT cross-origin isolated")
    elif not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if gate not in ("g5", "lite") and report.get("pool_threads") != 4:
        problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))
````

with:

````text
    if not report.get("ok"):
        problems.append("page reported an error: " + str(report.get("error")))
    if gate in ("lite", "stepthrough"):
        if report.get("isolated"):
            problems.append("the %s gate must run on a page that is NOT cross-origin isolated" % gate)
    elif not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if gate not in ("g5", "lite", "stepthrough") and report.get("pool_threads") != 4:
        problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))
````

In `web/dev/check_report.py`, replace:

````text
            problems.append("the service worker scope must be the site root /matmul_levels.rs/, got %r" % scopes)

    if gate == "g5":
        if not probes:
````

with:

````text
            problems.append("the service worker scope must be the site root /matmul_levels.rs/, got %r" % scopes)

    if gate == "stepthrough":
        problems.extend(check_stepthrough(report))

    if gate == "g5":
        if not probes:
````

- [ ] **Step 3: Run the gate**

From `web/site`, with `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"`:

```bash
./gate-c2.sh 2>&1 | grep -E "check-dist|page\(s\)|GATE|FAIL|^ - "
```

Expected: `8 page(s) built` (the seven from before and `/gate/step-through/`), `check-dist: PASS (8 pages)` and `GATE STEPTHROUGH: PASS`. The report (`web/wasm/target/c2-report.json`) shows `"isolated": false`, `"sw_scopes": []`, the level 1 plan `[[0,3],[3,6],[6,9],[9,10]]`, `owners_by_row` `[0,0,0,1,1,1,2,2,2,3]`, `after_step` `{"step":"1","done":[0,3,6,9]}` and `at_end` with all ten rows done. If it prints `the page never reported`, look in `web/wasm/target/c2-server.log`; do not weaken the gate: stop and report BLOCKED.

- [ ] **Step 4: Check that the gate can fail**

Corrupt a copy of the report four ways and confirm `check_report.py` rejects each (from the repository root, after Step 3):

```bash
python3 - <<'EOF'
import json, subprocess
r = json.load(open('web/wasm/target/c2-report.json'))
def run(mut, name):
    x = json.loads(json.dumps(r)); mut(x)
    json.dump(x, open('web/wasm/target/bad.json', 'w'))
    p = subprocess.run(['python3', '-I', 'web/dev/check_report.py', 'stepthrough', 'web/wasm/target/bad.json'], capture_output=True, text=True)
    print(name, p.returncode, 'FAIL' in p.stdout)
run(lambda x: x['elements'][0]['owners_by_row'].__setitem__(3, 0), 'owner')
run(lambda x: x.__setitem__('sw_scopes', ['http://x/']), 'sw')
run(lambda x: x['elements'][2].__setitem__('micro_lines', 0), 'micro')
run(lambda x: x['elements'][3]['plan'].__setitem__('workers', 3), 'workers')
EOF
rm web/wasm/target/bad.json
```

Expected, exactly: `owner 1 True`, `sw 1 True`, `micro 1 True`, `workers 1 True`.

- [ ] **Step 5: Check that the other gates still pass**

```bash
(cd web/site && ./gate-g3.sh --no-build 2>&1 | grep -E "GATE|check-dist|FAIL")     # GATE G3: PASS
```

(`gate-c2.sh` built the threaded module in bundler mode, which is what G3 needs, so `--no-build` is valid here.) Then `(cd web/wasm && ./build.sh)` so the plain gates work again.

- [ ] **Step 6: Commit**

```bash
git add web/site/src/pages/gate/step-through/index.astro web/site/gate-c2.sh web/dev/check_report.py
git commit -m "add the step-through browser gate"
```

---

### Task 5: Harden `check-dist` for pages that now have scripts

Until now no chapter had a script, so the checker only looked for the service worker's name in the HTML. Chapters 1 to 4 now load a script, so the checker follows every script a chapter loads (and everything those import) and fails if any refers to the service worker; it also fails if a chapter's demos differ from `site.config.mjs`, if a chapter without a demo loads any script at all, or if an unlinked intra-doc shortcut shows up as literal `[code]` text. The `dist` path now comes from `fileURLToPath` (the old `URL.pathname` breaks on paths with spaces or special characters).

**Files:**
- Modify: `web/site/check-dist.mjs`

- [ ] **Step 1: Apply the edits**


In `web/site/check-dist.mjs`, replace:

````text
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
````

with:

````text
//   - intra-doc link text ("crate::") or rustdoc-hidden lines ("Ok::<") in any page;
//   - a chapter that is missing, or that does not have exactly one <h1>;
//   - a chapter that loads the service worker, directly or through any script it
//     loads (only pages that need threads may: it forces a reload, and readers of
//     the chapters must never see one);
//   - a chapter that has a step-through demo in site.config.mjs but not in its page,
//     a page with a demo it should not have, or a chapter without a demo that loads
//     any script at all;
//   - an unlinked intra-doc shortcut left as literal "[code]" text;
//   - a video the pages reference that was not copied into dist/media/.
// Run it with `npm run check` after `npm run build`. Exits 1 on any problem.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, chapters, demos } from './site.config.mjs';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
const problems = [];
````

In `web/site/check-dist.mjs`, replace:

````text
}

for (const page of pages(dist)) {
  const html = readFileSync(page, 'utf8');
````

with:

````text
}

// The scripts a page loads (script tags and module preloads), and every script those
// import in turn, as file names under dist/. Rollup names its chunks `name-hash.js`
// and imports them by that name, so a name found in a script that exists in dist is
// an import.
function reachableScripts(html) {
  const found = new Set();
  const queue = [...html.matchAll(/(?:src|href)="[^"]*\/([\w.-]+\.js)"/g)].map((m) => m[1]);
  while (queue.length > 0) {
    const name = queue.pop();
    const file = join(dist, '_astro', name);
    if (found.has(name) || !existsSync(file)) continue;
    found.add(name);
    for (const [, next] of readFileSync(file, 'utf8').matchAll(/([\w.-]+\.js)/g)) queue.push(next);
  }
  return [...found];
}

for (const page of pages(dist)) {
  const html = readFileSync(page, 'utf8');
````

In `web/site/check-dist.mjs`, replace:

````text
  if (html.includes('crate::')) problems.push(`${name}: contains "crate::" (an unrewritten intra-doc link)`);
  if (/Ok::(&lt;|<)/.test(html)) problems.push(`${name}: contains a rustdoc-hidden line ("Ok::<")`);
  for (const [, file] of html.matchAll(new RegExp(`${base}media/([\\w.-]+)`, 'g'))) {
    if (!existsSync(join(dist, 'media', file))) problems.push(`${name}: references media/${file}, which is not in dist/media/`);
````

with:

````text
  if (html.includes('crate::')) problems.push(`${name}: contains "crate::" (an unrewritten intra-doc link)`);
  if (/Ok::(&lt;|<)/.test(html)) problems.push(`${name}: contains a rustdoc-hidden line ("Ok::<")`);
  if (/\[<code[^>]*>[^<]*<\/code>\]/.test(html)) problems.push(`${name}: contains an unlinked shortcut shown as "[code]"`);
  for (const [, file] of html.matchAll(new RegExp(`${base}media/([\\w.-]+)`, 'g'))) {
    if (!existsSync(join(dist, 'media', file))) problems.push(`${name}: references media/${file}, which is not in dist/media/`);
````

In `web/site/check-dist.mjs`, replace:

````text
  const h1 = (html.match(/<h1[ >]/g) ?? []).length;
  if (h1 !== 1) problems.push(`${chapter.route || '(home)'}: ${h1} <h1> elements, expected 1`);
  if (html.includes('coi-serviceworker')) problems.push(`${chapter.route || '(home)'}: loads the service worker; chapters must not`);
}
````

with:

````text
  const h1 = (html.match(/<h1[ >]/g) ?? []).length;
  if (h1 !== 1) problems.push(`${chapter.route || '(home)'}: ${h1} <h1> elements, expected 1`);
  const where = chapter.route || '(home)';
  if (html.includes('coi-serviceworker')) problems.push(`${where}: loads the service worker; chapters must not`);
  for (const script of reachableScripts(html)) {
    if (/serviceWorker|coi-serviceworker/i.test(readFileSync(join(dist, '_astro', script), 'utf8'))) {
      problems.push(`${where}: its script ${script} refers to the service worker; chapters must not`);
    }
  }
  const wanted = demos.filter((d) => d.chapter === chapter.id).map((d) => d.level);
  const present = [...html.matchAll(/<step-through level="(\d)"/g)].map((m) => Number(m[1]));
  if (JSON.stringify(wanted) !== JSON.stringify(present)) {
    problems.push(`${where}: step-through demos for levels [${present}], site.config.mjs says [${wanted}]`);
  }
  if (wanted.length === 0 && /<script/.test(html)) problems.push(`${where}: has no demo but loads a script`);
}
````

- [ ] **Step 2: Check it passes on the real build**

After rebuilding (`web/dev/node.sh site npm run build`; the wasm modules and `expected.json` from Task 3 are still in place):

```bash
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"      # check-dist: PASS (8 pages)
```

- [ ] **Step 3: Negative controls**

Edit only the **built output**, run the check, then restore it (rebuild, or copy `dist` aside first and copy it back). Each must print `check-dist: FAIL` with the line shown:

```bash
cp -a web/site/dist /tmp/dist-bak     # use a directory under your scratchpad if /tmp is not writable
# 1. a chapter script that refers to the service worker
f=$(ls web/site/dist/_astro/StepThroughLoader*.js); echo 'navigator.serviceWorker.register("x")' >> $f
#    expect: ... its script StepThroughLoader...js refers to the service worker; chapters must not   (once per demo chapter)
# 2. a missing demo
sed -i 's|<step-through level="4"></step-through>||' web/site/dist/levels/streaming/index.html
#    expect: levels/streaming/: step-through demos for levels [], site.config.mjs says [4]
# 3. a script on a chapter without a demo
sed -i 's|</body>|<script>1</script></body>|' web/site/dist/levels/naive/index.html
#    expect: levels/naive/: has no demo but loads a script
# 4. an unlinked shortcut
sed -i 's|</main>|<p>[<code>x</code>]</p></main>|' web/site/dist/levels/simd/index.html
#    expect: levels/simd/index.html: contains an unlinked shortcut shown as "[code]"
```

Do these **one at a time**: apply one edit, run `web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"`, restore `dist` from the backup, then the next. At the end the check must print `check-dist: PASS (8 pages)` again.

- [ ] **Step 4: Commit**

```bash
git add web/site/check-dist.mjs
git commit -m "check the scripts chapters load and the demos they carry"
```

---

### Task 6: Fix the code block background and scrollbar colour in dark mode

Two cosmetic findings from the C1 screenshots: Shiki's own code background (a slightly different shade from the page's code background) overrode the `pre` background, and the scrollbar under wide code and tables showed as a bright bar in the dark theme. Drop the Shiki background declarations so the page's `--code-bg` shows, and colour the scrollbars from the theme.

**Files:**
- Modify: `web/site/src/styles/site.css`

- [ ] **Step 1: Apply the edits**


In `web/site/src/styles/site.css`, replace:

````text
pre code { background: none; padding: 0; font: inherit; }
/* Shiki emits both themes as variables; pick by the system theme. */
.astro-code, .astro-code span { color: var(--shiki-light); background-color: var(--shiki-light-bg); }
@media (prefers-color-scheme: dark) {
  .astro-code, .astro-code span { color: var(--shiki-dark); background-color: var(--shiki-dark-bg); }
}
.astro-code { border: 1px solid var(--border); }
````

with:

````text
pre code { background: none; padding: 0; font: inherit; }
/* Shiki emits both themes as variables; pick by the system theme. */
.astro-code, .astro-code span { color: var(--shiki-light); }
@media (prefers-color-scheme: dark) {
  .astro-code, .astro-code span { color: var(--shiki-dark); }
}
.astro-code { border: 1px solid var(--border); }
````

In `web/site/src/styles/site.css`, replace:

````text
.owner-6 { fill: var(--owner-6); }
.owner-7 { fill: var(--owner-7); }
step-through { display: block; margin: 1.5rem 0; padding: 1rem; border: 1px solid var(--border); border-radius: 6px; }
.st-fields { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin-bottom: 0.75rem; }
````

with:

````text
.owner-6 { fill: var(--owner-6); }
.owner-7 { fill: var(--owner-7); }
pre, table { scrollbar-color: var(--border) transparent; }
step-through { display: block; margin: 1.5rem 0; padding: 1rem; border: 1px solid var(--border); border-radius: 6px; }
.st-fields { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin-bottom: 0.75rem; }
````

- [ ] **Step 2: Build, check and look**

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|page\(s\)"            # 8 page(s) built
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"               # check-dist: PASS (8 pages)
grep -c "shiki-light-bg\|shiki-dark-bg" web/site/src/styles/site.css || true     # 0
```

Optionally take a dark-theme screenshot of a chapter with code blocks (as in Task 3, Step 7, with `user_pref("ui.systemUsesDarkTheme", 1);` in the profile's `user.js`) and check that the code background matches the inline code and table-header shade. Report anything that looks wrong; do not change the design.

- [ ] **Step 3: Commit**

```bash
git add web/site/src/styles/site.css
git commit -m "fix the code block background and scrollbar colour in dark mode"
```

---

### Task 7: Build the lite module and test the wrapper in the Pages workflow

The site build now imports the lite module, so CI must build it; and nothing in CI yet runs the wrapper's native tests (the `rust.yml` workflow tests only the core crate). Both go into `pages.yml`, before the Node steps.

**Files:**
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1: Apply the edit**


In `.github/workflows/pages.yml`, replace:

````text
      run: ./build.sh

    - name: Generate the expected hashes for the gate page
      working-directory: web/wasm
````

with:

````text
      run: ./build.sh

    - name: Build the lite wasm module (stable and single-threaded, for the step-through)
      working-directory: web/wasm
      run: ./build-lite.sh

    - name: Test the wasm wrapper natively (without and with the threads feature)
      working-directory: web/wasm
      run: |
        cargo test
        cargo test --features threads

    - name: Generate the expected hashes for the gate page
      working-directory: web/wasm
````

- [ ] **Step 2: Check that it parses and the steps are where intended**

From the repository root (this uses the `yaml` package that Astro installed in `web/site/node_modules`):

```bash
docker run --rm -v "$PWD/.github/workflows:/wf:ro" -v "$PWD/web/site/node_modules:/nm:ro" -e NODE_PATH=/nm node:latest node -e "
const { parse } = require('yaml');
const w = parse(require('fs').readFileSync('/wf/pages.yml', 'utf8'));
console.log(Object.keys(w.jobs).join(','), Object.keys(w.on).join(','), w.jobs.build.steps.length, w.jobs.build.steps.map((s) => s.name || s.uses).slice(4, 9).join(' | '));
"
```

Expected, starting exactly: `build,deploy workflow_dispatch,pull_request 11`, followed by the step names from the threaded build through the Node setup, in this order: the threaded build, the lite build, the native wrapper tests, the expected hashes, then `actions/setup-node@v4`.

- [ ] **Step 3: Read it once against the local commands**

Confirm by reading: the lite build runs `./build-lite.sh` in `web/wasm` (stable, no `FEATURES`); the native tests are `cargo test` and `cargo test --features threads` in `web/wasm` (the pinned nightly applies there through `rust-toolchain.toml`; it is installed by the earlier step); both come before `npm ci`. Report any mismatch.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "build the lite module and test the wrapper in the Pages workflow"
```

---

### Task 8: Document the step-through in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Apply the edits**


In `CLAUDE.md`, replace:

````text
## What this is

A teaching-oriented Rust crate (`naive_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `matmul_levels.rs`; the crate name is `naive_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). It renders the chapters from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build) and keeps the stage B gate page at `/gate/`. `.github/workflows/pages.yml` builds the site on manual dispatch and on pull requests (no push trigger until the playground lands); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

with:

````text
## What this is

A teaching-oriented Rust crate (`naive_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `matmul_levels.rs`; the crate name is `naive_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). It renders the chapters from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build) keeps the stage B gate page at `/gate/`, and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch and on pull requests (no push trigger until the playground lands); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

In `CLAUDE.md`, replace:

````text
export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"   # CLI version must equal the =0.2.130 pin
./gate.sh g1|g2|probe|g5|lite [--no-build]      # build, then run a gate in headless Firefox; --no-build reuses pkg/ (pkg-lite/ for lite)
(cd ../site && ./gate-g3.sh [--no-build])       # Astro production build (Node in Docker) served under /matmul_levels.rs/ with no isolation headers; coi-serviceworker supplies them
```
````

with:

````text
export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"   # CLI version must equal the =0.2.130 pin
./gate.sh g1|g2|probe|g5|lite [--no-build]      # build, then run a gate in headless Firefox; --no-build reuses pkg/ (pkg-lite/ for lite)
(cd ../site && ./gate-c2.sh [--no-build])       # the step-through element from the production build, on a page with no isolation and no service worker
(cd ../site && ./gate-g3.sh [--no-build])       # Astro production build (Node in Docker) served under /matmul_levels.rs/ with no isolation headers; coi-serviceworker supplies them
```
````

In `CLAUDE.md`, replace:

````text
```sh
# from the repo root
web/dev/node.sh site npm test                   # the prose plugin's unit tests
web/dev/node.sh site npm run build              # the site into web/site/dist (needs FEATURES=threads ./build.sh first, for the gate page)
web/dev/node.sh site npm run check              # checks the built site (no crate::, one <h1>, chapters never load the service worker)
```
````

with:

````text
```sh
# from the repo root
web/dev/node.sh site npm test                   # unit tests of the prose plugin and the step-through's model
web/dev/node.sh site npm run build              # the site into web/site/dist (needs ./build-lite.sh and FEATURES=threads ./build.sh first, and public/expected.json for the gate page; the gate scripts do all three)
web/dev/node.sh site npm run check              # checks the built site (no crate::, one <h1>, chapters never load the service worker)
```
````

- [ ] **Step 2: Verify**

```bash
grep -n "gate-c2.sh\|step-through\|partition_plan" CLAUDE.md | cut -c1-120
```

Expected: at least two lines (the "What this is" paragraph and the Commands block).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "document the step-through in CLAUDE.md"
```

---

## After this plan

If every task passes, chapters 1 to 4 each carry an interactive step-through driven by the real plan functions, with a browser gate, a stricter output checker and CI that builds the lite module and tests the wrapper. Next: **C3** (the playground: `run_level` taking the level 4 tile shape, the Web Worker and its protocol with timeouts and terminate, the isolation state machine with the single-threaded fallback, browser gates for both paths, and then the `push` trigger on `trunk`).
