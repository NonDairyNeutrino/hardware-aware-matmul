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
