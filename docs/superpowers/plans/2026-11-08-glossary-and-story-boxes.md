# Glossary Tooltips and Story Boxes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every primer term's definition in place, as a CSS-only tooltip at its first use on each chapter, and open each level chapter with an always-visible "story box" saying what the reader already has and what this level asks.

**Architecture:** A new remark plugin, `web/site/src/plugins/remark-glossary.mjs`, parses the primer's `# Terms used in the chapters` table once when the site is configured and, on every `levels/` and `paper/` chapter except the primer, wraps the first plain-prose use of each term in an inline HTML span with a tooltip; it runs after `remark-rustdoc` in `astro.config.mjs`. The story boxes are data (`levelStory` in `web/site/site.config.mjs`) turned into one raw-HTML insertion per level chapter, appended after the findings strips so that each box lands above its chapter's strip. Styling is two small blocks in `site.css`; `check-dist.mjs` gains checks for both features.

**Tech Stack:** Astro 7 site (`web/site`), remark/unified (mdast), `node --test`, plain CSS. Node runs only in Docker through `web/dev/node.sh`.

Spec: `docs/superpowers/specs/2026-11-08-glossary-and-story-boxes-design.md`.

## Global Constraints

Copied from the spec's Constraints section:

- The core invariant and all Rust code are untouched; `results.json` is untouched; `docs/levels/*.md` stay byte-identical (they are rustdoc modules).
- `claims.test.mjs` coverage: any comparison stated in words must be tested. Story and glossary text states none of its own: it only names clues the strips and level pages already state. The one comparison it may repeat is "level 2 on one thread beats level 1 on every thread", covered by the test "the first clue" (line 323).
- Node runs only through `web/dev/node.sh`.
- `check-dist.mjs` rules hold: one `<h1>`, no `<script>` without a demo, no `crate::`, no `{{`, and no NaN/undefined/Infinity/null on paper pages, so no definition or story text may contain those words (the glossary test checks this).

And for this plan:

- **Commands** (repo root; the build takes minutes): `web/dev/node.sh site npm test`, `web/dev/node.sh site npm run build`, `web/dev/node.sh site npm run check`. No other way of running Node.
- **Never join lines of a Markdown list, table or heading** when editing or rewrapping Markdown: after any edit to a `.md` file, confirm each table row and bullet still starts its own line.
- **No numbers, no placeholders** in primer definitions or story text; no `{{` anywhere in them; no `&`, `<`, `>` in story text (it is inserted as raw HTML unescaped).
- **Do not touch** `src/`, `tests/`, `examples/`, `docs/levels/`, `docs/introduction.md`, `web/site/src/data/results.json`, `web/site/src/results/claims.test.mjs`.
- **Commits:** one per task on branch `glossary-story`, a short one-line message, then a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No merge, no push.
- **Test count:** 165 pass at the start; Task 2 adds 11, Task 3 adds 3, Task 4 adds 7 (186 at the end).

## Decisions that refine the spec

Found while reading the code and running a prototype of this plan against the real pages; each task below already follows them.

1. **Plural endings.** Matching is by whole word, case-insensitive, longest first, with an optional plural `s` or `es` (`threads`, `misses`, `memory pages`). Without it, several terms (`memory page`, `broadcast`, `lane`) are never marked, because the chapters use the plural. A word inside a longer word or a hyphenated or snake_case compound (`threaded`, `cache-friendly`, `cache_friendly`) is not a match.
2. **Primer row cells.** The spec's "L1/L2/L3 cache" row is written `L1, L2, L3` (the comma rule gives three terms that match "L1", "the L2", "L3" in prose); "page (memory page)" is written `memory page` only, because the bare term "page" would mark "this page" (a web page) on the Results, Discussion and Introduction; "prefetch" is written `prefetch, prefetcher`, because the chapters only say "prefetcher".
3. **Phone width.** `left: 0` with `max-width: min(22rem, calc(100vw - 2rem))` still lets a tooltip run off the right edge when the term sits near it, so below `40rem` the tooltip is shown fixed across the bottom of the screen, inside the gutters.
4. **`remark-gfm` becomes a declared devDependency** (version `4.0.1`, already installed as a dependency of `@astrojs/markdown-remark` and already in `package-lock.json`), so the tests parse tables the way the site does and can check that table cells are skipped.
5. **`check-dist.mjs`** also fails a primer with any marked term and a page with repeated tooltip ids (cheap, and they guard the spec's rules).

---

### Task 1: Primer: eight new term rows

**Files:**
- Modify: `docs/paper/primer.md:117` (append after the `| STREAM triad | ... |` row, the last row of the `# Terms used in the chapters` table, lines 89 to 117)

**Interfaces:**
- Consumes: nothing.
- Produces: the primer table's rows that Task 2's parser reads. After this task the table's term cells, in order, split into exactly these 44 terms: `cache`, `cache line`, `evict`, `stride`, `strided`, `contiguous`, `reuse`, `bandwidth`, `memory-bound`, `compute-bound`, `hardware thread`, `register`, `vector register`, `lane`, `vectorise`, `register blocking`, `block`, `tile`, `hit`, `miss`, `GFLOP/s`, `axpy`, `work queue`, `thread`, `SIMD`, `last-level cache`, `LLC`, `cycle`, `instructions per cycle`, `IPC`, `TLB`, `STREAM triad`, `L1`, `L2`, `L3`, `FMA`, `fused multiply-add`, `micro-kernel`, `packing`, `broadcast`, `memory page`, `prefetch`, `prefetcher`, `speedup`.

The primer is a site-only paper page (not rustdoc), so no doctest is involved. These eight rows are the only edits to `primer.md`. Never join lines of the table: each row stays one line starting with `|`.

- [ ] **Step 1: Baseline.** Run `grep -c "{{" docs/paper/primer.md` and note the number (placeholders must not change). Run `sed -n '89,119p' docs/paper/primer.md` and confirm line 117 is `| STREAM triad | a standard test of memory bandwidth: it streams three large arrays and measures bytes per second |` and line 119 is `That is the whole toolkit. [Level 0](crate::naive) is where the case starts.`

- [ ] **Step 2: Append the rows.** Insert these eight lines immediately after line 117 (before the blank line 118), with no blank line between them and the table:

```markdown
| L1, L2, L3 | the levels of cache, from the smallest and fastest, private to one core, to the largest and slowest, usually shared by the cores |
| FMA (fused multiply-add) | one instruction that multiplies and adds with a single rounding, so its result can differ from a separate multiply and add |
| micro-kernel | the innermost routine that updates a small block of the output held in vector registers |
| packing | copying a block of a matrix into a contiguous buffer, laid out in the order the code reads it |
| broadcast | copying one value into every lane of a vector register |
| memory page | the unit in which the operating system maps a program's addresses to physical memory; each page in use needs a TLB entry |
| prefetch, prefetcher | fetching data into the cache before the code asks for it; a prefetcher is hardware that does this when it spots a regular pattern of accesses |
| speedup | how many times faster one case is than another: the slower time divided by the faster |
```

- [ ] **Step 3: Verify.**

Run: `git diff --numstat docs/paper/primer.md`
Expected: `8	0	docs/paper/primer.md`

Run: `git diff docs/paper/primer.md | grep '^+|' | grep -c '[0-9]'`
Expected: `1` (only the `L1, L2, L3` row has digits, and they are names, not figures).

Run: `grep -c "{{" docs/paper/primer.md`
Expected: the number noted in Step 1.

Run: `sed -n '113,127p' docs/paper/primer.md`
Expected: 13 lines that each start with `|`, then a blank line, then `That is the whole toolkit. ...`.

Run: `git diff docs/paper/primer.md | grep -E '^\+.*\b(NaN|undefined|Infinity|null)\b'`
Expected: no output.

- [ ] **Step 4: Commit.**

```bash
git add docs/paper/primer.md
git commit -m "define the remaining chapter terms in the primer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The glossary plugin, its unit tests and its registration

**Files:**
- Create: `web/site/src/plugins/remark-glossary.mjs`
- Create: `web/site/src/plugins/remark-glossary.test.mjs`
- Modify: `web/site/package.json` (devDependencies), `web/site/package-lock.json:14-18` (the root package's devDependencies)
- Modify: `web/site/astro.config.mjs:1-4` (imports) and `:42` (the `processor:` line)

**Interfaces:**
- Consumes: `chapterId(path)` from `web/site/src/plugins/remark-rustdoc.mjs` (returns `"levels/naive"` for `.../docs/levels/naive.md`, `null` for a file not under `docs/`); the primer table from Task 1 (44 terms, listed in Task 1's Interfaces).
- Produces, all from `web/site/src/plugins/remark-glossary.mjs`:
  - `splitTerm(cell: string): string[]`
  - `parseTerms(markdown: string): {term: string, meaning: string}[]` (throws `primer: no "# Terms used in the chapters" table`, `... table has no rows`, `primer: malformed terms row "..."`)
  - `loadTerms(path: string): {term, meaning}[]` (a file path; reads and parses)
  - `escapeHtml(text: string): string` (escapes `& < > "`)
  - `marksChapter(id: string|null): boolean`
  - `termPattern(terms): RegExp|null` (global, case-insensitive; group 1 is the term as written)
  - default export `remarkGlossary({ terms })`, a remark plugin.
  - Markup of a marked term (exact): `<span class="term" tabindex="0" aria-describedby="g-N"><span>WORD</span><span class="tip" role="tooltip" id="g-N">DEFINITION</span></span>`, `N` counting from 1 per page.
  - `web/site/src/plugins/remark-glossary.test.mjs` with helpers `docsPath(id)`, `primerPath`, `terms`, `render`, `renderPlain`, `marked` that Task 3 extends.

How the site renders a chapter: `astro.config.mjs` runs `remarkRustdoc` (placeholders to numbers, `crate::` links rewritten, headings demoted, site insertions spliced in as raw `html` nodes) and, after this task, `remarkGlossary`. Raw `html` nodes are output verbatim, so the plugin emits the tooltip markup as inline `html` nodes and never marks inside existing ones.

- [ ] **Step 1: Declare `remark-gfm`.** It is already installed (`web/site/node_modules/remark-gfm`, version 4.0.1, a dependency of `@astrojs/markdown-remark`) and already has a `node_modules/remark-gfm` entry in `package-lock.json`. In `web/site/package.json` replace

```json
  "devDependencies": {
    "remark-parse": "11.0.0",
```

with

```json
  "devDependencies": {
    "remark-gfm": "4.0.1",
    "remark-parse": "11.0.0",
```

and in `web/site/package-lock.json` (the root package, `"packages": { "": { ... } }`, lines 14 to 18) replace

```json
      "devDependencies": {
        "remark-parse": "11.0.0",
```

with

```json
      "devDependencies": {
        "remark-gfm": "4.0.1",
        "remark-parse": "11.0.0",
```

(CI runs `npm ci`, which needs the two files to agree; do not run `npm install`.)

- [ ] **Step 2: Write the failing test** `web/site/src/plugins/remark-glossary.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import remarkGlossary, { escapeHtml, loadTerms, parseTerms, splitTerm } from './remark-glossary.mjs';

const docsPath = (id) => fileURLToPath(new URL(`../../../../docs/${id}.md`, import.meta.url));
const primerPath = docsPath('paper/primer');

const terms = [
  { term: 'cache', meaning: 'a small, fast memory' },
  { term: 'cache line', meaning: 'the block moved at once' },
  { term: 'last-level cache', meaning: 'the largest cache' },
  { term: 'thread', meaning: 'a sequence of instructions' },
  { term: 'miss', meaning: 'a fetch from slower memory' },
];

async function render(markdown, options = { terms }, path = '/repo/docs/paper/discussion.md') {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkGlossary, options).use(remarkStringify);
  return String(await processor.process({ value: markdown, path }));
}

async function renderPlain(markdown) {
  return String(await unified().use(remarkParse).use(remarkGfm).use(remarkStringify).process(markdown));
}

// The words wrapped as terms, in page order, as written in the text.
const marked = (out) => [...out.matchAll(/<span class="term"[^>]*><span>([^<]*)<\/span>/g)].map((m) => m[1]);

test('splits comma-joined cells and parenthesised forms into separate terms', () => {
  assert.deepEqual(splitTerm('block, tile'), ['block', 'tile']);
  assert.deepEqual(splitTerm('memory-bound, compute-bound'), ['memory-bound', 'compute-bound']);
  assert.deepEqual(splitTerm('last-level cache (LLC)'), ['last-level cache', 'LLC']);
  assert.deepEqual(splitTerm('FMA (fused multiply-add)'), ['FMA', 'fused multiply-add']);
  assert.deepEqual(splitTerm('cache'), ['cache']);
});

test('reads every term of the primer, each with a definition', () => {
  const parsed = loadTerms(primerPath);
  assert.deepEqual(parsed.map((t) => t.term), [
    'cache', 'cache line', 'evict', 'stride', 'strided', 'contiguous', 'reuse', 'bandwidth',
    'memory-bound', 'compute-bound', 'hardware thread', 'register', 'vector register', 'lane',
    'vectorise', 'register blocking', 'block', 'tile', 'hit', 'miss', 'GFLOP/s', 'axpy',
    'work queue', 'thread', 'SIMD', 'last-level cache', 'LLC', 'cycle', 'instructions per cycle',
    'IPC', 'TLB', 'STREAM triad', 'L1', 'L2', 'L3', 'FMA', 'fused multiply-add', 'micro-kernel',
    'packing', 'broadcast', 'memory page', 'prefetch', 'prefetcher', 'speedup',
  ]);
  for (const { term, meaning } of parsed) assert.ok(meaning.length > 0, term);
  const meaningOf = (term) => parsed.find((t) => t.term === term).meaning;
  assert.equal(meaningOf('block'), meaningOf('tile'));
  assert.equal(meaningOf('LLC'), meaningOf('last-level cache'));
  assert.ok(!meaningOf('axpy').includes('`'), 'backticks are dropped');
});

test('no definition contains a word the site check forbids on paper pages', () => {
  for (const { term, meaning } of loadTerms(primerPath)) {
    assert.doesNotMatch(meaning, /\b(NaN|undefined|Infinity|null)\b/, term);
  }
});

test('a primer without the terms table, with an empty one or with a bad row fails', () => {
  assert.throws(() => parseTerms('# Something else\n\nText.\n'), /no "# Terms used in the chapters" table/);
  assert.throws(() => parseTerms('# Terms used in the chapters\n\n| Term | Meaning |\n|---|---|\n\nText.\n'), /has no rows/);
  assert.throws(() => parseTerms('# Terms used in the chapters\n\n| Term | Meaning |\n|---|---|\n| cache | |\n'), /malformed terms row/);
});

test('a marked term is a focusable span with its definition as a tooltip', async () => {
  const out = await render('A thread.\n');
  assert.ok(
    out.includes('<span class="term" tabindex="0" aria-describedby="g-1"><span>thread</span><span class="tip" role="tooltip" id="g-1">a sequence of instructions</span></span>'),
    out,
  );
});

test('marks only the first use of a term on a page', async () => {
  const out = await render('A thread runs. Another thread waits.\n\nA third thread.\n');
  assert.deepEqual(marked(out), ['thread']);
  assert.match(out, /A <span class="term"/);
  assert.match(out, /Another thread waits\.\n\nA third thread\./);
});

test('leaves code, headings, links, table cells and raw html alone', async () => {
  const markdown = [
    '# The thread heading',
    '',
    'Code `thread` and [a thread link](https://example.com).',
    '',
    '```text',
    'thread',
    '```',
    '',
    '| thread |',
    '|---|',
    '| thread |',
    '',
    '<p>a thread in html</p>',
    '',
    'Finally a thread.',
    '',
  ].join('\n');
  const out = await render(markdown);
  assert.deepEqual(marked(out), ['thread']);
  assert.match(out, /Finally a <span class="term"/);
  assert.match(out, /<p>a thread in html<\/p>/);
});

test('the longest term wins, and a marked term is not marked again inside a longer one', async () => {
  const out = await render('The last-level cache is shared. Each cache line is small. The cache holds copies. The cache line again.\n');
  assert.deepEqual(marked(out), ['last-level cache', 'cache line', 'cache']);
});

test('matches whole words in any case, with a plural ending, and nothing inside other words', async () => {
  const out = await render('Threaded code, cache_friendly and cache-friendly loops. Misses were counted. Caches help.\n');
  assert.deepEqual(marked(out), ['Misses', 'Caches']);
});

test('the definition is escaped and the tooltip ids are unique on the page', async () => {
  const out = await render('A thread and a cache.\n', {
    terms: [{ term: 'thread', meaning: 'x & y < z > w "q"' }, { term: 'cache', meaning: 'fast' }],
  });
  assert.ok(out.includes('<span class="tip" role="tooltip" id="g-1">x &amp; y &lt; z &gt; w &quot;q&quot;</span>'), out);
  assert.ok(out.includes('aria-describedby="g-2"') && out.includes('id="g-2">fast</span>'), out);
  assert.equal(escapeHtml('<&>"'), '&lt;&amp;&gt;&quot;');
});

test('the primer, and pages outside levels/ and paper/, are left unchanged', async () => {
  const markdown = 'A thread and a cache line.\n';
  const plain = await renderPlain(markdown);
  assert.equal(await render(markdown, { terms }, '/repo/docs/paper/primer.md'), plain);
  assert.equal(await render(markdown, { terms }, '/repo/docs/introduction.md'), plain);
  assert.equal(await render(markdown, { terms }, '/repo/docs/guide/in_memory.md'), plain);
  assert.notEqual(await render(markdown, { terms }, '/repo/docs/levels/naive.md'), plain);
  const primer = readFileSync(primerPath, 'utf8');
  assert.equal(await render(primer, { terms: loadTerms(primerPath) }, primerPath), await renderPlain(primer));
});
```

- [ ] **Step 3: Run it and see it fail.**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "remark-glossary|ERR_MODULE_NOT_FOUND|^ℹ (pass|fail)"`
Expected: a failure for `src/plugins/remark-glossary.test.mjs` with `ERR_MODULE_NOT_FOUND` (cannot find `remark-glossary.mjs`), `ℹ fail 1`, and the other 165 tests passing.

- [ ] **Step 4: Implement** `web/site/src/plugins/remark-glossary.mjs`:

```js
// Shows the primer's definitions in place: the first plain-prose use of each defined term on a
// chapter becomes a focusable span whose definition appears on hover or keyboard focus (CSS
// only, no script, so a chapter without a demo stays script-free).
//
// The terms come from the primer's "Terms used in the chapters" table (docs/paper/primer.md),
// read once when the site is configured; a primer without that table FAILS the build. A cell
// such as "block, tile" gives two terms, "last-level cache (LLC)" gives the long form and the
// short one, and every term of a row shares its meaning (backticks dropped).
//
// Runs after remark-rustdoc, so placeholders are numbers and crate:: links are rewritten.
// Applies to chapters under levels/ and paper/, except the primer (it defines the terms).
// Matching is by whole word, in any case, longest term first, with an optional plural "s" or
// "es"; code, headings, link text, table cells and raw HTML (every insertion from
// site.config.mjs) are never marked, and a term is marked once per page.
import { readFileSync } from 'node:fs';
import { chapterId } from './remark-rustdoc.mjs';

const TABLE_HEADING = '# Terms used in the chapters';

/** The terms of one table cell: "a, b" gives both, "long (SHORT)" gives the long form and SHORT. */
export function splitTerm(cell) {
  const paren = /^(.*?)\s*\(([^)]*)\)$/.exec(cell.trim());
  const forms = paren ? [paren[1], paren[2]] : [cell];
  return forms.flatMap((form) => form.split(',')).map((term) => term.trim()).filter(Boolean);
}

/** [{ term, meaning }] from the primer's Markdown; throws if the table is missing, empty or malformed. */
export function parseTerms(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === TABLE_HEADING);
  if (start === -1) throw new Error(`primer: no "${TABLE_HEADING}" table`);
  const table = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) table.push(line);
    else if (table.length > 0 || line.trim() !== '') break;
  }
  if (table.length < 3) throw new Error(`primer: the "${TABLE_HEADING}" table has no rows`);
  // table[0] is the header row, table[1] the |---| separator.
  return table.slice(2).flatMap((line) => {
    const cells = line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
    const meaning = (cells[1] ?? '').replaceAll('`', '').trim();
    if (cells.length !== 2 || cells[0] === '' || meaning === '') {
      throw new Error(`primer: malformed terms row "${line}"`);
    }
    return splitTerm(cells[0]).map((term) => ({ term, meaning }));
  });
}

/** The terms of the primer at `path` (a file path). */
export function loadTerms(path) {
  return parseTerms(readFileSync(path, 'utf8'));
}

export function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Whether the chapter with this id (see chapterId) gets its terms marked. */
export function marksChapter(id) {
  return id !== null && (id.startsWith('levels/') || id.startsWith('paper/')) && id !== 'paper/primer';
}

/**
 * One global, case-insensitive regex matching any of the terms as a whole word (not inside a
 * longer word or a hyphenated or snake_case compound), longest first, with an optional plural
 * "s"/"es". Group 1 is the term as written; null when there are no terms.
 */
export function termPattern(terms) {
  const alternatives = [...new Set(terms.map(({ term }) => term.toLowerCase()))]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  if (alternatives.length === 0) return null;
  return new RegExp(`(?<![\\w-])(${alternatives.join('|')})(?:e?s)?(?![\\w-])`, 'gi');
}

// Node types whose text is never marked (their whole subtree is skipped).
const SKIP = new Set(['heading', 'link', 'linkReference', 'tableCell', 'inlineCode', 'code', 'html']);

/**
 * @param {object} options
 * @param {{term: string, meaning: string}[]} options.terms  from loadTerms
 */
export default function remarkGlossary({ terms = [] } = {}) {
  const meanings = new Map(terms.map(({ term, meaning }) => [term.toLowerCase(), meaning]));
  const pattern = termPattern(terms);
  return (tree, file) => {
    if (pattern === null || !marksChapter(chapterId(file.path))) return;
    const used = new Set();
    const mark = (node) => {
      const parts = [];
      let last = 0;
      for (const match of node.value.matchAll(pattern)) {
        const key = match[1].toLowerCase();
        if (used.has(key)) continue;
        used.add(key);
        const id = `g-${used.size}`;
        if (match.index > last) parts.push({ type: 'text', value: node.value.slice(last, match.index) });
        parts.push({
          type: 'html',
          value:
            `<span class="term" tabindex="0" aria-describedby="${id}"><span>${escapeHtml(match[0])}</span>` +
            `<span class="tip" role="tooltip" id="${id}">${escapeHtml(meanings.get(key))}</span></span>`,
        });
        last = match.index + match[0].length;
      }
      if (parts.length === 0) return [node];
      if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
      return parts;
    };
    // Depth-first, in document order, so "first" means first on the page.
    const walk = (parent) => {
      parent.children = parent.children.flatMap((child) => {
        if (child.type === 'text') return mark(child);
        if (child.children && !SKIP.has(child.type)) walk(child);
        return [child];
      });
    };
    walk(tree);
  };
}
```

(A match of a term already marked is skipped but still consumes its words, so in "the cache line again" after `cache line` was marked, the "cache" inside it is not marked either.)

- [ ] **Step 5: Run the tests and see them pass.**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `ℹ tests 176`, `ℹ pass 176`, `ℹ fail 0`.

- [ ] **Step 6: Register the plugin.** In `web/site/astro.config.mjs` replace lines 1 to 4

```js
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import remarkRustdoc from './src/plugins/remark-rustdoc.mjs';
import { base, insertions, links, results } from './site.config.mjs';
```

with

```js
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import remarkGlossary, { loadTerms } from './src/plugins/remark-glossary.mjs';
import remarkRustdoc from './src/plugins/remark-rustdoc.mjs';
import { base, insertions, links, results } from './site.config.mjs';

// The primer's terms, shown as tooltips in the chapters (remark-glossary runs after
// remark-rustdoc). Read once here: a primer without its terms table fails the build.
const terms = loadTerms(fileURLToPath(new URL('../../docs/paper/primer.md', import.meta.url)));
```

and replace the line

```js
    processor: unified({ remarkPlugins: [[remarkRustdoc, { base, links, insertions, results }]] }),
```

with

```js
    processor: unified({
      remarkPlugins: [[remarkRustdoc, { base, links, insertions, results }], [remarkGlossary, { terms }]],
    }),
```

(`../../docs` from `web/site/` is the repo's `docs/` on the host and `/docs` in the container, which `web/dev/node.sh` mounts read-only; a prototype confirmed the config loads with this path and fails with `ENOENT ... /docs/paper/primer.md` when the file is missing.)

- [ ] **Step 7: Build and check.**

Run: `web/dev/node.sh site npm run build 2>&1 | tail -5` then `web/dev/node.sh site npm run check`
Expected: the build completes; `check-dist: PASS (N pages)`.

Run: `grep -o 'class="term"' web/site/dist/discussion/index.html | wc -l; grep -c 'class="term"' web/site/dist/primer/index.html`
Expected: a number of at least 10, then `0`.

(Terms show as plain text with no styling until Task 3 adds the CSS; the tooltip text is visible inline until then. That is expected.)

- [ ] **Step 8: Commit.**

```bash
git add web/site/src/plugins/remark-glossary.mjs web/site/src/plugins/remark-glossary.test.mjs web/site/astro.config.mjs web/site/package.json web/site/package-lock.json
git commit -m "mark the primer's terms in the chapters with their definitions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Glossary on the real chapters, the dead-term check and the tooltip CSS

**Files:**
- Modify: `web/site/src/plugins/remark-glossary.test.mjs` (the import block at the top, and three tests appended at the end)
- Modify: `web/site/src/styles/site.css` (append after line 243, the `.findings` rule, which is the last line)

**Interfaces:**
- Consumes: from `web/site/src/plugins/remark-glossary.mjs` (Task 2): default `remarkGlossary({ terms })`, `loadTerms(path)`, `termPattern(terms)` (global case-insensitive `RegExp`, group 1 = the term as written, optional plural `s`/`es` after it). From the existing test file (Task 2): `docsPath(id)`, `primerPath`, `marked(out)` (the wrapped words, in order). From `web/site/site.config.mjs`: `base`, `chapters` (entries `{ id, title, route, section }`), `insertions`, `links`, `results`. From `web/site/src/plugins/remark-rustdoc.mjs`: default `remarkRustdoc({ base, links, insertions, results })`.
- Produces: the CSS classes `.term` and `.tip` styled; the `unmarked` exception map in the test file.

Markup the CSS styles (emitted by the plugin): `<span class="term" tabindex="0" aria-describedby="g-N"><span>WORD</span><span class="tip" role="tooltip" id="g-N">DEFINITION</span></span>`. The site's colour custom properties are `--bg`, `--fg`, `--muted`, `--accent`, `--border`, `--code-bg` (redefined for dark mode under `prefers-color-scheme: dark` at the top of `site.css`) and `--gutter` (`1rem`). Line 37 of `site.css` sets `:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }`; keep it working on `.term` (never set `outline: none`).

- [ ] **Step 1: Extend the imports.** At the top of `web/site/src/plugins/remark-glossary.test.mjs` replace

```js
import { unified } from 'unified';
import remarkGlossary, { escapeHtml, loadTerms, parseTerms, splitTerm } from './remark-glossary.mjs';
```

with

```js
import { unified } from 'unified';
import { base, chapters, insertions, links, results } from '../../site.config.mjs';
import remarkGlossary, { escapeHtml, loadTerms, parseTerms, splitTerm, termPattern } from './remark-glossary.mjs';
import remarkRustdoc from './remark-rustdoc.mjs';
```

- [ ] **Step 2: Write the failing tests.** Append to the end of the same file (note `unmarked` starts empty: the run in Step 3 tells you which terms no chapter uses):

```js
// The real chapters, through the same plugins as the site (remark-rustdoc first).
async function renderChapter(id, glossaryTerms) {
  const path = docsPath(id);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRustdoc, { base, links, insertions, results })
    .use(remarkGlossary, { terms: glossaryTerms })
    .use(remarkStringify);
  return String(await processor.process({ value: readFileSync(path, 'utf8'), path }));
}

// Primer terms that no chapter marks, each with the reason. Found by running the test below.
const unmarked = {};

test('every primer term is marked on at least one chapter, except the listed ones', async () => {
  const primerTerms = loadTerms(primerPath);
  const pattern = new RegExp(termPattern(primerTerms).source, 'i');
  const found = new Set();
  for (const chapter of chapters) {
    for (const word of marked(await renderChapter(chapter.id, primerTerms))) {
      found.add(pattern.exec(word)[1].toLowerCase());
    }
  }
  const dead = primerTerms.map((t) => t.term).filter((term) => !found.has(term.toLowerCase()));
  assert.deepEqual(dead.sort(), Object.keys(unmarked).sort());
});

test('on the real chapters the discussion marks terms, the primer none, and tooltip ids are unique', async () => {
  const primerTerms = loadTerms(primerPath);
  for (const chapter of chapters) {
    const out = await renderChapter(chapter.id, primerTerms);
    const ids = [...out.matchAll(/class="tip" role="tooltip" id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${chapter.id}: duplicate tooltip ids`);
    if (chapter.id === 'paper/primer') assert.equal(ids.length, 0, 'the primer marks no terms');
    if (chapter.id === 'paper/discussion') assert.ok(ids.length >= 10, `the discussion marks only ${ids.length} terms`);
  }
});

test('the stylesheet shows a tooltip on hover and focus, inside a phone-width screen', () => {
  const css = readFileSync(new URL('../styles/site.css', import.meta.url), 'utf8');
  assert.match(css, /\.term \{[^}]*position: relative/);
  assert.match(css, /\.term \.tip \{[^}]*display: none/);
  assert.match(css, /\.term:hover \.tip, \.term:focus \.tip \{[^}]*display: block/);
  assert.match(css, /\.term \.tip \{[^}]*max-width: min\(22rem, calc\(100vw - 2rem\)\)/);
  assert.match(css, /\.term \.tip \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 40rem\) \{\s*\.term \.tip \{[^}]*position: fixed/);
  assert.doesNotMatch(css, /\.term[^{]*\{[^}]*outline: (none|0)/, 'the focus outline stays on terms');
});
```

- [ ] **Step 3: Run them and see two fail.**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "^✖|^ℹ (tests|pass|fail)|actual|expected|\+|\-" | head -40`
Expected: `ℹ tests 179`, `ℹ fail 2`:
  - `every primer term is marked on at least one chapter, except the listed ones` fails; the diff shows the actual list `[ 'IPC', 'LLC', 'axpy', 'compute-bound', 'memory-bound', 'prefetch' ]` against `[]`.
  - `the stylesheet shows a tooltip ...` fails on the first `assert.match`.
  - `on the real chapters ...` passes.

If the actual dead list differs from those six, stop and find out why before going on: check with `grep -n -i -w "<term>" docs/paper/*.md docs/levels/*.md` whether the word really appears only in code, headings, links, tables or not at all. Never add an exception whose reason is not true of the pages, and never edit `docs/levels/*.md` to make a term appear.

- [ ] **Step 4: Record the exceptions.** In the test file replace `const unmarked = {};` with

```js
const unmarked = {
  'memory-bound': 'the chapters describe the two limits without using the word',
  'compute-bound': 'the chapters describe the two limits without using the word',
  axpy: 'always written as code (`axpy`), and code is never marked',
  LLC: 'the chapters spell out "last-level cache", which is marked',
  IPC: 'the chapters spell out "instructions per cycle", which is marked',
  prefetch: 'the chapters say "prefetcher", which is marked',
};
```

- [ ] **Step 5: Add the CSS.** Append to the end of `web/site/src/styles/site.css` (after line 243):

```css

/* Glossary: a term the primer defines shows its definition on hover or keyboard focus, with no
   script (src/plugins/remark-glossary.mjs marks its first use on each page). The :focus-visible
   outline set at the top of this file stays on. */
.term { position: relative; text-decoration: underline dotted; text-decoration-color: var(--muted); text-underline-offset: 0.2em; cursor: help; }
.term .tip { display: none; position: absolute; left: 0; top: 100%; z-index: 5; width: max-content; max-width: min(22rem, calc(100vw - 2rem)); margin-top: 0.3rem; padding: 0.45rem 0.7rem; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 2px 8px rgb(0 0 0 / 0.2); font-size: 0.9rem; font-style: normal; font-weight: normal; line-height: 1.45; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.term:hover .tip, .term:focus .tip { display: block; }
/* On a narrow screen a tooltip anchored at the term could run past the right edge, so it is shown
   across the bottom of the screen instead, inside the page gutters. */
@media (max-width: 40rem) {
  .term .tip { position: fixed; left: var(--gutter); right: var(--gutter); top: auto; bottom: var(--gutter); width: auto; max-width: none; }
}
```

(Colours come only from the custom properties, so dark mode follows automatically. `font-weight: normal` keeps a tooltip plain when the term sits inside bold text. Text decoration does not propagate to the absolutely or fixed positioned `.tip`, so the definition is not underlined.)

- [ ] **Step 6: Run the tests and see them pass.**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `ℹ tests 179`, `ℹ pass 179`, `ℹ fail 0`.

- [ ] **Step 7: Build, check and look.**

Run: `web/dev/node.sh site npm run build 2>&1 | tail -3` then `web/dev/node.sh site npm run check`
Expected: `check-dist: PASS (N pages)`.

Run: `grep -o '<span class="term"[^>]*><span>[^<]*</span><span class="tip"[^>]*>[^<]*</span></span>' web/site/dist/discussion/index.html | head -3`
Expected: three complete term spans, the first of them for "thread" with the definition "an independent sequence of instructions that the program runs".

Run: `grep -c '<script' web/site/dist/discussion/index.html web/site/dist/levels/naive/index.html web/site/dist/levels/packed/index.html`
Expected: `0` for each (chapters without a demo stay script-free).

- [ ] **Step 8: Commit.**

```bash
git add web/site/src/plugins/remark-glossary.test.mjs web/site/src/styles/site.css
git commit -m "style the glossary tooltips and check every term is used" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Story boxes on the level chapters

**Files:**
- Modify: `web/site/site.config.mjs` (after line 118, the end of `findingsHeading`; and lines 219 to 225, the end of `insertions`)
- Create: `web/site/src/results/story.test.mjs`
- Modify: `web/site/src/results/findings.test.mjs:209-213` (one exemption)
- Modify: `web/site/src/styles/site.css` (append at the end)

**Interfaces:**
- Consumes: in `web/site/site.config.mjs`: `chapters` (level ids `levels/naive`, `levels/threaded`, `levels/cache_friendly`, `levels/simd`, `levels/packed`, `levels/streaming`), the private `findingsHeading` map (chapter id to its first heading: `'The idea'`, `'What changed from level 0'`, `'What changed from level 1'`, `'What changed from level 2'`, `'What changed from level 3'`, `'The problem'`), and `insertions` (entries `{ chapter, afterHeading, html, blocksAfter? }`; `src/plugins/remark-rustdoc.mjs` splices each, in array order, at heading index `+ 1 + blocksAfter`, so a later insertion at the same spot lands above an earlier one). The findings strips are the last entries today, built from `levelFindings`, with `blocksAfter: 0` and html starting `<aside class="findings">`.
- Produces: `export const levelStory` in `site.config.mjs`, a map from the six level ids to `{ label, so_far, this_level }` (`label` is `'The case:'` for `levels/naive`, `'So far:'` for the rest), and one insertion per level chapter whose html is exactly `<aside class="story"><p><strong>${label}</strong> ${so_far}</p><p><strong>This level:</strong> ${this_level}</p></aside>`.

The story text is plain and condensed from sentences already on the level pages (their opening paragraphs and "What changed"/"What it costs" sections); it has no numbers, no placeholders, no `&`, `<` or `>`, and goes through no `substitute`. Its only comparison is "level 2 on one thread beat level 1 on every thread" (in the `levels/simd` box), covered by the test "the first clue" in `web/site/src/results/claims.test.mjs`; do not add any other comparison word. Do not edit `docs/levels/*.md`. The result under each level chapter's first heading is: story box, measurements strip, then the videos and demos already there.

- [ ] **Step 1: Write the failing test** `web/site/src/results/story.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import remarkRustdoc from '../plugins/remark-rustdoc.mjs';
import { base, chapters, insertions, levelStory, links, results } from '../../site.config.mjs';

const levelChapters = chapters.filter((chapter) => chapter.id.startsWith('levels/'));
const isStory = (insertion) => insertion.html.includes('class="story"');
const isStrip = (insertion) => insertion.html.includes('class="findings"');

test('every level chapter has a story, and nothing else does', () => {
  assert.deepEqual(Object.keys(levelStory).sort(), levelChapters.map((chapter) => chapter.id).sort());
});

test('level 0 opens the case; the other levels say what came before', () => {
  for (const chapter of levelChapters) {
    const want = chapter.id === 'levels/naive' ? 'The case:' : 'So far:';
    assert.equal(levelStory[chapter.id].label, want, chapter.id);
  }
});

test('the story text is plain: no placeholders, numbers, bad values or markup', () => {
  for (const [id, story] of Object.entries(levelStory)) {
    for (const text of [story.so_far, story.this_level]) {
      assert.ok(text.trim().length > 0, `${id}: empty text`);
      assert.ok(!text.includes('{{'), `${id}: a placeholder`);
      assert.doesNotMatch(text, /\b(NaN|undefined|Infinity|null)\b/, `${id}: a bad value`);
      assert.doesNotMatch(text, /[&<>]/, `${id}: markup in the text`);
      assert.doesNotMatch(text.replace(/[Ll]evels? \d/g, ''), /\d/, `${id}: a number`);
    }
  }
});

test('each level chapter has one story box, with its label and "This level:"', () => {
  for (const chapter of levelChapters) {
    const boxes = insertions.filter((i) => i.chapter === chapter.id && isStory(i));
    assert.equal(boxes.length, 1, chapter.id);
    const html = boxes[0].html;
    assert.ok(html.startsWith('<aside class="story">') && html.endsWith('</aside>'), chapter.id);
    assert.ok(html.includes(`<p><strong>${levelStory[chapter.id].label}</strong> `), `${chapter.id}: label`);
    assert.ok(html.includes('<p><strong>This level:</strong> '), `${chapter.id}: "This level:"`);
  }
});

test('each story box is spliced after its strip, at the same spot, and nothing after it lands above it', () => {
  for (const chapter of levelChapters) {
    const storyAt = insertions.findIndex((i) => i.chapter === chapter.id && isStory(i));
    const stripAt = insertions.findIndex((i) => i.chapter === chapter.id && isStrip(i));
    assert.ok(stripAt !== -1 && storyAt > stripAt, `${chapter.id}: the story box must come after the strip in insertions`);
    const story = insertions[storyAt];
    assert.equal(story.afterHeading, insertions[stripAt].afterHeading, chapter.id);
    assert.equal(story.blocksAfter ?? 0, 0, chapter.id);
    // Insertions are spliced in order, each at heading + 1 + blocksAfter, so a later one at the
    // same spot would land above the story box.
    const later = insertions.slice(storyAt + 1).filter(
      (i) => i.chapter === chapter.id && i.afterHeading === story.afterHeading && (i.blocksAfter ?? 0) === 0,
    );
    assert.equal(later.length, 0, `${chapter.id}: an insertion after the story box lands above it`);
  }
});

test('rendered, each level chapter opens its first section with the story box, then the strip', async () => {
  for (const chapter of levelChapters) {
    const path = fileURLToPath(new URL(`../../../../docs/${chapter.id}.md`, import.meta.url));
    const processor = unified().use(remarkParse).use(remarkRustdoc, { base, links, insertions, results }).use(remarkStringify);
    const blocks = String(await processor.process({ value: readFileSync(path, 'utf8'), path })).split('\n\n');
    const heading = insertions.find((i) => i.chapter === chapter.id && isStory(i)).afterHeading;
    const at = blocks.indexOf(`## ${heading}`);
    assert.ok(at !== -1, `${chapter.id}: heading "${heading}" not found`);
    assert.ok(blocks[at + 1].startsWith('<aside class="story">'), `${chapter.id}: ${blocks[at + 1].slice(0, 60)}`);
    assert.ok(blocks[at + 2].startsWith('<aside class="findings">'), `${chapter.id}: ${blocks[at + 2].slice(0, 60)}`);
  }
});

test('the story box is styled apart from the findings strip', () => {
  const css = readFileSync(new URL('../styles/site.css', import.meta.url), 'utf8');
  assert.match(css, /\.story \{[^}]*border-left: 4px solid var\(--series-2\)/);
  assert.match(css, /\.findings \{[^}]*border-left: 4px solid var\(--accent\)/);
});
```

- [ ] **Step 2: Run it and see it fail.**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "story.test|levelStory|^ℹ (tests|pass|fail)"`
Expected: `src/results/story.test.mjs` fails with `SyntaxError: The requested module '../../site.config.mjs' does not provide an export named 'levelStory'`; `ℹ fail 1`; every other test passes.

- [ ] **Step 3: Add the stories.** In `web/site/site.config.mjs`, right after the `findingsHeading` map (it ends at line 118 with `  'levels/streaming': 'The problem',` and `};`), insert:

```js

// Where the reader is in the case, one box per level chapter, above the measurements strip: what
// the chapters before have found (level 0: what the case is), and what this level asks. Plain
// text condensed from the level pages, with no numbers and no placeholders (it goes through no
// substitute). The one comparison it repeats, level 2 on one thread against level 1 on every
// thread, is the claim tested as 'the first clue' in src/results/claims.test.mjs.
export const levelStory = {
  'levels/naive': {
    label: 'The case:',
    so_far: 'The textbook loop is correct and easy to read, and every other level is measured against it. It is also far from what the processor can do, and nothing in the code says why.',
    this_level: 'Set out the baseline: one thread, three nested loops, no tricks. The chapters that follow look for the reason it is slow, one suspect at a time.',
  },
  'levels/threaded': {
    label: 'So far:',
    so_far: 'Level 0 is correct but runs on one core, and its inner loop walks down a column of B, so almost every read lands on a different cache line.',
    this_level: 'Test the obvious suspect, that the loop leaves most of the cores idle, by giving every core a share of the same loop.',
  },
  'levels/cache_friendly': {
    label: 'So far:',
    so_far: "Adding threads did not fix the loop, so the number of cores doing the arithmetic was not what held it back. Each thread's loop is exactly as slow as level 0's.",
    this_level: 'Go after the best remaining suspect, the way the loop walks memory: reorder the loops so that each thread reads whole rows, and block for the cache so that data is reused while it is still there.',
  },
  'levels/simd': {
    label: 'So far:',
    so_far: 'Level 2 put the data close to the core, and on one thread it beat level 1 on every thread. Its inner loop still carries the output block through memory on every step.',
    this_level: 'Remove that last trip: keep a small block of the output in vector registers for the whole inner loop.',
  },
  'levels/packed': {
    label: 'So far:',
    so_far: 'Level 3 keeps a block of the output in registers, but its kernel still reads B where it lies in memory, a row apart at every step.',
    this_level: 'Copy each block of B once into a contiguous buffer, in the order the micro-kernel reads it, and ask whether the copy earns its cost back.',
  },
  'levels/streaming': {
    label: 'So far:',
    so_far: 'Every level so far asks how to make the product faster, and every one needs A, B and C to fit in memory at once.',
    this_level: 'Ask a different question: what if the matrices do not fit in memory at all? Compute the output one small tile at a time, streaming the inputs through small buffers.',
  },
};
```

Where each sentence comes from (for the reviewer; do not paste this list into the file): naive, the page's second paragraph and first line; threaded, naive's "What it costs" items 1 and 2 and threaded's second paragraph; cache_friendly, its second paragraph and threaded's "Where to go next"; simd, its second paragraph and cache_friendly's second paragraph (the tested "beat level 1 on every thread"); packed, its second and first paragraphs and simd's "Where to go next"; streaming, its second paragraph and first line, and "The problem".

Then replace the end of `insertions` (lines 219 to 225):

```js
  ...Object.entries(levelFindings).map(([chapter, text]) => ({
    chapter,
    afterHeading: findingsHeading[chapter],
    blocksAfter: 0,
    html: `<aside class="findings"><strong>What the measurements found.</strong> ${substitute(text, results)}</aside>`,
  })),
];
```

with

```js
  ...Object.entries(levelFindings).map(([chapter, text]) => ({
    chapter,
    afterHeading: findingsHeading[chapter],
    blocksAfter: 0,
    html: `<aside class="findings"><strong>What the measurements found.</strong> ${substitute(text, results)}</aside>`,
  })),
  // The story boxes come after the strips, so each lands above its chapter's strip (same heading,
  // blocksAfter 0). Under the heading: story box, measurements strip, then the videos and demos.
  ...Object.entries(levelStory).map(([chapter, { label, so_far, this_level }]) => ({
    chapter,
    afterHeading: findingsHeading[chapter],
    blocksAfter: 0,
    html: `<aside class="story"><p><strong>${label}</strong> ${so_far}</p><p><strong>This level:</strong> ${this_level}</p></aside>`,
  })),
];
```

- [ ] **Step 4: Run the tests and see the expected failures.**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "^✖|an insertion after|^ℹ (tests|pass|fail)"`
Expected: `ℹ tests 186`, `ℹ fail 2`: `the story box is styled apart from the findings strip` (no `.story` rule yet) and, in `findings.test.mjs`, `each strip sits directly under the chapter's first heading, before anything else inserted there` with `levels/naive: an insertion after the strip lands above it`. The second failure is by design: that check must now exempt the story boxes.

- [ ] **Step 5: Exempt the story box in `findings.test.mjs`.** Replace lines 209 to 213 of `web/site/src/results/findings.test.mjs`

```js
    // Insertions are spliced in order, each at heading + 1 + blocksAfter, so a later one at the
    // same spot would land above the strip.
    const later = insertions.slice(index + 1).filter(
      (i) => i.chapter === chapter.id && i.afterHeading === strip.afterHeading && (i.blocksAfter ?? 0) === 0,
    );
```

with

```js
    // Insertions are spliced in order, each at heading + 1 + blocksAfter, so a later one at the
    // same spot would land above the strip. The story box is meant to (src/results/story.test.mjs).
    const later = insertions.slice(index + 1).filter(
      (i) => i.chapter === chapter.id && i.afterHeading === strip.afterHeading && (i.blocksAfter ?? 0) === 0 &&
        !i.html.includes('class="story"'),
    );
```

Nothing else in `findings.test.mjs` changes.

- [ ] **Step 6: Add the CSS.** Append to the end of `web/site/src/styles/site.css`:

```css

/* Where the reader is in the case, boxed above a level's measurements strip. */
.story { margin: 1rem 0; padding: 0.6rem 0.9rem; border-left: 4px solid var(--series-2); background: var(--code-bg); font-size: 0.95rem; }
.story p { margin: 0 0 0.4rem; }
.story p:last-child { margin-bottom: 0; }
```

(`--series-2` is a green defined for light and dark mode in the "Results page" block of `site.css`; the findings strip uses `--accent`, blue, so the two boxes read as different things. `.story p` outranks the general `article p` margin rule.)

- [ ] **Step 7: Run the tests and see them pass.**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `ℹ tests 186`, `ℹ pass 186`, `ℹ fail 0`.

- [ ] **Step 8: Build, check, and confirm the order in the built pages.**

Run: `web/dev/node.sh site npm run build 2>&1 | tail -3` then `web/dev/node.sh site npm run check`
Expected: `check-dist: PASS (N pages)`.

Run:

```bash
for p in naive threaded cache_friendly simd packed streaming; do
  f=web/site/dist/levels/$p/index.html
  python3 -I -c 'import sys; h=open(sys.argv[1]).read(); s=h.find("<aside class=\"story\""); f=h.find("<aside class=\"findings\""); v=[i for i in (h.find("<figure class=\"video\""), h.find("<step-through"), h.find("primer-pointer")) if i!=-1]; print(sys.argv[1], h.count("<aside class=\"story\""), 0 < s < f, all(f < i for i in v) if v else "no video")' "$f"
done
```

Expected: six lines, each `... 1 True True` (the levels/streaming video is under a later heading, so for it the last field is also `True`, as the video comes after the strip in the page).

Run: `git diff --stat trunk -- docs/levels`
Expected: no output.

- [ ] **Step 9: Commit.**

```bash
git add web/site/site.config.mjs web/site/src/results/story.test.mjs web/site/src/results/findings.test.mjs web/site/src/styles/site.css
git commit -m "open each level chapter with a story box" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The site check knows both features

**Files:**
- Modify: `web/site/check-dist.mjs:16-18` (header comment) and `:107-111` (the per-chapter checks, after the `paper/` block)

**Interfaces:**
- Consumes: the built pages in `web/site/dist/` from Tasks 2 to 4. Glossary markup on a page: `<span class="term" tabindex="0" aria-describedby="g-N">...<span class="tip" role="tooltip" id="g-N">...</span></span>`; story box: `<aside class="story">`. In `check-dist.mjs`, inside `for (const chapter of chapters)`, the variables `html` (the page), `where` (route or `(home)`) and `problems` (array of messages) exist.
- Produces: four new failure messages: `${where}: no glossary term is marked` (discussion), `${where}: marks glossary terms; the primer defines them`, `${where}: duplicate glossary tooltip ids`, `${where}: N story boxes, expected 1` (each level chapter).

`check-dist.mjs` runs on the build output (`npm run check` after `npm run build`); it has no unit tests, so this task proves each new check by breaking a built page on purpose and restoring it.

- [ ] **Step 1: Add the checks.** In `web/site/check-dist.mjs`, in the header comment replace

```js
//   - a paper page (abstract, results, discussion, conclusion) with an unresolved `{{...}}`
//     placeholder or a NaN/undefined/Infinity/null where a number should be, and a Results page
//     whose count of tables or charts differs from what site.config.mjs inserts;
```

with

```js
//   - a paper page (abstract, results, discussion, conclusion) with an unresolved `{{...}}`
//     placeholder or a NaN/undefined/Infinity/null where a number should be, and a Results page
//     whose count of tables or charts differs from what site.config.mjs inserts;
//   - a Discussion with no glossary term marked, a primer with any (it defines them), a chapter
//     whose glossary tooltip ids repeat, and a level chapter without exactly one story box;
```

and right after the block

```js
  if (chapter.id.startsWith('paper/')) {
    // The pages written from the data must show real numbers.
    if (html.includes('{{')) problems.push(`${where}: contains an unresolved "{{" placeholder`);
    if (/\b(NaN|undefined|Infinity|null)\b/.test(html)) problems.push(`${where}: contains NaN, undefined, Infinity or null`);
  }
```

insert

```js
  // The glossary (src/plugins/remark-glossary.mjs) and the story boxes (levelStory in
  // site.config.mjs).
  if (chapter.id === 'paper/discussion' && !html.includes('class="term"')) problems.push(`${where}: no glossary term is marked`);
  if (chapter.id === 'paper/primer' && html.includes('class="term"')) problems.push(`${where}: marks glossary terms; the primer defines them`);
  const tipIds = [...html.matchAll(/class="tip" role="tooltip" id="([^"]+)"/g)].map((m) => m[1]);
  if (new Set(tipIds).size !== tipIds.length) problems.push(`${where}: duplicate glossary tooltip ids`);
  if (chapter.id.startsWith('levels/')) {
    const stories = (html.match(/<aside class="story"/g) ?? []).length;
    if (stories !== 1) problems.push(`${where}: ${stories} story boxes, expected 1`);
  }
```

- [ ] **Step 2: Run it on the current build and see it pass.** (The build from Task 4 is current; if `web/site/dist/` is missing or older than Task 4's commit, run `web/dev/node.sh site npm run build` first.)

Run: `web/dev/node.sh site npm run check`
Expected: `check-dist: PASS (N pages)`.

- [ ] **Step 3: Break two pages and see it fail.** Set `SCRATCH` to your scratchpad directory, then:

```bash
cp web/site/dist/discussion/index.html "$SCRATCH/discussion.html"
cp web/site/dist/levels/simd/index.html "$SCRATCH/simd.html"
sed -i 's/class="term"/class="x"/g' web/site/dist/discussion/index.html
sed -i 's/<aside class="story"/<aside class="x"/' web/site/dist/levels/simd/index.html
web/dev/node.sh site npm run check
```

Expected: exit status 1, `check-dist: FAIL`, and exactly these two problems:
` - discussion/: no glossary term is marked`
` - levels/simd/: 0 story boxes, expected 1`

- [ ] **Step 4: Restore the pages and see it pass again.**

```bash
cp "$SCRATCH/discussion.html" web/site/dist/discussion/index.html
cp "$SCRATCH/simd.html" web/site/dist/levels/simd/index.html
web/dev/node.sh site npm run check
```

Expected: `check-dist: PASS (N pages)`.

- [ ] **Step 5: Commit.**

```bash
git add web/site/check-dist.mjs
git commit -m "check the glossary and story boxes in the built site" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

**Files:** none changed unless a check fails (then fix it in the task's file, rerun everything, and commit the fix separately with a one-line message and the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line).

**Interfaces:**
- Consumes: everything from Tasks 1 to 5: the primer's 44 terms, `remark-glossary.mjs` registered in `astro.config.mjs`, `levelStory` and its insertions in `site.config.mjs`, the `.term`/`.tip`/`.story` CSS, the new `check-dist.mjs` checks.
- Produces: a report to the user.

- [ ] **Step 1: Everything green from clean.**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `ℹ tests 186`, `ℹ pass 186`, `ℹ fail 0`.

Run: `web/dev/node.sh site npm run build 2>&1 | tail -3` then `web/dev/node.sh site npm run check`
Expected: the build completes; `check-dist: PASS (N pages)`.

- [ ] **Step 2: What must not have changed.**

Run: `git diff --stat trunk -- docs/levels docs/introduction.md src tests examples web/site/src/data/results.json web/site/src/results/claims.test.mjs`
Expected: no output (the level pages are byte-identical to trunk; no Rust, data or claims change).

Run: `git diff --stat trunk`
Expected: exactly these files changed (plus the spec and this plan, committed before Task 1): `docs/paper/primer.md`, `web/site/astro.config.mjs`, `web/site/check-dist.mjs`, `web/site/package-lock.json`, `web/site/package.json`, `web/site/site.config.mjs`, `web/site/src/plugins/remark-glossary.mjs`, `web/site/src/plugins/remark-glossary.test.mjs`, `web/site/src/results/findings.test.mjs`, `web/site/src/results/story.test.mjs`, `web/site/src/styles/site.css`.

Run: `git diff trunk -- web/site/src/results/findings.test.mjs | grep -c '^[-+] '`
Expected: `5` (the one exemption: two lines removed, three added).

- [ ] **Step 3: The built site.**

Run: `grep -rl "{{" web/site/dist --include=index.html`
Expected: no output.

Run: `grep -c 'class="term"' web/site/dist/primer/index.html; grep -c '<aside class="story"' web/site/dist/levels/*/index.html`
Expected: `0`, then `1` for each of the six level pages.

Run: `grep -c '<aside class="story"' web/site/dist/discussion/index.html web/site/dist/index.html web/site/dist/playground/index.html`
Expected: `0` for each.

- [ ] **Step 4: Read the built pages as a reader would.** Run this (in your scratchpad, `python3 -I`):

```python
import html, re, sys
root = 'web/site/dist/'
def text(s): return html.unescape(re.sub(r'<[^>]+>', '', s))
for page in ['discussion/index.html', 'index.html', 'levels/naive/index.html', 'levels/simd/index.html', 'levels/streaming/index.html']:
    h = open(root + page).read()
    terms = re.findall(r'<span class="term"[^>]*><span>([^<]*)</span><span class="tip"[^>]*>([^<]*)</span></span>', h)
    print('==', page, len(terms), 'terms')
    for word, tip in terms[:6]:
        print('  ', word, '->', html.unescape(tip))
    story = re.search(r'<aside class="story">(.*?)</aside>', h, re.S)
    if story:
        print('  story:', text(story.group(1)))
    article = re.search(r'<article.*?</article>', h, re.S).group(0)
    first = re.search(r'<p>(.*?)</p>', article, re.S)
    print('  first paragraph:', text(first.group(1))[:200])
```

Expected and to report: the Discussion marks at least ten terms, its first few with the right definitions ("thread", "blocks", "cache", ...); no term inside a table, heading or link; the home page (Abstract) marks terms and loads no script (`grep -c '<script' web/site/dist/index.html` prints `0`); each level's story reads as plain prose, starts with its label ("The case:" on level 0, "So far:" elsewhere), contains "This level:", and agrees with the page it opens (no sentence that the page does not support). Read the six story boxes in order, level 0 to 5, and confirm they tell the case as the Introduction does: one suspect per level, the clue each level inherits.

- [ ] **Step 5: Phone and dark mode.** If a browser is available, open `web/site/dist/levels/packed/index.html` through a local static server for `web/site/dist` at a 360 px wide viewport in both colour schemes; focus a term with Tab and confirm the tooltip shows fully inside the screen, the focus outline is visible, and the story box and findings strip are distinct. If no browser is available, say so in the report rather than claiming it.

- [ ] **Step 6: Report** to the user: the test count, build and check results, the six unmarked terms and why, the decisions that refined the spec (plural endings, the three primer cells, the phone-width tooltip, `remark-gfm` declared, the two extra site checks), and any check that failed with its real output.
