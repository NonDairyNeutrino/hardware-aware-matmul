import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { base, chapters, insertions, links, results } from '../../site.config.mjs';
import remarkGlossary, { escapeHtml, loadTerms, parseTerms, splitTerm, termPattern } from './remark-glossary.mjs';
import remarkRustdoc from './remark-rustdoc.mjs';

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
    out.includes('<span class="term" tabindex="0" aria-describedby="g-1"><span>thread</span><span class="tip" role="tooltip" id="g-1" hidden>a sequence of instructions</span></span>'),
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
  assert.ok(out.includes('<span class="tip" role="tooltip" id="g-1" hidden>x &amp; y &lt; z &gt; w &quot;q&quot;</span>'), out);
  assert.ok(out.includes('aria-describedby="g-2"') && out.includes('id="g-2" hidden>fast</span>'), out);
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
const unmarked = {
  'memory-bound': 'the chapters describe the two limits without using the word',
  'compute-bound': 'the chapters describe the two limits without using the word',
  axpy: 'always written as code (`axpy`), and code is never marked',
  LLC: 'the chapters spell out "last-level cache", which is marked',
  IPC: 'the chapters spell out "instructions per cycle", which is marked',
  prefetch: 'the chapters say "prefetcher", which is marked',
};

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
  assert.match(css, /\.term \.tip::before \{[^}]*bottom: 100%/);
  assert.match(css, /@media \(max-width: 40rem\) \{\s*\.term \.tip \{[^}]*position: fixed/);
  assert.doesNotMatch(css, /\.term[^{]*\{[^}]*outline: (none|0)/, 'the focus outline stays on terms');
});
