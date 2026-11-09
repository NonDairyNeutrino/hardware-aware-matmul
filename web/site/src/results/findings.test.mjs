import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chapters, insertions, levelFindings } from '../../site.config.mjs';

const levelChapters = chapters.filter((chapter) => chapter.id.startsWith('levels/'));
const isStrip = (insertion) => insertion.html.includes('class="findings"');

// The chapter's first heading as the plugin matches it: an ATX heading outside code fences
// (rustdoc's hidden `# ` lines sit inside fences), compared by plain text, so inline-code
// backticks do not count.
function firstHeading(id) {
  const markdown = readFileSync(new URL(`../../../../docs/${id}.md`, import.meta.url), 'utf8');
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (!fenced && /^#{1,6}\s/.test(line)) return line.replace(/^#+\s*/, '').replaceAll('`', '').trim();
  }
  return null;
}

test('every level chapter has a findings strip', () => {
  for (const chapter of levelChapters) assert.ok(levelFindings[chapter.id], chapter.id);
  assert.equal(Object.keys(levelFindings).length, levelChapters.length);
});

test('the findings text is HTML-safe plain text', () => {
  for (const [id, text] of Object.entries(levelFindings)) {
    assert.ok(!/[&<>]/.test(text), `${id}: markup in the text`);
  }
});

test('each strip is generated with its numbers filled in', () => {
  for (const chapter of levelChapters) {
    const strips = insertions.filter((i) => i.chapter === chapter.id && isStrip(i));
    assert.equal(strips.length, 1, chapter.id);
    const html = strips[0].html;
    assert.ok(!html.includes('{{'), `${chapter.id}: unresolved placeholder`);
    assert.ok(!/NaN|undefined/.test(html), `${chapter.id}: bad value`);
    assert.ok(/[0-9]/.test(html), `${chapter.id}: no number rendered`);
    assert.ok(!html.includes('crate::'), `${chapter.id}: crate:: link text`);
    assert.ok(!html.includes('<step-through'), `${chapter.id}: looks like a demo`);
  }
});

test('each strip sits directly under the chapter\'s first heading, before anything else inserted there', () => {
  for (const chapter of levelChapters) {
    const index = insertions.findIndex((i) => i.chapter === chapter.id && isStrip(i));
    const strip = insertions[index];
    assert.equal(strip.afterHeading, firstHeading(chapter.id), chapter.id);
    assert.equal(strip.blocksAfter ?? 0, 0, chapter.id);
    // Insertions are spliced in order, each at heading + 1 + blocksAfter, so a later one at the
    // same spot would land above the strip.
    const later = insertions.slice(index + 1).filter(
      (i) => i.chapter === chapter.id && i.afterHeading === strip.afterHeading && (i.blocksAfter ?? 0) === 0,
    );
    assert.equal(later.length, 0, `${chapter.id}: an insertion after the strip lands above it`);
  }
});
