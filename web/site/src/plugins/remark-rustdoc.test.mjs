import assert from 'node:assert/strict';
import { test } from 'node:test';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import remarkRustdoc, { chapterId, cleanRustFence } from './remark-rustdoc.mjs';

const links = {
  naive: 'levels/naive/',
  threaded: 'levels/threaded/',
  'streaming::TileSource': null,
  TileSource: null,
  matmul: null,
};

async function render(markdown, options = {}, path = '/repo/docs/levels/naive.md') {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRustdoc, { base: '/site/', links, ...options })
    .use(remarkStringify);
  return String(await processor.process({ value: markdown, path }));
}

test('removes rustdoc-hidden lines and unescapes ## inside rust fences only', () => {
  const rust = ['let x = 1;', '# Ok::<(), E>(())', '#', '## shown', '#[derive(Debug)]', '  # indented hidden'].join('\n');
  assert.equal(cleanRustFence(rust), ['let x = 1;', '# shown', '#[derive(Debug)]'].join('\n'));
});

test('leaves other fences alone', async () => {
  const out = await render('```sh\n# a comment\ncargo test\n```\n\n```rust\n# hidden\nfn main() {}\n```\n');
  assert.match(out, /# a comment/);
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

test('an insertion can follow the paragraph after its heading', async () => {
  const insertions = [{ chapter: 'levels/naive', afterHeading: 'Two', blocksAfter: 1, html: '<p>TABLE</p>' }];
  const out = await render('# One\n\n# Two\n\nIntro.\n\nMore.\n', { insertions });
  assert.ok(out.indexOf('Intro.') < out.indexOf('TABLE') && out.indexOf('TABLE') < out.indexOf('More.'), out);
  await assert.rejects(
    render('# Two\n\nIntro.\n', { insertions: [{ ...insertions[0], blocksAfter: 5 }] }),
    /fewer than 5 blocks/,
  );
});

test('a placeholder that does not resolve fails the build, naming the file', async () => {
  await assert.rejects(render('Took {{ms simd n=999}}.', { results }), /naive\.md: unresolvable placeholder "\{\{ms simd n=999\}\}"/);
});

test('a placeholder with no results data fails the build', async () => {
  await assert.rejects(render('Took {{ms simd}}.'), /no results data/);
});

test('demotes headings one level', async () => {
  const out = await render('# One\n\n## Two\n');
  assert.match(out, /^## One$/m);
  assert.match(out, /^### Two$/m);
});

test('rewrites inline crate:: links to routes under the base, and null to plain text', async () => {
  const out = await render('See [the naive level](crate::naive) and [the trait](crate::streaming::TileSource).\n');
  assert.match(out, /\[the naive level\]\(\/site\/levels\/naive\/\)/);
  assert.doesNotMatch(out, /crate::/);
  assert.match(out, /the trait/);
  assert.doesNotMatch(out, /\]\(.*TileSource/);
});

test('resolves reference-style links and removes their definitions', async () => {
  const out = await render('Use [`TileSource`] or [`threaded`].\n\n[`TileSource`]: crate::streaming::TileSource\n[`threaded`]: crate::threaded\n');
  assert.match(out, /\[`threaded`\]\(\/site\/levels\/threaded\/\)/);
  assert.match(out, /`TileSource`/);
  assert.doesNotMatch(out, /crate::/);
  assert.doesNotMatch(out, /^\[`/m);
});

test('resolves shortcut references that have no definition, in paragraphs and tables', async () => {
  const out = await render('The [`naive`] level, then [`matmul`].\n\n| a |\n|---|\n| [`threaded`] |\n');
  assert.match(out, /\[`naive`\]\(\/site\/levels\/naive\/\)/);
  assert.match(out, /\[`threaded`\]\(\/site\/levels\/threaded\/\)/);
  assert.match(out, /`matmul`/);
  assert.doesNotMatch(out, /\[`matmul`\]/);
});

test('links a shortcut that is followed by a colon in running text', async () => {
  const out = await render('1. [`naive`]: the algorithm, and why it is slow.\n');
  assert.match(out, /\[`naive`\]\(\/site\/levels\/naive\/\): the algorithm/);
});

test('does not touch ordinary links or brackets', async () => {
  const out = await render('Visit [Rust](https://rust-lang.org), see [1], and `[x]`.\n');
  assert.match(out, /\[Rust\]\(https:\/\/rust-lang\.org\)/);
  assert.match(out, /\[1\]/);
});

test('an unlisted link fails the build with a message naming it', async () => {
  await assert.rejects(render('[x](crate::mystery::Thing)\n'), /unresolvable doc link "crate::mystery::Thing"/);
  await assert.rejects(render('A [`Mystery`] shortcut.\n'), /unresolvable doc link "Mystery"/);
});

test('inserts html after the named heading, for the named chapter only', async () => {
  const insertions = [{ chapter: 'levels/naive', afterHeading: 'The idea', html: '<figure>FIG</figure>' }];
  const naive = await render('# The idea\n\nText.\n', { insertions });
  assert.match(naive, /## The idea\n\n<figure>FIG<\/figure>\n\nText\./);
  const other = await render('# The idea\n\nText.\n', { insertions }, '/repo/docs/levels/threaded.md');
  assert.doesNotMatch(other, /FIG/);
});

test('an insertion whose heading is missing fails the build', async () => {
  const insertions = [{ chapter: 'levels/naive', afterHeading: 'No such heading', html: '<p/>' }];
  await assert.rejects(render('# The idea\n', { insertions }), /no heading "No such heading"/);
});

test('chapterId finds the path under docs/', () => {
  assert.equal(chapterId('/repo/docs/levels/naive.md'), 'levels/naive');
  assert.equal(chapterId('/docs/introduction.md'), 'introduction');
  assert.equal(chapterId('/elsewhere/x.md'), null);
  assert.equal(chapterId('/home/u/docs/proj/docs/levels/naive.md'), 'levels/naive');
});

test('a placeholder split by markup fails the build', async () => {
  await assert.rejects(render('Took {{ms *simd*}}.', { results }), /naive\.md: unresolved "\{\{" in text/);
});

test('a resolved placeholder and a lone brace are fine; literal braces in code are untouched', async () => {
  const out = await render('Took {{ms simd}} and {single} and `{{x}}`.\n\n```text\n{{ms *simd*}}\n```\n', { results });
  assert.match(out, /Took 250 ms and \{single\} and/);
  assert.ok(out.includes('{{x}}'));
  assert.ok(out.includes('{{ms *simd*}}'));
});
