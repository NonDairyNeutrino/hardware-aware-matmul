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
