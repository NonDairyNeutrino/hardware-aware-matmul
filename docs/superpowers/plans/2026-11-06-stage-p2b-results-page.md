# Stage P2b: The Results Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Commits:** The repository owner has authorized the executing agents to commit, under strict rules. Each task is exactly one commit with the one-line message given in its **Commit** step. Stage only the files named (never `git add -A`, `git add .` or `git add <directory>`), no body, and **no** trailer or attribution of any kind (no `Co-Authored-By`, no "Generated with"). Never push, never open a PR, never amend or rewrite earlier commits.

**Goal:** Add the paper's **Results** section to the site: a page whose prose cites measured numbers only through placeholders, and whose tables and charts are generated from the committed reference-run data (`web/site/src/data/results.json`), with the page in the navigation and guarded by the output checker.

**Architecture:** A pure lookup module (`src/results/lookup.mjs`) resolves placeholders such as `{{ms simd n=1024 native}}` or `{{env cpu}}` against the data and throws on anything that does not resolve; the remark plugin applies it to the text of the pages, so a stale or misspelt placeholder fails the build. A second pure module (`render.mjs`) turns the data into static HTML tables and SVG charts (no JavaScript on the page). The plugin's existing `insertions` mechanism places them after named headings of `docs/paper/results.md`, a new Markdown page; `site.config.mjs` lists the page, and `check-dist.mjs` checks the built page.

**Tech Stack:** Astro 7.4.7 (existing), the remark plugin (existing), Node `node:test` run in the `node:latest` Docker image; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-results-design.md` (plan P2b of P2a to P2c).

## Global Constraints

- **No measured number is typed in prose, code or tables by hand.** Numbers reach the page only through placeholders and the generators, both reading `results.json`. A placeholder inside a code span or fence is left literal by design (so documentation can show the syntax); never put a placeholder you want resolved inside backticks.
- A placeholder or generator that cannot resolve **fails the build**; nothing falls back to an empty or made-up value.
- Noise is shown as the **interquartile range** (IQR) as a share of the median, never as min to max; cases above 20% are marked with a dagger.
- The Results page presents measurements; **comparisons and explanations belong to the Discussion (P3)**. It does not mention the playground, which does not exist yet.
- `docs/` stays the single source of prose: the page is `docs/paper/results.md`, rendered, not copied. The content collection already includes `paper/*.md`; never glob `docs/**`.
- The wasm modules, the Rust crate and `results.json` are not modified by this plan. No new npm packages. Node runs only in Docker (`web/dev/node.sh`).
- Chapters still never load the service worker, and a chapter without a demo loads no script (the existing checker enforces both).
- No commit trailers or attribution. One-line messages.

## Environment (already installed on this machine)

- Docker with the `node:latest` image (do not pull anything: **never run `docker run` with any other image**; if docker tries to pull, stop and report BLOCKED). Firefox 159 for the optional screenshots.
- The site build imports gitignored build outputs that should already exist: `web/wasm/pkg-lite/`, `web/wasm/pkg/` and `web/site/public/expected.json`. If `web/dev/node.sh site npm run build` fails because they are missing: `export WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"; (cd web/wasm && ./build-lite.sh && FEATURES=threads ./build.sh); (cd web/wasm && mkdir -p ../site/public && cargo run --release --example expected 2>/dev/null > ../site/public/expected.json)`.
- Before any browser step check nothing listens on the port you use (`ss -ltnp | grep PORT`); start servers with `& SRV=$!` and kill that PID (never `pkill -f`).

---

### Task 1: The results lookup behind the number placeholders

A pure module that finds numbers in `results.json`: the median, throughput, speedup or noise of a level at a size, thread count and environment, and facts about the reference run (CPU, cores, date, toolchains, sizes, and so on). `{{metric subject selectors}}` placeholders resolve through it: `ms`, `gflops`, `iqr` take one level, `speedup a/b` takes two (how many times faster `a` is than `b`), `env` takes a field name; selectors are `n=<size>`, `t=<threads>` and an environment (`native`, `lite`, `threads`, or the full names), defaulting to native, the largest size and the largest thread count (level 0 is always single-threaded). Anything that does not resolve throws an error that quotes the placeholder. A small made-up dataset (`fixture.mjs`) gives the tests numbers that can be checked by hand; one test also resolves a set of placeholders against the real committed file, so a change to its shape breaks the tests, not the page.

**Files:**
- Create: `web/site/src/results/fixture.mjs`, `web/site/src/results/lookup.test.mjs`, `web/site/src/results/lookup.mjs`
- Modify: `web/site/package.json`

**Interfaces:**
- Produces (`lookup.mjs`): `resolvePlaceholder(data, text)`, `substitute(text, data)`, `hasPlaceholder(text)`, `findRun`, `threadCounts`, `defaultSize`, `defaultThreads`, `noise(run)`, `interquartileRange(times)`, `formatMs`, `formatGflops`, `formatSpeedup`, `formatPercent`, `LEVELS`, `ENVIRONMENTS`, `ENV_FIELD_NAMES`.

- [ ] **Step 1: Write the fixture and the tests first**


Create `web/site/src/results/fixture.mjs`:

````javascript
// A small made-up dataset shaped like results.json, for the tests of the lookup and the
// renderers: two sizes, native with 1 and 2 threads, one single-threaded browser build.
// Native level L at T threads takes 1000 / (L * T) ms (level 0: 1000 ms) and browser-lite
// level L takes 4000 / (L + 1) ms, so every expected number can be worked out by hand.
export function run(environment, level, n, threads, median) {
  const times = [median * 0.98, median, median * 1.02];
  return {
    environment, level, n, threads, repeats: 3, times_ms: times, median_ms: median,
    min_ms: times[0], max_ms: times[2], gflops: (2 * n ** 3) / (median / 1000) / 1e9, hash: 'h',
  };
}
export const data = {
  schema: 1,
  generated: '2026-11-06T21:32:04Z',
  environment: {
    cpu: 'Test CPU', logical_cores: 8, physical_cores: 4, governor: 'performance', os: 'TestOS',
    commit: 'abcdef0123456789', firefox: 'Mozilla Firefox 1.0', native_isa: 'SSE2',
    browser_isa: 'WASM SIMD128', browser_pool: 8,
    toolchains: { native: 'rustc N', 'browser-lite': 'rustc L', 'browser-threads': 'rustc T' },
  },
  parameters: {
    sizes: [64, 128], repeats: 3, warmup: 1, block: [32, 64], tile: [128, 128, 128],
    threads: { native: [1, 2], 'browser-lite': [1], 'browser-threads': [1, 2] },
  },
  runs: [
    ...[64, 128].flatMap((n) => [
      run('native', 0, n, 1, 1000),
      ...[1, 2].flatMap((t) => [1, 2, 3, 4].map((l) => run('native', l, n, t, 1000 / (l * t)))),
      ...[0, 1, 2, 3, 4].map((l) => run('browser-lite', l, n, 1, 4000 / (l + 1))),
    ]),
  ],
};
````

Create `web/site/src/results/lookup.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { data, run } from './fixture.mjs';
import {
  ENV_FIELD_NAMES, formatMs, hasPlaceholder, interquartileRange, noise, resolvePlaceholder, substitute,
} from './lookup.mjs';

test('formats times as seconds, whole milliseconds or one decimal', () => {
  assert.equal(formatMs(3796.2), '3.8 s');
  assert.equal(formatMs(222.23), '222 ms');
  assert.equal(formatMs(42.46), '42.5 ms');
});

test('the interquartile range ignores a single outlier', () => {
  assert.equal(interquartileRange([10, 10, 10, 10, 1000]), 0);
  assert.equal(interquartileRange([1, 2, 3, 4, 5]), 2);
  const r = run('native', 0, 64, 1, 100);
  assert.ok(Math.abs(noise(r) - 0.02) < 1e-9);
});

test('resolves ms, gflops, speedup and iqr with the defaults (native, largest n, most threads)', () => {
  // level 3 native at n=128 with 2 threads: 1000/(3*2) ms
  assert.equal(resolvePlaceholder(data, 'ms simd'), '167 ms');
  assert.equal(resolvePlaceholder(data, 'gflops simd'), `${((2 * 128 ** 3) / (1000 / 6 / 1000) / 1e9).toFixed(1)} GFLOP/s`);
  // level 0 is always single-threaded: 1000 ms
  assert.equal(resolvePlaceholder(data, 'ms naive'), '1.0 s');
  // simd is 6 times faster than naive here (1000 / 166.7)
  assert.equal(resolvePlaceholder(data, 'speedup simd/naive'), '6.0×');
  assert.equal(resolvePlaceholder(data, 'iqr simd'), '2%');
});

test('selectors choose the size, thread count and environment', () => {
  assert.equal(resolvePlaceholder(data, 'ms threaded n=64 t=1'), '1.0 s');
  assert.equal(resolvePlaceholder(data, 'ms streaming n=64 t=1'), '250 ms');
  assert.equal(resolvePlaceholder(data, 'ms simd n=64 lite'), '1.0 s');
  assert.equal(resolvePlaceholder(data, 'ms L3 browser-lite'), '1.0 s');
  // t= is ignored for level 0
  assert.equal(resolvePlaceholder(data, 'ms naive t=2'), '1.0 s');
});

test('env facts', () => {
  assert.equal(resolvePlaceholder(data, 'env cpu'), 'Test CPU');
  assert.equal(resolvePlaceholder(data, 'env date'), '2026-11-06');
  assert.equal(resolvePlaceholder(data, 'env commit'), 'abcdef0');
  assert.equal(resolvePlaceholder(data, 'env firefox'), 'Firefox 1.0');
  assert.equal(resolvePlaceholder(data, 'env sizes'), '64 and 128');
  assert.equal(resolvePlaceholder(data, 'env runs'), String(data.runs.length));
});

test('anything that does not resolve throws and quotes the placeholder', () => {
  for (const bad of ['ms nonsense', 'ms simd n=999', 'ms simd t=64', 'ms simd weird', 'bogus simd', 'ms',
    'speedup simd', 'speedup simd/naive/x', 'env nothing', 'env cpu extra', 'ms simd lite t=2']) {
    assert.throws(() => resolvePlaceholder(data, bad), new RegExp(`unresolvable placeholder "\\{\\{${bad.replace(/[/]/g, '\\/')}\\}\\}"`), bad);
  }
});

test('substitute replaces every placeholder in a sentence and leaves the rest alone', () => {
  const out = substitute('Level 3 took {{ms simd}} on a {{env cpu}}, {{speedup simd/naive}} faster.', data);
  assert.equal(out, 'Level 3 took 167 ms on a Test CPU, 6.0× faster.');
  assert.equal(substitute('no placeholders { here } or {single}', data), 'no placeholders { here } or {single}');
  assert.ok(hasPlaceholder('a {{ms simd}} b'));
  assert.ok(!hasPlaceholder('a {ms simd} b'));
});

test('a placeholder with no data is an error', () => {
  assert.throws(() => substitute('{{ms simd}}', null), /no results data/);
});

test('the committed results.json resolves every kind of placeholder the prose uses', () => {
  const real = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url), 'utf8'));
  for (const name of ENV_FIELD_NAMES) assert.ok(resolvePlaceholder(real, `env ${name}`).length > 0, name);
  for (const metric of ['ms', 'gflops', 'iqr']) {
    for (const level of ['naive', 'threaded', 'cache_friendly', 'simd', 'streaming']) {
      for (const environment of ['native', 'lite', 'threads']) {
        assert.doesNotMatch(resolvePlaceholder(real, `${metric} ${level} ${environment}`), /NaN|undefined/);
      }
    }
  }
  assert.match(resolvePlaceholder(real, 'speedup simd/naive native'), /^\d+\.\d×$/);
});
````

- [ ] **Step 2: Make `npm test` run the new directory**

In `web/site/package.json`, replace:

````text
    "prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public/media && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js && cp ../../anim/media/videos/naive_matmul/480p15/NaiveMatMul.mp4 ../../anim/media/videos/naive_matmul_parallel/480p15/ParallelNaiveMatMul.mp4 public/media/",
    "build": "astro build",
    "test": "node --test src/plugins/ src/components/",
    "check": "node check-dist.mjs"
  },
````

with:

````text
    "prebuild": "rm -rf node_modules/.astro .astro && mkdir -p public/media && cp node_modules/coi-serviceworker/coi-serviceworker.js public/coi-serviceworker.js && cp ../../anim/media/videos/naive_matmul/480p15/NaiveMatMul.mp4 ../../anim/media/videos/naive_matmul_parallel/480p15/ParallelNaiveMatMul.mp4 public/media/",
    "build": "astro build",
    "test": "node --test src/plugins/ src/components/ src/results/",
    "check": "node check-dist.mjs"
  },
````

- [ ] **Step 3: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module" | head -2`
Expected: `Cannot find module '/work/site/src/results/lookup.mjs'`.

- [ ] **Step 4: Write the lookup**


Create `web/site/src/results/lookup.mjs`:

````javascript
// Looks numbers up in the reference run's data (src/data/results.json), for the prose
// placeholders and the generated tables and charts of the Results page. Pure functions:
// no file access, so they can be tested with a small fake dataset.
//
// A placeholder is written `{{metric subject selectors}}` in the Markdown, for example
//   {{ms simd n=1024 native}}            median time of level 3 at n = 1024, native
//   {{gflops cache_friendly lite}}       throughput of level 2, browser, lite build
//   {{speedup simd/naive n=512 native}}  how many times faster level 3 is than level 0
//   {{iqr streaming t=4}}                noise of level 4 with 4 threads, native
//   {{env cpu}}                          a fact about the reference run
// Anything that does not resolve throws, so a stale or misspelt placeholder fails the
// build instead of publishing a wrong number.

/** Levels by module name (and the L0 to L4 shorthand). */
export const LEVELS = { naive: 0, threaded: 1, cache_friendly: 2, simd: 3, streaming: 4 };
for (let level = 0; level <= 4; level += 1) LEVELS[`L${level}`] = level;

/** The names of the three measured environments, and the short forms prose may use. */
export const ENVIRONMENTS = ['native', 'browser-lite', 'browser-threads'];
const ENVIRONMENT_ALIASES = { lite: 'browser-lite', threads: 'browser-threads' };

/** Interquartile range of `times` (inclusive quartiles), a noise measure that one slow
 *  outlier cannot dominate the way max minus min can. */
export function interquartileRange(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q) => {
    const position = (sorted.length - 1) * q;
    const below = Math.floor(position);
    const above = Math.ceil(position);
    return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
  };
  return at(0.75) - at(0.25);
}

/** A run's noise: the interquartile range as a fraction of its median. */
export function noise(run) {
  return interquartileRange(run.times_ms) / run.median_ms;
}

/** The run for exactly this environment, level, size and thread count, or undefined. */
export function findRun(data, environment, level, n, threads) {
  return data.runs.find(
    (r) => r.environment === environment && r.level === level && r.n === n && r.threads === threads,
  );
}

/** The thread counts measured for an environment (level 0 is always measured with 1). */
export function threadCounts(data, environment) {
  return data.parameters.threads[environment];
}

/** The largest size, and the largest thread count of an environment. */
export function defaultSize(data) {
  return Math.max(...data.parameters.sizes);
}
export function defaultThreads(data, environment, level) {
  return level === 0 ? 1 : Math.max(...threadCounts(data, environment));
}

/** `ms` as text: seconds from 1000 ms, whole milliseconds from 100, else one decimal. */
export function formatMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}
export const formatGflops = (value) => `${value.toFixed(1)} GFLOP/s`;
export const formatSpeedup = (ratio) => `${ratio.toFixed(1)}×`;
export const formatPercent = (fraction) => `${Math.round(fraction * 100)}%`;

const ENV_FIELDS = {
  cpu: (d) => d.environment.cpu,
  cores: (d) => String(d.environment.logical_cores),
  physical_cores: (d) => String(d.environment.physical_cores),
  governor: (d) => d.environment.governor,
  os: (d) => d.environment.os,
  date: (d) => d.generated.slice(0, 10),
  commit: (d) => d.environment.commit.slice(0, 7),
  firefox: (d) => d.environment.firefox.replace(/^Mozilla /, ''),
  rustc_native: (d) => d.environment.toolchains.native,
  rustc_lite: (d) => d.environment.toolchains['browser-lite'],
  rustc_threads: (d) => d.environment.toolchains['browser-threads'],
  native_isa: (d) => d.environment.native_isa,
  browser_isa: (d) => d.environment.browser_isa,
  pool: (d) => String(d.environment.browser_pool),
  runs: (d) => String(d.runs.length),
  repeats: (d) => String(d.parameters.repeats),
  warmup: (d) => String(d.parameters.warmup),
  sizes: (d) => d.parameters.sizes.join(' and '),
  largest: (d) => String(defaultSize(d)),
  block: (d) => d.parameters.block.join(' x '),
  tile: (d) => d.parameters.tile.join(' x '),
};

/** The names `{{env ...}}` accepts. */
export const ENV_FIELD_NAMES = Object.keys(ENV_FIELDS);

function parseSelectors(data, tokens, problem) {
  const selectors = { environment: 'native', n: defaultSize(data), threads: null };
  for (const token of tokens) {
    if (ENVIRONMENTS.includes(token)) selectors.environment = token;
    else if (token in ENVIRONMENT_ALIASES) selectors.environment = ENVIRONMENT_ALIASES[token];
    else if (/^n=\d+$/.test(token)) selectors.n = Number(token.slice(2));
    else if (/^t=\d+$/.test(token)) selectors.threads = Number(token.slice(2));
    else problem(`unknown selector "${token}" (use n=<size>, t=<threads>, or one of ${[...ENVIRONMENTS, ...Object.keys(ENVIRONMENT_ALIASES)].join(', ')})`);
  }
  return selectors;
}

function level(name, problem) {
  if (!(name in LEVELS)) problem(`unknown level "${name}" (use ${Object.keys(LEVELS).join(', ')})`);
  return LEVELS[name];
}

function runFor(data, selectors, levelNumber, problem) {
  // Level 0 is single-threaded whatever `t=` says.
  const threads = levelNumber === 0 ? 1 : (selectors.threads ?? defaultThreads(data, selectors.environment, levelNumber));
  const run = findRun(data, selectors.environment, levelNumber, selectors.n, threads);
  if (!run) {
    problem(`no measurement for level ${levelNumber}, n=${selectors.n}, ${threads} thread(s) in ${selectors.environment}`);
  }
  return run;
}

/**
 * The text a placeholder stands for. `text` is what is between the braces, `data` the
 * parsed results.json. Throws an Error that quotes the placeholder if it cannot resolve.
 */
export function resolvePlaceholder(data, text) {
  const problem = (message) => {
    throw new Error(`unresolvable placeholder "{{${text}}}": ${message}`);
  };
  const [metric, subject, ...rest] = text.trim().split(/\s+/);
  if (metric === 'env') {
    if (!(subject in ENV_FIELDS) || rest.length > 0) {
      return problem(`env needs one of: ${ENV_FIELD_NAMES.join(', ')}`);
    }
    return ENV_FIELDS[subject](data);
  }
  if (!['ms', 'gflops', 'speedup', 'iqr'].includes(metric)) {
    return problem('the metric must be ms, gflops, speedup, iqr or env');
  }
  if (!subject) return problem('a level is needed');
  const selectors = parseSelectors(data, rest, problem);
  if (metric === 'speedup') {
    const parts = subject.split('/');
    if (parts.length !== 2) return problem('speedup needs two levels, like simd/naive (how many times faster the first is)');
    const faster = runFor(data, selectors, level(parts[0], problem), problem);
    const baseline = runFor(data, selectors, level(parts[1], problem), problem);
    return formatSpeedup(baseline.median_ms / faster.median_ms);
  }
  const run = runFor(data, selectors, level(subject, problem), problem);
  if (metric === 'ms') return formatMs(run.median_ms);
  if (metric === 'gflops') return formatGflops(run.gflops);
  return formatPercent(noise(run));
}

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

/** Whether `text` contains a placeholder. */
export function hasPlaceholder(text) {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/** `text` with every placeholder replaced; `data` may be null (then any placeholder throws). */
export function substitute(text, data) {
  return text.replace(PLACEHOLDER, (_whole, inner) => {
    if (!data) throw new Error(`placeholder "{{${inner}}}" found but no results data was given`);
    return resolvePlaceholder(data, inner);
  });
}
````

- [ ] **Step 5: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"`
Expected: `ℹ tests 33`, `ℹ pass 33`, `ℹ fail 0` (the 24 existing tests and 9 new ones), no `✖` lines. The last new test reads the real `src/data/results.json`; if it fails, the data's shape differs from what the lookup expects: stop and report BLOCKED.

- [ ] **Step 6: Commit**

```bash
git add web/site/package.json web/site/src/results/fixture.mjs web/site/src/results/lookup.mjs web/site/src/results/lookup.test.mjs
git commit -m "add the results lookup behind the number placeholders"
```

---

### Task 2: Replace the number placeholders in the prose plugin

The remark plugin that turns `docs/` into site pages learns one more job: in running text, `{{...}}` placeholders are replaced by what the lookup resolves them to, using the parsed `results.json` passed as the new option `results`. They work in paragraphs, emphasis, headings and table cells; code spans and fences stay literal, so documentation can show the syntax. A placeholder that does not resolve, or any placeholder when no data was given, **fails the build** with the file's name in the message.

**Files:**
- Modify: `web/site/src/plugins/remark-rustdoc.test.mjs`, `web/site/src/plugins/remark-rustdoc.mjs`

**Interfaces:**
- Consumes: `hasPlaceholder`, `substitute` (Task 1).
- Produces: the plugin option `results` (the parsed `results.json`, or null).

- [ ] **Step 1: Write the failing tests**

Add a small fake dataset and four tests, just before the existing `demotes headings one level` test:


In `web/site/src/plugins/remark-rustdoc.test.mjs`, replace:

````text
  assert.doesNotMatch(out, /hidden/);
  assert.match(out, /fn main/);
});
````

with:

````text
  assert.doesNotMatch(out, /hidden/);
  assert.match(out, /fn main/);
});

const results = {
  generated: '2026-11-06T00:00:00Z',
  environment: { cpu: 'Test CPU' },
  parameters: { sizes: [64], threads: { native: [1, 2] } },
  runs: [
    { environment: 'native', level: 0, n: 64, threads: 1, median_ms: 1000, gflops: 1, times_ms: [990, 1000, 1010] },
    { environment: 'native', level: 3, n: 64, threads: 2, median_ms: 250, gflops: 4, times_ms: [245, 250, 255] },
  ],
};

test('replaces placeholders in paragraphs, emphasis, headings and table cells', async () => {
  const out = await render(
    '# Level {{ms simd}}\n\nIt took **{{ms simd}}** on a {{env cpu}}, _{{speedup simd/naive}}_ faster.\n\n| a | b |\n|---|---|\n| {{gflops simd}} | x |\n',
    { results },
  );
  assert.match(out, /Level 250 ms/);
  assert.match(out, /\*\*250 ms\*\*/);
  assert.match(out, /Test CPU/);
  assert.match(out, /4\.0×/);
  assert.match(out, /4\.0 GFLOP\/s/);
  assert.doesNotMatch(out, /\{\{/);
});

test('placeholders in code spans and fences stay literal', async () => {
  const out = await render('Use `{{ms simd}}` like so:\n\n```text\n{{ms simd}}\n```\n', { results });
  assert.equal(out.split('{{ms simd}}').length - 1, 2);
});

test('a placeholder that does not resolve fails the build, naming the file', async () => {
  await assert.rejects(render('Took {{ms simd n=999}}.', { results }), /naive\.md: unresolvable placeholder "\{\{ms simd n=999\}\}"/);
});

test('a placeholder with no results data fails the build', async () => {
  await assert.rejects(render('Took {{ms simd}}.'), /no results data/);
});
````

- [ ] **Step 2: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `ℹ tests 37` with `ℹ fail` between 2 and 4 (the plugin does not replace placeholders yet).

- [ ] **Step 3: Implement the replacement**


In `web/site/src/plugins/remark-rustdoc.mjs`, replace:

````text
//     explicit table, and anything not in the table FAILS the build;
//   - figures and demos are inserted after named headings, so the Markdown stays
//     free of site markup.
import { visit } from 'unist-util-visit';

/** rustdoc hides lines that start with "# " (or are exactly "#") and unescapes "##". */
````

with:

````text
//     explicit table, and anything not in the table FAILS the build;
//   - figures and demos are inserted after named headings, so the Markdown stays
//     free of site markup;
//   - `{{metric subject selectors}}` placeholders in text are replaced by numbers from
//     the reference run's data (see ../results/lookup.mjs), so no measured number is ever
//     typed in prose, and a placeholder that does not resolve FAILS the build.
import { visit } from 'unist-util-visit';
import { hasPlaceholder, substitute } from '../results/lookup.mjs';

/** rustdoc hides lines that start with "# " (or are exactly "#") and unescapes "##". */
````

In `web/site/src/plugins/remark-rustdoc.mjs`, replace:

````text
 *        or null to show the text as plain code
 * @param {{chapter: string, afterHeading: string, html: string}[]} [options.insertions]
 */
export default function remarkRustdoc({ base = '/', links = {}, insertions = [] } = {}) {
  return (tree, file) => {
    const where = file.path ?? 'unknown file';
````

with:

````text
 *        or null to show the text as plain code
 * @param {{chapter: string, afterHeading: string, html: string}[]} [options.insertions]
 * @param {object|null} [options.results]  the parsed results.json, for placeholders
 */
export default function remarkRustdoc({ base = '/', links = {}, insertions = [], results = null } = {}) {
  return (tree, file) => {
    const where = file.path ?? 'unknown file';
````

In `web/site/src/plugins/remark-rustdoc.mjs`, replace:

````text
    visit(tree, 'code', (node) => {
      if (node.lang === 'rust') node.value = cleanRustFence(node.value);
    });
````

with:

````text
    visit(tree, 'code', (node) => {
      if (node.lang === 'rust') node.value = cleanRustFence(node.value);
    });

    // Placeholders in running text (not in code spans or fences, which stay literal).
    visit(tree, 'text', (node) => {
      if (!hasPlaceholder(node.value)) return;
      try {
        node.value = substitute(node.value, results);
      } catch (error) {
        throw new Error(`${where}: ${error.message}`);
      }
    });
````

- [ ] **Step 4: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"`
Expected: `ℹ tests 37`, `ℹ pass 37`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/site/src/plugins/remark-rustdoc.mjs web/site/src/plugins/remark-rustdoc.test.mjs
git commit -m "replace number placeholders in the prose plugin"
```

---

### Task 3: Let an insertion follow the paragraph under its heading

Insertions (the videos, the step-through, and now tables) are placed right after a named heading. A table should follow the paragraph that introduces it, so an insertion may now say `blocksAfter: 1` (skip that many blocks after the heading). If the section has fewer blocks than that, the build fails.

**Files:**
- Modify: `web/site/src/plugins/remark-rustdoc.test.mjs`, `web/site/src/plugins/remark-rustdoc.mjs`

- [ ] **Step 1: Write the failing test**

Add before the test `a placeholder that does not resolve fails the build, naming the file`:


In `web/site/src/plugins/remark-rustdoc.test.mjs`, replace:

````text
  const out = await render('Use `{{ms simd}}` like so:\n\n```text\n{{ms simd}}\n```\n', { results });
  assert.equal(out.split('{{ms simd}}').length - 1, 2);
});
````

with:

````text
  const out = await render('Use `{{ms simd}}` like so:\n\n```text\n{{ms simd}}\n```\n', { results });
  assert.equal(out.split('{{ms simd}}').length - 1, 2);
});

test('an insertion can follow the paragraph after its heading', async () => {
  const insertions = [{ chapter: 'levels/naive', afterHeading: 'Two', blocksAfter: 1, html: '<p>TABLE</p>' }];
  const out = await render('# One\n\n# Two\n\nIntro.\n\nMore.\n', { insertions });
  assert.ok(out.indexOf('Intro.') < out.indexOf('TABLE') && out.indexOf('TABLE') < out.indexOf('More.'), out);
  await assert.rejects(
    render('# Two\n\nIntro.\n', { insertions: [{ ...insertions[0], blocksAfter: 5 }] }),
    /fewer than 5 blocks/,
  );
});
````

- [ ] **Step 2: Run it to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` -> `ℹ tests 38` and `ℹ fail 1`.

- [ ] **Step 3: Implement it**


In `web/site/src/plugins/remark-rustdoc.mjs`, replace:

````text
 *        intra-doc link target (without the "crate::" prefix) -> route under `base`,
 *        or null to show the text as plain code
 * @param {{chapter: string, afterHeading: string, html: string}[]} [options.insertions]
 * @param {object|null} [options.results]  the parsed results.json, for placeholders
 */
````

with:

````text
 *        intra-doc link target (without the "crate::" prefix) -> route under `base`,
 *        or null to show the text as plain code
 * @param {{chapter: string, afterHeading: string, html: string, blocksAfter?: number}[]} [options.insertions]
 *        `blocksAfter` (default 0) skips that many blocks after the heading, so a table can
 *        follow the paragraph that introduces it rather than the heading itself
 * @param {object|null} [options.results]  the parsed results.json, for placeholders
 */
````

In `web/site/src/plugins/remark-rustdoc.mjs`, replace:

````text
        throw new Error(`${where}: no heading "${insertion.afterHeading}" to insert after`);
      }
      tree.children.splice(index + 1, 0, { type: 'html', value: insertion.html });
    }
````

with:

````text
        throw new Error(`${where}: no heading "${insertion.afterHeading}" to insert after`);
      }
      const at = index + 1 + (insertion.blocksAfter ?? 0);
      if (at > tree.children.length) {
        throw new Error(`${where}: "${insertion.afterHeading}" has fewer than ${insertion.blocksAfter} blocks after it`);
      }
      tree.children.splice(at, 0, { type: 'html', value: insertion.html });
    }
````

- [ ] **Step 4: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` -> `ℹ tests 38`, `ℹ pass 38`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/site/src/plugins/remark-rustdoc.mjs web/site/src/plugins/remark-rustdoc.test.mjs
git commit -m "let an insertion follow the paragraph under its heading"
```

---

### Task 4: The table and chart generators

`render.mjs` builds the Results page's tables and charts as static HTML and SVG from the data, at build time (no JavaScript on the page). `bestTable` shows each level at the environment's largest thread count (median, throughput, speedup over level 0, IQR); `scalingTable` shows levels 1 to 4 across the measured thread counts with the speedup over one thread in brackets; `throughputChart` is a grouped bar chart of GFLOP/s per level for the environments; `scalingChart` plots speedup over one thread against the thread count with the ideal line. Every table is a `<figure>` whose caption sits **outside** the horizontally scrolling box (so it stays readable on a phone) and is linked to the table with `aria-labelledby`; every chart is an SVG with a title and a description that spell out its numbers for screen readers. Cases with IQR above 20% of the median are marked with a dagger, with a note. A missing measurement throws.

**Files:**
- Create: `web/site/src/results/render.test.mjs`, `web/site/src/results/render.mjs`

**Interfaces:**
- Consumes: the lookup (Task 1) and the fixture.
- Produces (`render.mjs`): `bestTable(data, { environment, n? })`, `scalingTable(data, { environment, n? })`, `throughputChart(data, { n? })`, `scalingChart(data, { environment, n? })` (each returns an HTML string); `NOISY`, `LEVEL_NAMES`, `ENVIRONMENT_LABELS`.

- [ ] **Step 1: Write the tests first**


Create `web/site/src/results/render.test.mjs`:

````javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { data } from './fixture.mjs';
import { bestTable, scalingChart, scalingTable, throughputChart } from './render.mjs';

const count = (haystack, needle) => haystack.split(needle).length - 1;

test('the best-configuration table has one row per level with the numbers from the data', () => {
  const html = bestTable(data, { environment: 'native' });
  assert.equal(count(html, '<tr>'), 6); // header + 5 levels
  assert.match(html, /<figcaption id="table-native-best-128">Native, n = 128: median of 3 runs\. "vs level 0" is the speedup/);
  assert.match(html, /<table class="results" aria-labelledby="table-native-best-128">/);
  // level 3 at 2 threads: 1000 / 6 ms, 6.0 times faster than level 0 (1 s)
  assert.match(html, /<th scope="row">Level 3: SIMD<\/th><td>2<\/td><td>167 ms<\/td><td>[\d.]+ GFLOP\/s<\/td><td>6\.0×<\/td><td>2%<\/td>/);
  assert.match(html, /<th scope="row">Level 0: naive<\/th><td>1<\/td><td>1\.0 s<\/td>/);
  assert.doesNotMatch(html, /†|NaN|undefined/);
});

test('a noisy case is marked with a dagger and the table says what it means', () => {
  const noisy = structuredClone(data);
  const target = noisy.runs.find((r) => r.environment === 'native' && r.level === 3 && r.n === 128 && r.threads === 2);
  target.times_ms = [target.median_ms * 0.5, target.median_ms, target.median_ms * 1.5];
  const html = bestTable(noisy, { environment: 'native' });
  assert.match(html, /<td class="noisy">50% †<\/td>/);
  assert.match(html, /table-note">† The interquartile range is above 20%/);
});

test('the scaling table shows each thread count with the speedup over one thread', () => {
  const html = scalingTable(data, { environment: 'native', n: 64 });
  assert.match(html, /<th scope="col">1 thread<\/th><th scope="col">2 threads<\/th>/);
  // level 2: 500 ms with 1 thread, 250 ms with 2
  assert.match(html, /Level 2: cache blocking<\/th><td>500 ms \(1\.0×\)<\/td><td>250 ms \(2\.0×\)<\/td>/);
  assert.equal(count(html, '<tr>'), 5);
});

test('the throughput chart is an accessible SVG with a bar per level and environment', () => {
  const html = throughputChart(data, {});
  assert.match(html, /<svg viewBox="0 0 640 320" role="img" aria-labelledby="throughput-title throughput-desc">/);
  assert.match(html, /<title id="throughput-title">Throughput of each level, n = 128<\/title>/);
  // two environments in the fixture: 5 bars each, plus one legend swatch each
  assert.equal(count(html, 'class="bar bar-native"'), 6);
  assert.equal(count(html, 'class="bar bar-browser-lite"'), 6);
  assert.match(html, /<desc id="throughput-desc">GFLOP\/s at the largest thread count\. Native: level 0 [\d.]+, level 1 [\d.]+/);
  assert.equal(count(html, '<svg'), 1);
  assert.equal(count(html, '</svg>'), 1);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the scaling chart has a line per level over the measured thread counts, and the ideal', () => {
  const html = scalingChart(data, { environment: 'native', n: 64 });
  for (const level of [1, 2, 3, 4]) assert.equal(count(html, `<polyline class="line line-${level}"`), 1);
  assert.equal(count(html, '<polyline class="ideal"'), 1);
  assert.equal(count(html, '<circle'), 8); // 4 levels x 2 thread counts
  assert.match(html, /<title id="scaling-native-title">Thread scaling, Native, n = 64<\/title>/);
  // every level in the fixture scales perfectly: 2 threads is 2.0x
  assert.match(html, /level 1: 1 threads 1\.0×, 2 threads 2\.0×/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('missing measurements are an error, never a silent gap', () => {
  assert.throws(() => bestTable(data, { environment: 'browser-threads' }), /no measurement for browser-threads/);
  assert.throws(() => scalingTable(data, { environment: 'native', n: 999 }), /no measurement/);
});

test('the real results.json renders every table and chart without gaps', () => {
  const real = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url), 'utf8'));
  for (const environment of ['native', 'browser-lite', 'browser-threads']) {
    assert.doesNotMatch(bestTable(real, { environment }), /NaN|undefined/);
  }
  for (const environment of ['native', 'browser-threads']) {
    assert.doesNotMatch(scalingTable(real, { environment }), /NaN|undefined/);
    assert.doesNotMatch(scalingChart(real, { environment }), /NaN|undefined|Infinity/);
  }
  assert.doesNotMatch(throughputChart(real, {}), /NaN|undefined|Infinity/);
});
````

- [ ] **Step 2: Run them to see the failure**

`web/dev/node.sh site npm test 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module" | head -2` -> `Cannot find module '/work/site/src/results/render.mjs'`.

- [ ] **Step 3: Write the generators**


Create `web/site/src/results/render.mjs`:

````javascript
// Builds the Results page's tables and charts as static HTML and SVG from the reference
// run's data, at build time: no JavaScript on the page, and every number comes from
// results.json. (The prose cites numbers through placeholders; see lookup.mjs.)
import {
  ENVIRONMENTS, defaultThreads, findRun, formatGflops, formatMs, formatPercent, formatSpeedup, noise,
  threadCounts,
} from './lookup.mjs';

/** Cases whose interquartile range exceeds this share of the median are marked as noisy. */
export const NOISY = 0.2;

export const LEVEL_NAMES = [
  'Level 0: naive', 'Level 1: threaded', 'Level 2: cache blocking', 'Level 3: SIMD', 'Level 4: streaming',
];
export const ENVIRONMENT_LABELS = {
  native: 'Native',
  'browser-lite': 'Browser, lite build (one thread)',
  'browser-threads': 'Browser, threaded build',
};
const ENVIRONMENT_SHORT = { native: 'native', 'browser-lite': 'lite', 'browser-threads': 'threaded' };

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sizeOf(data, n) {
  return n ?? Math.max(...data.parameters.sizes);
}

function mustFind(data, environment, level, n, threads) {
  const run = findRun(data, environment, level, n, threads);
  if (!run) throw new Error(`no measurement for ${environment}, level ${level}, n=${n}, ${threads} thread(s)`);
  return run;
}

/** Marks a noisy case with a dagger. */
function noiseCell(run) {
  const value = noise(run);
  return value > NOISY
    ? `<td class="noisy">${formatPercent(value)} †</td>`
    : `<td>${formatPercent(value)}</td>`;
}

const NOISE_NOTE = `<p class="table-note">† The interquartile range is above ${Math.round(NOISY * 100)}% of the median: treat these figures as indicative.</p>`;

/**
 * One row per level at the environment's largest thread count (level 0 with 1): median,
 * throughput, speedup over level 0 in the same environment, and the noise.
 */
export function bestTable(data, { environment, n }) {
  const size = sizeOf(data, n);
  const baseline = mustFind(data, environment, 0, size, 1);
  let anyNoisy = false;
  const rows = [0, 1, 2, 3, 4].map((level) => {
    const run = mustFind(data, environment, level, size, defaultThreads(data, environment, level));
    anyNoisy ||= noise(run) > NOISY;
    return `<tr><th scope="row">${escape(LEVEL_NAMES[level])}</th><td>${run.threads}</td>` +
      `<td>${formatMs(run.median_ms)}</td><td>${formatGflops(run.gflops)}</td>` +
      `<td>${formatSpeedup(baseline.median_ms / run.median_ms)}</td>${noiseCell(run)}</tr>`;
  });
  const id = `table-${ENVIRONMENT_SHORT[environment]}-best-${size}`;
  return `<figure class="results-figure"><figcaption id="${id}">${escape(ENVIRONMENT_LABELS[environment])}, n = ${size}: median of ${data.parameters.repeats} runs. ` +
    `"vs level 0" is the speedup over level 0 in the same environment; IQR is the noise.</figcaption>` +
    `<div class="table-scroll"><table class="results" aria-labelledby="${id}">` +
    `<thead><tr><th scope="col">Level</th><th scope="col">Threads</th><th scope="col">Median</th>` +
    `<th scope="col">Throughput</th><th scope="col">vs level 0</th><th scope="col">IQR</th></tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table></div></figure>${anyNoisy ? NOISE_NOTE : ''}`;
}

/**
 * Levels 1 to 4 against the thread counts measured for the environment: the median, and
 * in brackets the speedup over the same level with one thread.
 */
export function scalingTable(data, { environment, n }) {
  const size = sizeOf(data, n);
  const counts = threadCounts(data, environment);
  let anyNoisy = false;
  const rows = [1, 2, 3, 4].map((level) => {
    const single = mustFind(data, environment, level, size, 1);
    const cells = counts.map((threads) => {
      const run = mustFind(data, environment, level, size, threads);
      const noisy = noise(run) > NOISY;
      anyNoisy ||= noisy;
      return `<td${noisy ? ' class="noisy"' : ''}>${formatMs(run.median_ms)} (${formatSpeedup(single.median_ms / run.median_ms)})${noisy ? ' †' : ''}</td>`;
    });
    return `<tr><th scope="row">${escape(LEVEL_NAMES[level])}</th>${cells.join('')}</tr>`;
  });
  const heads = counts.map((t) => `<th scope="col">${t} thread${t === 1 ? '' : 's'}</th>`).join('');
  const id = `table-${ENVIRONMENT_SHORT[environment]}-scaling-${size}`;
  return `<figure class="results-figure"><figcaption id="${id}">${escape(ENVIRONMENT_LABELS[environment])}, n = ${size}: median time, and speedup over one thread in brackets</figcaption>` +
    `<div class="table-scroll"><table class="results" aria-labelledby="${id}">` +
    `<thead><tr><th scope="col">Level</th>${heads}</tr></thead><tbody>${rows.join('')}</tbody></table></div></figure>${anyNoisy ? NOISE_NOTE : ''}`;
}

const W = 640;
const H = 320;
const M = { left: 56, right: 16, top: 40, bottom: 52 };

function niceMax(value) {
  const step = 10 ** Math.floor(Math.log10(value));
  for (const factor of [1, 2, 5, 10]) if (value <= factor * step) return factor * step;
  return 10 * step;
}

/** Grouped bars: throughput (GFLOP/s) of each level at the largest thread count, per environment. */
export function throughputChart(data, { n }) {
  const size = sizeOf(data, n);
  const environments = ENVIRONMENTS.filter((e) => findRun(data, e, 0, size, 1));
  const values = environments.map((environment) =>
    [0, 1, 2, 3, 4].map((level) => mustFind(data, environment, level, size, defaultThreads(data, environment, level)).gflops));
  const top = niceMax(Math.max(...values.flat()));
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const groupW = plotW / 5;
  const barW = (groupW * 0.8) / environments.length;
  const y = (v) => M.top + plotH - (v / top) * plotH;
  const parts = [];
  for (let i = 0; i <= 4; i += 1) {
    const v = (top / 4) * i;
    parts.push(`<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="tick" x="${M.left - 6}" y="${y(v) + 4}" text-anchor="end">${Number(v.toFixed(1))}</text>`);
  }
  values.forEach((series, e) => {
    series.forEach((v, level) => {
      const x = M.left + level * groupW + groupW * 0.1 + e * barW;
      parts.push(`<rect class="bar bar-${environments[e]}" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${(plotH - (y(v) - M.top)).toFixed(1)}"/>` +
        `<text class="value" x="${(x + (barW - 2) / 2).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" text-anchor="middle">${v.toFixed(1)}</text>`);
    });
  });
  for (let level = 0; level <= 4; level += 1) {
    parts.push(`<text class="axis" x="${(M.left + level * groupW + groupW / 2).toFixed(1)}" y="${H - M.bottom + 18}" text-anchor="middle">Level ${level}</text>`);
  }
  const legend = environments.map((environment, e) =>
    `<rect class="bar bar-${environment}" x="${M.left + e * 190}" y="10" width="12" height="12"/>` +
    `<text class="legend" x="${M.left + e * 190 + 18}" y="20">${escape(ENVIRONMENT_LABELS[environment])}</text>`).join('');
  const description = environments.map((environment, e) =>
    `${ENVIRONMENT_LABELS[environment]}: ${values[e].map((v, level) => `level ${level} ${v.toFixed(1)}`).join(', ')}`).join('. ');
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="throughput-title throughput-desc">` +
    `<title id="throughput-title">Throughput of each level, n = ${size}</title>` +
    `<desc id="throughput-desc">GFLOP/s at the largest thread count. ${escape(description)}.</desc>` +
    `${legend}${parts.join('')}</svg>` +
    `<figcaption>Throughput in GFLOP/s (higher is faster) of each level at n = ${size}, at the largest thread count measured in each environment (level 0 always uses one).</figcaption></figure>`;
}

/** Lines: speedup over one thread against the thread count, levels 1 to 4, with the ideal. */
export function scalingChart(data, { environment, n }) {
  const size = sizeOf(data, n);
  const counts = threadCounts(data, environment);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const top = Math.max(...counts);
  const x = (i) => M.left + (counts.length === 1 ? plotW / 2 : (plotW * i) / (counts.length - 1));
  const y = (v) => M.top + plotH - (v / top) * plotH;
  const parts = [];
  for (let i = 0; i <= 4; i += 1) {
    const v = (top / 4) * i;
    parts.push(`<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="tick" x="${M.left - 6}" y="${y(v) + 4}" text-anchor="end">${Number(v.toFixed(1))}×</text>`);
  }
  counts.forEach((t, i) => parts.push(`<text class="axis" x="${x(i).toFixed(1)}" y="${H - M.bottom + 18}" text-anchor="middle">${t}</text>`));
  parts.push(`<text class="axis" x="${(M.left + plotW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">threads</text>`);
  parts.push(`<polyline class="ideal" fill="none" points="${counts.map((t, i) => `${x(i).toFixed(1)},${y(t).toFixed(1)}`).join(' ')}"/>`);
  const series = [1, 2, 3, 4].map((level) => {
    const single = mustFind(data, environment, level, size, 1);
    return counts.map((t) => single.median_ms / mustFind(data, environment, level, size, t).median_ms);
  });
  series.forEach((values, index) => {
    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    parts.push(`<polyline class="line line-${index + 1}" fill="none" points="${points.join(' ')}"/>` +
      values.map((v, i) => `<circle class="dot line-${index + 1}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5"/>`).join(''));
  });
  const legend = [1, 2, 3, 4].map((level) =>
    `<line class="line line-${level}" x1="${M.left + (level - 1) * 130}" x2="${M.left + (level - 1) * 130 + 16}" y1="16" y2="16"/>` +
    `<text class="legend" x="${M.left + (level - 1) * 130 + 22}" y="20">Level ${level}</text>`).join('') +
    `<line class="ideal" x1="${M.left + 4 * 130}" x2="${M.left + 4 * 130 + 16}" y1="16" y2="16"/><text class="legend" x="${M.left + 4 * 130 + 22}" y="20">ideal</text>`;
  const description = series.map((values, i) => `level ${i + 1}: ${counts.map((t, k) => `${t} threads ${values[k].toFixed(1)}×`).join(', ')}`).join('. ');
  const id = `scaling-${ENVIRONMENT_SHORT[environment]}`;
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-title ${id}-desc">` +
    `<title id="${id}-title">Thread scaling, ${escape(ENVIRONMENT_LABELS[environment])}, n = ${size}</title>` +
    `<desc id="${id}-desc">Speedup over one thread. ${escape(description)}.</desc>` +
    `${legend}${parts.join('')}</svg>` +
    `<figcaption>${escape(ENVIRONMENT_LABELS[environment])}, n = ${size}: speedup over the same level with one thread against the number of threads. The dashed line is perfect scaling.</figcaption></figure>`;
}
````

- [ ] **Step 4: Run the tests**

`web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` -> `ℹ tests 45`, `ℹ pass 45`, `ℹ fail 0`. The last new test renders every table and chart from the real `results.json` and fails on `NaN`, `undefined` or `Infinity`.

- [ ] **Step 5: Commit**

```bash
git add web/site/src/results/render.mjs web/site/src/results/render.test.mjs
git commit -m "add the table and chart generators for the results"
```

---

### Task 5: The Results page

`docs/paper/results.md` is the page's prose: what was measured (sizes, repeats, the timer's scope, the noise measure, the machine and toolchains, all through placeholders), then native results, native thread scaling, browser results, browser thread scaling, the same-answer finding (the number of runs and the hash agreement), and noise and limits. It reports measurements and does not compare or explain them (that is the Discussion's job), and it does not mention the playground. The generated tables and charts are inserted after the paragraphs that introduce them. The page is added to the navigation (a plain `Results` link after the Methods group, route `results/`), the styles for tables and charts are added, and `astro.config.mjs` passes the data to the plugin. `site.config.mjs` imports `results.json` with a JSON import (a path relative to `import.meta.url` breaks when Astro bundles the config).

**Files:**
- Create: `docs/paper/results.md`
- Modify: `web/site/site.config.mjs`, `web/site/astro.config.mjs`, `web/site/src/styles/site.css`

**Interfaces:**
- Consumes: the plugin's `results` option and `blocksAfter` (Tasks 2 and 3), the generators (Task 4), `results.json`.
- Produces: the page at `/hardware-aware-matmul/results/`; `site.config.mjs` exports `results`.

- [ ] **Step 1: Write the page**


Create `docs/paper/results.md`:

````markdown
The same matrix product was timed at every level, natively and in a web browser, on one
machine. This page reports the measurements and nothing else: the Discussion compares
them. Every figure on it comes from the committed data of the reference run, not from
this text.

# What was measured

Each case multiplies two square matrices of the project's order-sensitive test data (the
same generator natively and in the browser), at sizes {{env sizes}}. The timer covers the
multiplication only: the matrices are built once beforehand and the result is hashed
afterwards. Each case ran {{env warmup}} untimed warm-up runs and then {{env repeats}}
timed runs. The tables show the **median** and, as the measure of noise, the
**interquartile range** (IQR): the spread of the middle half of the runs, as a share of
the median. Cases whose IQR is above 20% are marked †. Throughput is `2n³`
floating-point operations divided by the median time. Level 0 is single-threaded; the
other levels were run with each thread count shown. Levels 2 to 4 use cache blocks of
{{env block}} and level 4 uses output tiles of {{env tile}}.

The reference machine: {{env cpu}}, with {{env physical_cores}} physical cores
({{env cores}} logical), running {{env os}} with the CPU governor set to
{{env governor}}. The run was made on {{env date}} from commit {{env commit}}.
Native code was compiled with {{env rustc_native}} for the baseline instruction set of
the target ({{env native_isa}}). Browser code ran as WebAssembly in {{env firefox}},
compiled with {{env rustc_lite}} (the lite build) and {{env rustc_threads}} (the threaded
build) with {{env browser_isa}} enabled; the threaded build used a pool of {{env pool}}
threads.

# Native

At n = {{env largest}}, level 0 took {{ms naive}} and level 3 took {{ms simd}} at the
largest thread count: {{speedup simd/naive}} faster.

# Thread scaling, native

Each level's median time at every measured thread count, with the speedup over one
thread in brackets, and the same speedups as a chart.

# In the browser

The same cases ran in {{env firefox}} as WebAssembly, in two builds: a single-threaded
one (the **lite** build, which the step-through diagrams in the Methods also use) and a
threaded one on a pool of {{env pool}} threads. At n = {{env largest}}, level 3 took
{{ms simd lite}} in the lite build and {{ms simd threads}} in the threaded build;
natively it took {{ms simd}}.

# Thread scaling in the browser

The threaded build, as in the native case. The lite build has one thread, so it has no
scaling to show.

# The same answer everywhere

All {{env runs}} measured runs, every level and every thread count, natively and in both
browser builds, produced the same result for each matrix size, bit for bit. Each run's
output was hashed, and the reference-run script refuses to produce this data unless every
hash agrees for each size. The arithmetic does not change from level to level; only how
the hardware is used does.

# Noise and limits

These are the measurements of one machine on one day.

- The IQR column shows how much the runs of each case varied. Cases marked † varied by
  more than 20% of their median and are indicative only.
- Thread counts above {{env physical_cores}} must share physical cores with other
  threads, so they cannot be expected to scale like the lower ones.
- Browser timings come from `performance.now()` on a cross-origin-isolated page.
  Browsers deliberately coarsen their clocks, so very short times are less precise.
- The numbers describe this hardware and these compilers. Read the ratios as showing the
  size of the effects on this machine, not as constants.
````

- [ ] **Step 2: List the page, generate its tables and charts, and pass the data to the plugin**

In `web/site/site.config.mjs`, replace:

````text
// Everything about the site that is not in docs/: the chapters have no frontmatter
// (rustdoc would show it as text), so their titles, order and routes live here.
````

with:

````text
import results from './src/data/results.json' with { type: 'json' };
import { bestTable, scalingChart, scalingTable, throughputChart } from './src/results/render.mjs';

// Everything about the site that is not in docs/: the chapters have no frontmatter
// (rustdoc would show it as text), so their titles, order and routes live here.
````

In `web/site/site.config.mjs`, replace:

````text
export const siteTitle = 'Mechanical sympathy';
export const siteSubtitle = 'Five levels of matrix multiplication in Rust';
export const repoUrl = 'https://github.com/NonDairyNeutrino/hardware-aware-matmul';
````

with:

````text
export const siteTitle = 'Mechanical sympathy';
export const siteSubtitle = 'Five levels of matrix multiplication in Rust';
// The reference run's data: the numbers of the Results page (placeholders in its prose,
// and the tables and charts built from it) come from here and nowhere else.
export { results };
export const repoUrl = 'https://github.com/NonDairyNeutrino/hardware-aware-matmul';
````

In `web/site/site.config.mjs`, replace:

````text
  { id: 'levels/simd', title: 'Level 3: registers and SIMD', route: 'levels/simd/', section: 'methods' },
  { id: 'levels/streaming', title: 'Level 4: streaming', route: 'levels/streaming/', section: 'methods' },
];
````

with:

````text
  { id: 'levels/simd', title: 'Level 3: registers and SIMD', route: 'levels/simd/', section: 'methods' },
  { id: 'levels/streaming', title: 'Level 4: streaming', route: 'levels/streaming/', section: 'methods' },
  { id: 'paper/results', title: 'Results', route: 'results/', section: 'results' },
];
````

In `web/site/site.config.mjs`, replace:

````text
    ),
  },
];
````

with:

````text
    ),
  },
  // The Results page: tables and charts generated from the data, after the paragraph that
  // introduces each.
  { chapter: 'paper/results', afterHeading: 'Native', blocksAfter: 1,
    html: bestTable(results, { environment: 'native' }) },
  { chapter: 'paper/results', afterHeading: 'Thread scaling, native', blocksAfter: 1,
    html: scalingTable(results, { environment: 'native' }) + scalingChart(results, { environment: 'native' }) },
  { chapter: 'paper/results', afterHeading: 'In the browser', blocksAfter: 1,
    html: bestTable(results, { environment: 'browser-lite' }) + bestTable(results, { environment: 'browser-threads' }) +
      throughputChart(results, {}) },
  { chapter: 'paper/results', afterHeading: 'Thread scaling in the browser', blocksAfter: 1,
    html: scalingTable(results, { environment: 'browser-threads' }) + scalingChart(results, { environment: 'browser-threads' }) },
];
````


In `web/site/astro.config.mjs`, replace:

````text
import { unified } from '@astrojs/markdown-remark';
import remarkRustdoc from './src/plugins/remark-rustdoc.mjs';
import { base, insertions, links } from './site.config.mjs';

export default defineConfig({
````

with:

````text
import { unified } from '@astrojs/markdown-remark';
import remarkRustdoc from './src/plugins/remark-rustdoc.mjs';
import { base, insertions, links, results } from './site.config.mjs';

export default defineConfig({
````

In `web/site/astro.config.mjs`, replace:

````text
  vite: { worker: { format: 'es' } },
  markdown: {
    processor: unified({ remarkPlugins: [[remarkRustdoc, { base, links, insertions }]] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
  },
````

with:

````text
  vite: { worker: { format: 'es' } },
  markdown: {
    processor: unified({ remarkPlugins: [[remarkRustdoc, { base, links, insertions, results }]] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
  },
````


- [ ] **Step 3: Style the tables and charts**

In `web/site/src/styles/site.css`, replace:

````text
  .st-grid rect[data-row] { transition: opacity 0.2s; }
}
````

with:

````text
  .st-grid rect[data-row] { transition: opacity 0.2s; }
}

/* Results page: generated tables and charts */
.results-figure { margin: 0 0 1.25rem; }
.results-figure figcaption { margin-bottom: 0.4rem; font-size: 0.92rem; font-weight: 600; }
.table-scroll { overflow-x: auto; }
table.results { border-collapse: collapse; width: 100%; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
table.results th, table.results td { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
table.results th:first-child { text-align: left; }
table.results td.noisy { color: var(--muted); font-style: italic; }
.table-note { margin-top: -0.75rem; font-size: 0.85rem; color: var(--muted); }
figure.chart { margin: 0 0 1.5rem; }
figure.chart svg { width: 100%; height: auto; }
figure.chart figcaption { font-size: 0.9rem; color: var(--muted); }
.chart .grid { stroke: var(--border); stroke-width: 1; }
.chart .tick, .chart .axis, .chart .legend { fill: var(--fg); font-size: 11px; }
.chart .value { fill: var(--muted); font-size: 10px; }
.chart .bar-native { fill: var(--owner-0); }
.chart .bar-browser-lite { fill: var(--owner-1); }
.chart .bar-browser-threads { fill: var(--owner-2); }
.chart .line { fill: none; stroke-width: 2; }
.chart polyline.line-1, .chart line.line-1 { stroke: var(--owner-0); }
.chart polyline.line-2, .chart line.line-2 { stroke: var(--owner-1); }
.chart polyline.line-3, .chart line.line-3 { stroke: var(--owner-2); }
.chart polyline.line-4, .chart line.line-4 { stroke: var(--owner-3); }
.chart circle.line-1 { fill: var(--owner-0); }
.chart circle.line-2 { fill: var(--owner-1); }
.chart circle.line-3 { fill: var(--owner-2); }
.chart circle.line-4 { fill: var(--owner-3); }
.chart .ideal { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 4 3; }
````

- [ ] **Step 4: Build and check**

With the wasm modules and `expected.json` in place (see the environment section):

```bash
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|rror|page\(s\)|unresolv"
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"
echo "tables $(grep -o '<table' web/site/dist/results/index.html | wc -l) charts $(grep -o '<figure class="chart"' web/site/dist/results/index.html | wc -l) braces $(grep -o '{{' web/site/dist/results/index.html | wc -l)"
grep -o 'At n = [^<]*' web/site/dist/results/index.html | head -1
```

Expected: `10 page(s) built` (the abstract, introduction, five levels, the results page and the two gate pages) and no error; `check-dist: PASS (10 pages)`; `tables 5 charts 3 braces 0` (five tables, three charts, no unresolved placeholder left); and a sentence beginning `At n = 1024, level 0 took` with real numbers. If the build fails with `unresolvable placeholder "{{...}}"`, a placeholder in `results.md` does not match the data: stop and report BLOCKED with the message. Do not weaken the lookup.

- [ ] **Step 5: Look at it (not gated, but do it)**

Serve the build under `/hardware-aware-matmul/` and screenshot the page at desktop width in light mode and at phone width in dark mode, then read the PNGs:

```bash
REPO=$PWD; SC=$(mktemp -d); ln -s "$REPO/web/site/dist" "$SC/hardware-aware-matmul"
ss -ltnp | grep 8872 && echo "port busy: stop"
cd "$SC"; NO_ISOLATION=1 REPORT=/dev/null python3 -I "$REPO/web/dev/serve.py" 8872 > /dev/null 2>&1 & SRV=$!; cd "$REPO"
sleep 1; PROFILE=$(mktemp -d)
timeout 90 firefox --headless --no-remote --profile "$PROFILE" --screenshot "$SC/desk.png" --window-size=1000,3400 http://127.0.0.1:8872/hardware-aware-matmul/results/
echo 'user_pref("ui.systemUsesDarkTheme", 1);' > "$PROFILE/user.js"
timeout 90 firefox --headless --no-remote --profile "$PROFILE" --screenshot "$SC/phone.png" --window-size=420,2400 http://127.0.0.1:8872/hardware-aware-matmul/results/
kill $SRV; rm -rf "$PROFILE"; ss -ltnp | grep 8872 || echo "port free"
```

Check: the Results link is underlined in the navigation; the measured-machine paragraph shows real values (CPU, cores, date, commit, toolchains); the tables have the headings Level, Threads, Median, Throughput, vs level 0 and IQR with captions above them; on the phone the tables scroll inside their own box while their captions wrap; the line chart shows four lines and a dashed ideal; the bar chart shows three coloured series with a legend; dark mode is readable. Report anything that looks wrong; do not change the design. Delete `$SC` afterwards.

- [ ] **Step 6: Commit**

```bash
git add docs/paper/results.md web/site/site.config.mjs web/site/astro.config.mjs web/site/src/styles/site.css
git commit -m "add the Results page with generated tables and charts"
```

---

### Task 6: Check the built Results page

The output checker gains Results-specific rules: the page must not contain an unresolved `{{` (which would show readers a raw placeholder, for example one written inside a code span), must not contain `NaN`, `undefined` or `Infinity`, and must contain at least four tables and three charts. These guard the generated parts against the failure modes a build alone does not catch.

**Files:**
- Modify: `web/site/check-dist.mjs`

- [ ] **Step 1: Apply the edits**


In `web/site/check-dist.mjs`, replace:

````text
//   - a landing page that is not headed by the site title and subtitle with the abstract
//     under them;
//   - a video the pages reference that was not copied into dist/media/.
// Run it with `npm run check` after `npm run build`. Exits 1 on any problem.
````

with:

````text
//   - a landing page that is not headed by the site title and subtitle with the abstract
//     under them;
//   - a Results page with an unresolved `{{...}}` placeholder, a missing table or chart,
//     or a NaN/undefined/Infinity where a number should be;
//   - a video the pages reference that was not copied into dist/media/.
// Run it with `npm run check` after `npm run build`. Exits 1 on any problem.
````

In `web/site/check-dist.mjs`, replace:

````text
  if (wanted.length > 0 && reachableScripts(html).length === 0) problems.push(`${where}: has a demo but loads no script`);
  if (wanted.length === 0 && /<script/.test(html)) problems.push(`${where}: has no demo but loads a script`);
}
````

with:

````text
  if (wanted.length > 0 && reachableScripts(html).length === 0) problems.push(`${where}: has a demo but loads no script`);
  if (wanted.length === 0 && /<script/.test(html)) problems.push(`${where}: has no demo but loads a script`);
  if (chapter.id === 'paper/results') {
    if (html.includes('{{')) problems.push(`${where}: contains an unresolved "{{" placeholder`);
    if (/\b(NaN|undefined|Infinity)\b/.test(html)) problems.push(`${where}: contains NaN, undefined or Infinity`);
    const tables = (html.match(/<table class="results"/g) ?? []).length;
    const charts = (html.match(/<figure class="chart"/g) ?? []).length;
    if (tables < 4 || charts < 3) problems.push(`${where}: ${tables} tables and ${charts} charts, expected at least 4 and 3`);
  }
}
````

- [ ] **Step 2: Check it passes on the real build**

After rebuilding (`web/dev/node.sh site npm run build`):

```bash
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"      # check-dist: PASS (10 pages)
```

- [ ] **Step 3: Negative controls**

Edit only the **built output** in `web/site/dist/results/index.html`, one at a time, run the check, and restore `dist` from a copy you take first (inside your scratchpad) after each:

```bash
cp -a web/site/dist <scratchpad>/dist-bak
# 1. an unresolved placeholder
sed -i 's|The reference machine|{{oops}} The reference machine|' web/site/dist/results/index.html
#    expect: check-dist: FAIL and  - results/: contains an unresolved "{{" placeholder
# 2. a NaN
sed -i 's|The reference machine|NaN The reference machine|' web/site/dist/results/index.html
#    expect: ... contains NaN, undefined or Infinity
# 3. no tables
sed -i 's|<table class="results"|<table class="x"|g' web/site/dist/results/index.html
#    expect: ... 0 tables and 3 charts, expected at least 4 and 3
# 4. no charts
sed -i 's|<figure class="chart"|<figure class="x"|g' web/site/dist/results/index.html
#    expect: ... 5 tables and 0 charts, expected at least 4 and 3
```

Run `web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"` after each edit, and restore `dist` after each. At the end the check must print `check-dist: PASS (10 pages)` again.

- [ ] **Step 4: Commit**

```bash
git add web/site/check-dist.mjs
git commit -m "check the built Results page"
```

---

### Task 7: Reword the benchmark statements and document the Results pipeline

The README and the Introduction (the crate's rustdoc) said the documentation "deliberately contains no benchmark numbers". That is still true of them, but it reads oddly beside a Results section, so both now say where the project's own measurements are (the site, as generated data with the machine they were taken on). `CLAUDE.md` describes the Results pipeline, the placeholder syntax and the fail-the-build rule.

**Files:**
- Modify: `README.md`, `docs/introduction.md`, `CLAUDE.md`

- [ ] **Step 1: Reword the README and the introduction**


In `docs/introduction.md`, replace:

````text
The first command multiplies two `n × n` matrices at every level, verifies that
all five results are identical, and prints a table of times. This documentation
deliberately contains no benchmark numbers: throughput depends heavily on your
CPU, memory, and storage, so measure on your own hardware. Use `--release`;
debug builds say nothing useful about the differences between the levels.
````

with:

````text
The first command multiplies two `n × n` matrices at every level, verifies that
all five results are identical, and prints a table of times. This documentation
contains no benchmark numbers: throughput depends heavily on your CPU, memory, and
storage, so measure on your own hardware. (The project's website publishes one
reference run, as generated data, with the machine it was taken on.) Use `--release`;
debug builds say nothing useful about the differences between the levels.
````

In `README.md`, replace:

````text
`compare` multiplies two `n × n` matrices at every level, verifies that the
five results are identical, and prints each level's time relative to the
previous level and to the naive baseline. The documentation deliberately
contains no benchmark numbers: measure on your own hardware, and always use
`--release`.

## Documentation
````

with:

````text
`compare` multiplies two `n × n` matrices at every level, verifies that the
five results are identical, and prints each level's time relative to the
previous level and to the naive baseline. The documentation contains no
benchmark numbers: measure on your own hardware, and always use `--release`. (The
project's website publishes one reference run, as generated data, with the machine it
was taken on.)

## Documentation
````

- [ ] **Step 2: Document the pipeline in CLAUDE.md**

In `CLAUDE.md`, replace:

````text
## What this is

A teaching-oriented Rust crate (`hardware_aware_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `hardware-aware-matmul`; the crate name is `hardware_aware_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build; both wasm builds enable `+simd128`, so level 3 vectorises in the browser); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). The site is laid out as a paper: abstract (`docs/paper/abstract.md`, the landing page), introduction, methods (the levels), and later results, discussion and conclusion (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`); `chapters` and `sectionTitles` in `site.config.mjs` give the order and the navigation groups. It renders those pages from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch, on every push to `trunk` (which deploys it, unless the push only touches `docs/superpowers/`) and on pull requests (build only); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

with:

````text
## What this is

A teaching-oriented Rust crate (`hardware_aware_matmul`, no dependencies, `#![forbid(unsafe_code)]`, MSRV 1.73) implementing dense `f64` matrix multiplication as five levels of increasing performance. The repo directory is `hardware-aware-matmul`; the crate name is `hardware_aware_matmul`. `anim/` holds unrelated-to-build Manim (Python) animations explaining the levels. `web/` is browser tooling, excluded from the published crate. `web/wasm` is a separate crate (own empty `[workspace]`, tracked `Cargo.lock`, nightly pinned in its `rust-toolchain.toml`) that wraps the levels for WebAssembly with a rayon-backed `RayonRunner` (without the `threads` feature it is a stable single-threaded `InlineRunner` build, the "lite" build; both wasm builds enable `+simd128`, so level 3 vectorises in the browser); `web/dev/` holds a stdlib-only dev server, a headless-Firefox page runner, the gate report checker and `node.sh`. `web/site` is the Astro site; Node runs only in Docker, through `web/dev/node.sh` (image `node:latest` unless `NODE_IMAGE` is set). The site is laid out as a paper: abstract (`docs/paper/abstract.md`, the landing page), introduction, methods (the levels), results, and later discussion and conclusion (`docs/superpowers/specs/2026-11-06-paper-structure-design.md`); the Results page is generated from `web/site/src/data/results.json` by `web/site/src/results/` (lookup and renderers), its prose cites numbers only through `{{metric subject selectors}}` placeholders (`{{ms simd n=1024 native}}`, `{{env cpu}}`) that the remark plugin resolves, and one that does not resolve fails the build; `chapters` and `sectionTitles` in `site.config.mjs` give the order and the navigation groups. It renders those pages from `docs/` (the remark plugin in `web/site/src/plugins/` strips rustdoc-hidden lines and rewrites intra-doc links through the table in `web/site/site.config.mjs`; a link not in the table fails the build), keeps the stage B gate page at `/gate/` (and the step-through gate page at `/gate/step-through/`), and embeds a `<step-through>` custom element (`web/site/src/components/`, placed by the `demos` list in `site.config.mjs`) in chapters 1 to 4 that draws the real work partition from the wrapper's `partition_plan` and `env_info` on the lite module, so chapters need no threads and no service worker. `.github/workflows/pages.yml` builds the site on manual dispatch, on every push to `trunk` (which deploys it, unless the push only touches `docs/superpowers/`) and on pull requests (build only); the owner must set Settings > Pages > Source = GitHub Actions once, and `WASM_BINDGEN_VERSION` there must track the `=0.2.130` pin in `web/wasm/Cargo.toml`.

## Commands
````

In `CLAUDE.md`, replace:

````text
python3 -I web/dev/test_results.py              # unit tests of the results assembler
web/dev/bench-reference.sh                      # the reference run (idle machine; SIZES/THREADS/REPEATS/OUT env for rehearsals)
web/dev/node.sh site npm test                   # unit tests of the prose plugin and the step-through's model
web/dev/node.sh site npm run build              # the site into web/site/dist (needs ./build-lite.sh and FEATURES=threads ./build.sh first, and public/expected.json for the gate page; the gate scripts do all three)
web/dev/node.sh site npm run check              # checks the built site (no crate::, one <h1>, chapters never load or register the service worker, demos match site.config.mjs, chapters without a demo load no script)
````

with:

````text
python3 -I web/dev/test_results.py              # unit tests of the results assembler
web/dev/bench-reference.sh                      # the reference run (idle machine; SIZES/THREADS/REPEATS/OUT env for rehearsals)
web/dev/node.sh site npm test                   # unit tests of the prose plugin, the step-through's model and the results lookup and renderers
web/dev/node.sh site npm run build              # the site into web/site/dist (needs ./build-lite.sh and FEATURES=threads ./build.sh first, and public/expected.json for the gate page; the gate scripts do all three)
web/dev/node.sh site npm run check              # checks the built site (no crate::, one <h1>, chapters never load or register the service worker, demos match site.config.mjs, chapters without a demo load no script)
````

- [ ] **Step 3: Verify**

The Introduction is the crate's module documentation, so its doctests must still pass, and the site must still build:

```bash
cargo test --doc 2>&1 | grep -E "test result|FAILED"          # test result: ok. (the same counts as before; no FAILED)
web/dev/node.sh site npm run build 2>&1 | grep -E "ERROR|page\(s\)"   # 10 page(s) built
web/dev/node.sh site npm run check 2>&1 | grep -E "check-dist|^ -"      # check-dist: PASS (10 pages)
grep -n "reference run" README.md docs/introduction.md | cut -c1-100   # one line in each
```

- [ ] **Step 4: Commit**

Two commits (the documentation text, then the project notes):

```bash
git add README.md docs/introduction.md
git commit -m "say where the project's benchmark numbers are"
git add CLAUDE.md
git commit -m "document the Results pipeline in CLAUDE.md"
```

---

## After this plan

If every task passes, the site has a Results page whose every number comes from the committed reference-run data, with the machine and date stated on it. It is published by merging (the push trigger deploys). Next: **P2c**, the playground: a Web Worker that runs the same benchmark on the reader's own machine (with timeouts, cancel, the isolation state machine and the single-threaded fallback, and a "same answer" indicator), added to the Results page; then **P3**: the Discussion, the Conclusion and the final abstract, which explain what the Results show.
