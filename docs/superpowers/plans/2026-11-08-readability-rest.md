# Readability, the Rest: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the ADHD-readability review of the paper: a short summary and a level legend at the top of the Discussion, a bulleted Conclusion verdict, a shorter Abstract sentence, definitions for undefined terms, a reading path, one question per Predict callout, "Level N of 5" reworded, a progress marker on every page and a site-only "What the measurements found" strip on each level chapter.

**Architecture:** Prose edits to `docs/paper/*.md` and the six `docs/levels/*.md` first lines (Tasks 1 to 5); two small site features in `web/site` (Tasks 6 and 7: a pure `progressLabel` function with a test, and per-level strips generated in `site.config.mjs` from `results.json` through the existing `substitute`). No benchmark data, Rust code, claims tests or rustdoc numbers change; the hover glossary from the review is out of scope (it would duplicate the primer's terms table and need a sync test).

**Tech Stack:** Markdown, Astro 5 site (Node via Docker only: `web/dev/node.sh`), `node --test`.

Spec for the motivation: the ADHD-readability review of the paper and the earlier plan `docs/superpowers/plans/2026-11-08-discussion-readability.md`; the story it must keep: `docs/superpowers/specs/2026-11-08-paper-narrative-design.md`.

## Global Constraints

- **Numbers only as `{{...}}` placeholders on site pages** (`docs/paper/*.md`, and the strips in `site.config.mjs`). `docs/levels/*.md` and `docs/introduction.md` are rustdoc: no numbers, no placeholders.
- **A sentence that states a comparison in words needs a test** in `web/site/src/results/claims.test.mjs` with the same scope, and must say no more than the test asserts. Every claim added in this plan reuses a sentence that already exists on the site, or a test named in the task.
- **Never say what limits threads at four.** The arithmetic probe is a "test", never "the machine's limit" or "peak" in prose.
- **Do not widen, strengthen or weaken an existing claim sentence.** Where a task restructures existing text (Tasks 3 and 4) it moves whole sentences and changes only punctuation, bold leads and the connectives listed.
- **Keep `# What the counters show` (anchor `#what-the-counters-show`) and the heading ids that other text links to.**
- **Links:** only `crate::<name>` targets listed in `web/site/site.config.mjs` `links`; no `crate::` text inside strips (the site check scans for it).
- **Placeholder multiset:** for every `docs/paper` page a task edits, save `grep -o "{{[^}]*}}" <file> | sort | uniq -c` before and diff after; every difference must be explained by the task.
- **Never join lines of a Markdown list, table or heading when rewrapping** (a previous pass broke a list this way and the checks did not notice): after any rewrap, confirm each bullet still starts a line.
- **Commits:** one commit per task, one-line message, then a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work continues on branch `discussion-readability` (the user approved branch-plus-small-commits earlier).
- **Verification commands** (repo root; Node only via Docker; the build takes minutes):
  - `web/dev/node.sh site npm test` (157 pass at the start; Tasks 6 and 7 add tests)
  - `web/dev/node.sh site npm run build`, then `web/dev/node.sh site npm run check`
  - `cargo test --doc` after Task 4 (it edits rustdoc pages)

---

### Task 1: The Discussion's opening: summary and legend

**Files:**
- Modify: `docs/paper/discussion.md` (the opening paragraph, before `# The answer does not change`)

- [ ] **Step 1: Baseline.** Save the placeholder multiset and a copy of the page to the scratchpad.

- [ ] **Step 2: Replace the opening paragraph** (the one beginning "The [Results](crate::results) report what was measured; this page weighs it.") with exactly the following. The old paragraph's sentences "Everything below refers to the reference run: one laptop, one day, one browser.", "Every figure is filled in from that run's committed data." and "Where a sentence explains a difference rather than reports it, the sentence says so, and where the data cannot tell two explanations apart, the page says that too." are kept word for word inside the new text; the old list of sections is replaced by the bullets.

```markdown
The [Results](crate::results) report what was measured; this page weighs it. The question from
the [Introduction](crate::introduction) was where the time of the textbook loop goes. In short:

- **The cores.** At the largest size, level 2 on one thread beat level 1 at every thread count.
  More cores were not the main thing the loop was missing.
- **Memory.** Most of the one-thread gain came with level 2, which reorders the loops and
  blocks for the cache. Cache-miss counts, taken at two sizes, fit the memory system as the
  cause.
- **The cleanups.** On one thread the vector kernel of level 3 took a much smaller step than
  level 2. Packing the second matrix (level 4) was faster than level 3 at every thread count at
  the two largest sizes.
- **The twist.** Level 5 was built so that matrices need not fit in memory, and it was
  nonetheless the fastest case measured, natively, on four threads, at the largest size.
- **Still open.** Threads stopped helping levels 3 to 5 where the physical cores ran out,
  although a test of arithmetic alone kept gaining. These measurements do not say what limits
  them.

The levels, by number: 0 the textbook loop, 1 threads, 2 cache blocking, 3 registers and
vector lanes, 4 the packed copy, 5 streaming.

The sections below take these in order. Everything below refers to the reference run: one
laptop, one day, one browser. Every figure is filled in from that run's committed data. Each
section opens with its claim and then a table; what the data cannot show is collected in a
paragraph labelled "What this does not show". Where a sentence explains a difference rather
than reports it, the sentence says so, and where the data cannot tell two explanations apart,
the page says that too.
```

- [ ] **Step 3: Check each new claim against its test** (read the assertions, not the titles): 'the first clue' (level 2 on one thread beats level 1 at every native thread count, at the largest size), 'most of the one-thread gain arrives with level 2' and 'level 3 gains much less over level 2' (largest size, one thread), 'level 4 (packing) against level 3: a lead only at the two largest sizes' (every thread count), 'level 5 on four threads, natively, is the fastest case measured at the largest size', 'levels 2 to 5 stop scaling at the physical cores ...' (levels 3 to 5) and 'the hardware probe ... the peak keeps gaining'. "Fit the memory system as the cause" is the Discussion's own wording ("That fits the memory system as the cause"). If a bullet says more than its test asserts, soften it and say so.

- [ ] **Step 4: Verify.** Placeholder multiset unchanged (this opening has none). `web/dev/node.sh site npm test`, `npm run build`, `npm run check`; `grep -c "<table" web/site/dist/discussion/index.html` still 11; the opening renders a 5-item list (count `<li>` before the first `<h2`).

- [ ] **Step 5: Commit.** `git add docs/paper/discussion.md && git commit -m "open the discussion with a short summary and a level legend"`.

---

### Task 2: The Discussion's body: one more table, shorter sentences

**Files:**
- Modify: `docs/paper/discussion.md`

- [ ] **Step 1: Baseline** (multiset and page copy).

- [ ] **Step 2: Tabulate the culprit paragraph's times.** In `# The culprit: memory`, the paragraph beginning "At n = {{env largest}}, on one thread, the naive loop took {{ms naive}}." (7 placeholders in 82 words). Replace its first four sentences' number list with a table and keep the interpretation sentences word for word:

```markdown
At n = {{env largest}}, on one thread:

| level | time | faster than level 0 |
|---|---|---|
| 0, the textbook loop | {{ms naive}} | |
| 2, cache blocking | {{ms cache_friendly t=1}} | {{speedup cache_friendly/naive t=1}} |
| 3, registers and vector lanes | {{ms simd t=1}} | {{speedup simd/naive t=1}} |

Level 3 is only {{speedup simd/cache_friendly t=1}} faster than level 2. Most of the
single-thread gain therefore arrives with level 2, which changes the
[loop order and blocks for the cache](crate::cache_friendly). A plausible reading is that the
same operations, arranged this way, use data while it is still in the cache instead of fetching
it from memory again.
```

(The old text said "Level 3 took ... {{speedup simd/naive t=1}} faster than level 0 but only {{speedup simd/cache_friendly t=1}} faster than level 2"; the table carries the times and the first two speedups, the sentence keeps the comparison with level 2. The sentence 'The run did not measure that.' lives in this section's gathered paragraph already: do not move it.) Allowed multiset change: none (every placeholder reappears once; check).

- [ ] **Step 3: Split the 61-word sentence** in `# The twist: streaming` ("One reading offered for level 5's lead was that its small buffers hold short rows ... may compete for the same places in a cache.") into three sentences with the same words, changing only punctuation and capitalisation and adding "this" once: `One reading offered for level 5's lead was this. Its small buffers hold short rows that lie next to each other in memory. Level 3 works on the full matrices, whose rows lie n × 8 bytes apart (16 KiB at n = 2048), and rows that far apart, at a power-of-two distance, may compete for the same places in a cache.`

- [ ] **Step 4: Split long paragraphs.** In the Discussion, any non-table, non-list paragraph over 110 words is split into two paragraphs at a sentence boundary near its middle, without changing any word (list each split in the report). The paragraphs known to be over: "Level 4 also helps explain the twist ..." (141 words), the probe claim paragraph in `# The part left open` (the one that ends with "The run did not measure those."), and "At n = 1024 level 1 also roughly halves ..." in `# The first suspect: the cores`; check the rest with a script.

- [ ] **Step 5: Tighten one duplicate.** In `# The twist: streaming`, the paragraph beginning "[Level 5](crate::streaming) exists to make the problem possible when the matrices do not fit in memory, not to make it faster when they do, and the chapter says so." repeats the section's lead. Replace that first sentence only with: `The [level 5](crate::streaming) chapter says so.` and keep the rest ("The reference run measures it only on matrices that fit. It copies tiles into buffers, and at the two largest sizes it was faster than level 3 at every thread count, as level 4 was. ...").

- [ ] **Step 6: Accounting and verification.** Sentence-level comparison before/after (strip headings and table rows): allowed differences are exactly Step 2's reworded sentences, Step 3's split, Step 5's replaced sentence; paragraph splits add no sentence. Run the tests, build and check; `grep -c "<table" web/site/dist/discussion/index.html` must print 12; `grep -c "{{" web/site/dist/discussion/index.html` must print 0.

- [ ] **Step 7: Commit.** `git add docs/paper/discussion.md && git commit -m "tabulate the culprit times and shorten the long sentences"`.

---

### Task 3: The Conclusion's verdict as bullets, and the Abstract's long sentence

**Files:**
- Modify: `docs/paper/conclusion.md` (section `# The verdict`)
- Modify: `docs/paper/abstract.md`

- [ ] **Step 1: Baseline** (multiset and copies of both pages).

- [ ] **Step 2: Conclusion.** Replace the two paragraphs of `# The verdict` with the bulleted form below. Every sentence of the old two paragraphs appears once, word for word, in the bullet named; the only additions are the bold leads. (Keep the paragraph's sentence order.)

```markdown
- **The cores.** The cores were not the main cause: at the largest size, the cache-friendly
  level on one thread beat the simplest threaded level at every thread count.
- **Memory.** Most of the one-thread gain came from reordering the loops and blocking for the
  cache, which on one thread at n = {{env largest}} made level 2
  {{speedup cache_friendly/naive t=1}} faster than the textbook loop; the vector kernel then
  took a smaller step, a further {{speedup simd/cache_friendly t=1}}.
- **Threads.** Threads helped the blocked, vector and streaming levels until the physical
  cores ran out, and little beyond.
- **Packing.** Level 4, which copies each block of the second matrix first, was within a tenth
  of level 3 at the two smaller sizes, neither always ahead, and faster at every thread count
  at the two largest.
- **Streaming.** Level 5, built for a different reason (matrices that do not fit in memory),
  was likewise about as fast as level 3 on matrices that do at the two smaller sizes and faster
  at the two largest, and level 4 recovered most of that lead. Streaming was the fastest case
  measured, natively at the largest size on four threads: {{speedup streaming/naive t=4}}
  faster than the textbook loop, against {{speedup simd/naive}} for level 3 with all of its
  threads.
- **The same answer.** In the reference run, timed in the [Results](crate::results) and
  compared in the [Discussion](crate::discussion), every case returned the same result,
  whatever the level, the thread count or the environment.
- **The counters.** Counting events on one thread, level 4 had
  {{countratio l1d_misses simd/packed n=1024}} fewer L1 misses than level 3 at n = 1024 and took
  about the same cycles; at the largest size it had {{countratio l1d_misses simd/packed}} fewer,
  sent far fewer loads past the L2, and took {{countratio cycles simd/packed}} fewer cycles, in
  step with its shorter time.
- **The browser.** In the browser, at the largest size, the single-threaded build ran more
  slowly than native code at levels 2 to 5, by an amount that depended on the level; levels 3
  and 4, which are written around vector registers, came closest, level 3 at
  {{gflops simd lite}} against {{gflops simd t=1}} natively. Levels 0 and 1 ran about as fast
  in the browser as natively at the largest size.
```

The old text is the source of truth: before editing, read the current two paragraphs and make sure each sentence you place is the existing one (the above was copied from the page as it stood at commit `9197c16`). If the page differs, use the page's words. Keep a blank line before the list and never join list lines when wrapping.

- [ ] **Step 3: Abstract.** In the second paragraph, the first sentence ("The obvious suspect, too few cores, is cleared early: the simplest threaded version took {{ms threaded t=8}} on all {{env threads_native}} hardware threads, more than the {{ms cache_friendly t=1}} that a version of the loop that merely walks memory in a better order needs on one.") is 54 words. Split at the colon: `The obvious suspect, too few cores, is cleared early. The simplest threaded version took {{ms threaded t=8}} on all {{env threads_native}} hardware threads, more than the {{ms cache_friendly t=1}} that a version of the loop that merely walks memory in a better order needs on one.` Then check the Abstract's other sentences over 40 words with a script; split any at a semicolon or colon the same way (punctuation only), listing each.

- [ ] **Step 4: Accounting and verification.** Placeholder multiset unchanged for both pages. Sentence comparison: the only differences are the Abstract splits (punctuation) and the bold leads. `web/dev/node.sh site npm test`, build, check; the verdict renders as a list of 8 items (count `<li>` in the built conclusion page: it must rise by exactly 8 relative to before the task).

- [ ] **Step 5: Commit.** `git add docs/paper/conclusion.md docs/paper/abstract.md && git commit -m "write the verdict as bullets and split the abstract's longest sentence"`.

---

### Task 4: Terms, reading path and the "Level N of 5" wording

**Files:**
- Modify: `docs/paper/primer.md` (terms table)
- Modify: `docs/paper/introduction.md` (`# How to read this`)
- Modify: `docs/levels/naive.md`, `threaded.md`, `cache_friendly.md`, `simd.md`, `packed.md`, `streaming.md` (the bold lead of the first line only)

- [ ] **Step 1: Baseline.**

- [ ] **Step 2: Primer terms.** Read the table `# Terms used in the chapters` first. For each of these terms that has no row yet, append a row (a term already defined, for example under "hardware thread", is not duplicated):

```markdown
| last-level cache (LLC) | the largest cache, shared by all the cores (usually the L3); a load that misses it goes to main memory |
| cycle | one tick of the processor's clock; a cycle count measures time in ticks |
| instructions per cycle (IPC) | how many instructions the core finishes per cycle; a high figure means it is rarely waiting |
| TLB | a small cache of the translations from a program's addresses to physical memory; a miss costs a lookup |
| STREAM triad | a standard test of memory bandwidth: it streams three large arrays and measures bytes per second |
```

No numbers, no placeholders, no link to a missing page. Keep the table's existing rows and column format.

- [ ] **Step 3: Reading path.** In `docs/paper/introduction.md`, `# How to read this`, add this paragraph after the first paragraph of the section:

```markdown
Short on time? Read this page, then [level 2](crate::cache_friendly), where most of the gain
arrives, then the summary at the top of the [Discussion](crate::discussion) and the
[Conclusion](crate::conclusion). That is about fifteen minutes.
```

(The sentence "where most of the gain arrives" is the existing, tested claim: 'most of the one-thread gain arrives with level 2'.)

- [ ] **Step 4: Level wording.** In each of the six level pages, only the first line's bold lead changes: `**Level N of 5.**` becomes `**Level N, of levels 0 to 5.**` (N is the page's number). Everything after the lead on that line, and every other line, is unchanged. First `grep -rn "Level [0-9] of 5\|of 5\." --include=*.md --include=*.mjs --include=*.rs --include=*.astro . 2>/dev/null | grep -v node_modules | grep -v dist` and report every hit: if any code or test depends on that exact text (for example a step-through title, an animation caption or a test), change that too and report it; if the text appears in `anim/` files or docs outside the six pages, report it and leave it.

- [ ] **Step 5: Verify.** `cargo test --doc` (30 pass), `web/dev/node.sh site npm test`, build, check. Placeholder multisets of the primer and introduction unchanged.

- [ ] **Step 6: Commit.** `git add docs/paper/primer.md docs/paper/introduction.md docs/levels/*.md && git commit -m "define the missing terms, add a reading path and fix the level wording"`.

---

### Task 5: Results: one question per callout, and a way past the method

**Files:**
- Modify: `docs/paper/results.md`

- [ ] **Step 1: Baseline.** Also run `grep -rn "results/#\|#native\|#what-was-measured" docs web/site/site.config.mjs web/site/src --include=*.md --include=*.mjs --include=*.astro | grep -v node_modules` and report who links into the page.

- [ ] **Step 2: Skip link.** After the opening paragraph (the one beginning "These are the measurements the case rests on") add: `Short on time? Skip to [Native](#native) for the tables and come back to [What was measured](#what-was-measured) when a number needs context.` Verify that the built page has headings with the ids `native` and `what-was-measured` (`grep -o 'id="native"\|id="what-was-measured"' web/site/dist/results/index.html`); if the ids differ, use the real ones.

- [ ] **Step 3: One question per Predict callout.** Replace the callouts exactly:
  - Under `# Native`: `> **Predict.** With all the threads, which level will be fastest, and how many times faster than level 0?`
  - Under `# Throughput against matrix size, native`: `> **Predict.** Doubling n makes the arithmetic eight times larger. If a level's throughput (operations per second) stays the same as n grows, the machine is doing the same work per second on a larger problem; if it falls, something got in the way. Which level's throughput will fall most?`
  - The callouts under `# Thread scaling, native` and `# In the browser` already ask one question each: leave them.

  The questions removed from the throughput callout ("Does the time grow eight times?", "On one thread, is level 1 faster than level 0? How much faster is level 2 than level 0, and is the gap bigger at the smaller size or the larger?") are not repeated anywhere else on the page; report that they are dropped.

- [ ] **Step 4: Verify.** Placeholder multiset unchanged. Tests, build, check; the page still has the same number of tables and charts as before (compare `grep -c "<table\|<svg" web/site/dist/results/index.html` before and after).

- [ ] **Step 5: Commit.** `git add docs/paper/results.md && git commit -m "ask one question per prediction and add a skip link"`.

---

### Task 6: A progress marker on every page of the paper

**Files:**
- Create: `web/site/src/components/progress.mjs`
- Create: `web/site/src/components/progress.test.mjs`
- Modify: `web/site/src/pages/[...slug].astro`
- Modify: `web/site/src/layouts/Page.astro`
- Modify: `web/site/src/styles/site.css`

**Interfaces:**
- Consumes: `chapters` from `web/site/site.config.mjs` (entries `{ id, title, route, section }`; ids `paper/abstract`, `paper/introduction`, `paper/primer`, `levels/naive`, `levels/threaded`, `levels/cache_friendly`, `levels/simd`, `levels/packed`, `levels/streaming`, `paper/results`, `paper/discussion`, `paper/conclusion`).
- Produces: `progressLabel(chapters, index)` returning a string; the `Page` layout takes an optional `progress` prop.

- [ ] **Step 1: Write the failing test** `web/site/src/components/progress.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chapters } from '../../site.config.mjs';
import { progressLabel } from './progress.mjs';

const at = (id) => chapters.findIndex((chapter) => chapter.id === id);

test('level chapters say which level they are and how many there are', () => {
  assert.equal(progressLabel(chapters, at('levels/naive')), 'Level 0, of levels 0 to 5');
  assert.equal(progressLabel(chapters, at('levels/simd')), 'Level 3, of levels 0 to 5');
  assert.equal(progressLabel(chapters, at('levels/streaming')), 'Level 5, of levels 0 to 5');
});

test('every other chapter says its place in the reading order', () => {
  assert.equal(progressLabel(chapters, at('paper/abstract')), `Page 1 of ${chapters.length}`);
  assert.equal(progressLabel(chapters, at('paper/conclusion')), `Page ${chapters.length} of ${chapters.length}`);
  assert.equal(progressLabel(chapters, at('paper/results')), `Page ${at('paper/results') + 1} of ${chapters.length}`);
});

test('the label counts the level chapters, not a fixed six', () => {
  const fake = [
    { id: 'paper/a' }, { id: 'levels/x' }, { id: 'levels/y' }, { id: 'paper/b' },
  ];
  assert.equal(progressLabel(fake, 2), 'Level 1, of levels 0 to 1');
});
```

- [ ] **Step 2: Run it and see it fail.** `web/dev/node.sh site node --test src/components/progress.test.mjs` fails with a missing-module error (if `node.sh` cannot run a bare `node` command, use `web/dev/node.sh site npm test` and read the failure).

- [ ] **Step 3: Implement** `web/site/src/components/progress.mjs`:

```js
// A short "where am I" label for a chapter: the level chapters say which level of the six they
// are (levels are numbered from 0, in the order they appear in `chapters`), every other
// chapter says its place in the reading order.
export function progressLabel(chapters, index) {
  const chapter = chapters[index];
  if (chapter.id.startsWith('levels/')) {
    const levels = chapters.filter((c) => c.id.startsWith('levels/'));
    const level = levels.findIndex((c) => c.id === chapter.id);
    return `Level ${level}, of levels 0 to ${levels.length - 1}`;
  }
  return `Page ${index + 1} of ${chapters.length}`;
}
```

- [ ] **Step 4: Run the tests and see them pass.**

- [ ] **Step 5: Wire it in.** In `web/site/src/pages/[...slug].astro` import `progressLabel` from `../components/progress.mjs` and add `progress: progressLabel(chapters, index)` to the props of `getStaticPaths`' return value, then pass `progress={progress}` to `<Page ...>`. In `web/site/src/layouts/Page.astro` add `progress?: string | null` to `Props` (default none), and render `{progress && <p class="progress">{progress}</p>}` immediately after the `<h1>` (the page must keep exactly one `<h1>`; do not add another heading). Add a small `.progress` rule to `web/site/src/styles/site.css` next to the pager rules (muted colour using the stylesheet's existing colour variables, small font, no extra margin above the first paragraph beyond what the h1 has). Read the existing files first to match their style; the layout is shared with the playground page, which passes no `progress` and must render unchanged.

- [ ] **Step 6: Verify.** `web/dev/node.sh site npm test` (the new tests count: expect 160 pass), build, check; `grep -c 'class="progress"' web/site/dist/index.html web/site/dist/levels/simd/index.html web/site/dist/conclusion/index.html` prints 1 each; `grep -c 'class="progress"' web/site/dist/playground/index.html` prints 0; the text on the simd page is `Level 3, of levels 0 to 5`.

- [ ] **Step 7: Commit.** `git add web/site/src && git commit -m "show where each page sits in the paper"`.

---

### Task 7: A "What the measurements found" strip on each level chapter

**Files:**
- Modify: `web/site/site.config.mjs`
- Create: `web/site/src/results/findings.test.mjs` (or a name that fits `web/site/src/results/*.test.mjs`)

**Interfaces:**
- Consumes: `substitute(text, data)` from `web/site/src/results/lookup.mjs`; `results` (already exported from `site.config.mjs`); the existing `insertions` array in `site.config.mjs` (entries `{ chapter, afterHeading, html, blocksAfter? }`, spliced at `index + 1 + blocksAfter` by `src/plugins/remark-rustdoc.mjs`, as raw HTML nodes that are NOT run through the placeholder pass).
- Produces: `levelFindings`, an exported map from chapter id to a plain-text string with placeholders, and one generated insertion per level chapter.

The level chapters are rustdoc as well as site pages, so the strip lives in the config, never in `docs/levels/*.md`, and is resolved at build time (a bad placeholder fails the build).

- [ ] **Step 1: Read first.** Read `web/site/site.config.mjs` (the `insertions` array and its comments about block counts), `web/site/src/plugins/remark-rustdoc.mjs` lines around the insertion splice, and the first heading of each `docs/levels/*.md` page. Decide, per chapter, the `afterHeading` and `blocksAfter` that place the strip directly under the chapter's first heading and BEFORE any video or demo already inserted there (an existing insertion at the same heading shifts the position: the comments in the config explain; check the rendered order in the built page).

- [ ] **Step 2: Write the failing test** `web/site/src/results/findings.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chapters, insertions, levelFindings } from '../../site.config.mjs';

const levelChapters = chapters.filter((chapter) => chapter.id.startsWith('levels/'));

test('every level chapter has a findings strip', () => {
  for (const chapter of levelChapters) assert.ok(levelFindings[chapter.id], chapter.id);
  assert.equal(Object.keys(levelFindings).length, levelChapters.length);
});

test('each strip is generated with its numbers filled in', () => {
  for (const chapter of levelChapters) {
    const strips = insertions.filter((i) => i.chapter === chapter.id && i.html.includes('class="findings"'));
    assert.equal(strips.length, 1, chapter.id);
    const html = strips[0].html;
    assert.ok(!html.includes('{{'), `${chapter.id}: unresolved placeholder`);
    assert.ok(!/NaN|undefined/.test(html), `${chapter.id}: bad value`);
    assert.ok(/[0-9]/.test(html), `${chapter.id}: no number rendered`);
    assert.ok(!html.includes('crate::'), `${chapter.id}: crate:: link text`);
    assert.ok(!html.includes('<step-through'), `${chapter.id}: looks like a demo`);
  }
});

test('each strip sits under a heading that exists in the chapter', () => {
  for (const chapter of levelChapters) {
    const strip = insertions.find((i) => i.chapter === chapter.id && i.html.includes('class="findings"'));
    const markdown = readFileSync(new URL(`../../../../docs/${chapter.id}.md`, import.meta.url), 'utf8');
    assert.ok(markdown.split('\n').some((line) => line.replace(/^#+\s*/, '') === strip.afterHeading && line.startsWith('#')), chapter.id);
  }
});
```

Check how `insertions` entries name the chapter (the field `chapter` may hold the chapter id such as `levels/simd`; adapt the test to the real field names and the real heading-matching rule of the plugin before you write it) and run it: it fails because `levelFindings` is not exported.

- [ ] **Step 3: Implement** in `site.config.mjs`: import `substitute` from `./src/results/lookup.mjs`; export `levelFindings` with exactly these strings (plain text with placeholders; no Markdown, no HTML, escape nothing: they contain no `&` or `<`):

```js
export const levelFindings = {
  'levels/naive': 'At n = {{env largest}} the textbook loop took {{ms naive}}.',
  'levels/threaded': 'At n = {{env largest}} it took {{ms threaded t=1}} on one thread, {{ms threaded t=4}} on four threads and {{ms threaded t=8}} on eight.',
  'levels/cache_friendly': 'At n = {{env largest}} it took {{ms cache_friendly t=1}} on one thread, which is faster than level 1 on every thread count (it took {{ms threaded t=8}} on eight threads).',
  'levels/simd': 'At n = {{env largest}} it took {{ms simd t=1}} on one thread and {{ms simd}} on {{env threads_native}} threads, which is {{speedup simd/naive}} faster than the textbook loop.',
  'levels/packed': 'At n = {{env largest}} it took {{ms packed t=1}} on one thread, against level 3\'s {{ms simd t=1}}. At the two largest sizes it was faster than level 3 at every thread count.',
  'levels/streaming': 'At n = {{env largest}} it took {{ms streaming t=4}} on four threads, {{speedup streaming/naive t=4}} faster than the textbook loop: the fastest case measured at that size.',
};
```

Each comparison in these strings is already a tested claim: level 2 faster than level 1 at every thread count ('the first clue'); `speedup` figures are numbers; level 4 faster than level 3 at the two largest sizes at every thread count ('level 4 (packing) against level 3: a lead only at the two largest sizes'); level 5 on four threads fastest at the largest size ('level 5 on four threads, natively, is the fastest case measured at the largest size'). Do not add any other comparison word. Then append to `insertions` one entry per level chapter, built with `substitute`:

```js
...Object.entries(levelFindings).map(([chapter, text]) => ({
  chapter,
  afterHeading: /* the heading you chose in Step 1 */,
  blocksAfter: /* the offset you chose */,
  html: `<aside class="findings"><strong>What the measurements found.</strong> ${substitute(text, results)}</aside>`,
})),
```

(use whatever object shape the existing entries have; the heading and offset may differ per level). Add a `.findings` rule to `web/site/src/styles/site.css` (a quiet boxed note: left border in an existing accent colour variable, small padding, readable in dark mode like the other callouts; read the stylesheet to reuse its variables).

- [ ] **Step 4: Run the tests** (the findings tests and the whole suite): expect pass. Then build and check; open `web/site/dist/levels/<each>/index.html` and confirm: the strip appears once per level page, directly under its first heading, before any `<step-through` element (use a Python slice to compare the positions), with no `{{`.

- [ ] **Step 5: Make sure nothing leaked into rustdoc.** `grep -c "findings\|What the measurements found" docs/levels/*.md` prints 0 for every file; `cargo test --doc` passes; `git diff --stat` shows no `docs/levels` change in this task.

- [ ] **Step 6: Commit.** `git add web/site && git commit -m "add a measurements strip to each level chapter"`.

---

### Task 8: Verify everything and re-measure

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full verification.** `cargo test` (doctests and the rest), `web/dev/node.sh site npm test` (expect the 157 tests plus the new ones), build, check. On the built site: `grep -c "{{" web/site/dist/{index,introduction,primer,results,discussion,conclusion}/index.html` prints 0 for each; the discussion has 12 tables; the conclusion's verdict renders as a list; every level page has one `findings` aside and one `progress` paragraph.

- [ ] **Step 2: Re-measure.** A script (scratchpad, `python3 -I`) reports for the Abstract, Conclusion and Discussion: words, mean and 90th-percentile sentence length (a `{{...}}` is one token; ignore table rows and headings), share of sentences over 30 words, longest paragraph and the number of paragraphs over 100 words. Report them beside the figures at the start of this plan (read them from `git show 9197c16:<file>`).

- [ ] **Step 3: Read it as a first-time reader**, page by page in reading order, and report: whether each page now opens with its point; whether the Discussion's summary agrees with the Abstract, Introduction and Conclusion (same scope for every claim); whether the level legend and the primer's new rows make the numbers decodable; anything that reads as an editing slip.

- [ ] **Step 4: Report** what changed, the before/after numbers, and any sentence reworded beyond this plan, to the user, with real output for any failure.
