import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chapters } from '../../site.config.mjs';
import { progressLabel } from './progress.mjs';

const at = (id) => chapters.findIndex((chapter) => chapter.id === id);

test('level chapters say their place in the reading order, like every other chapter', () => {
  for (const id of ['levels/naive', 'levels/simd', 'levels/streaming']) {
    assert.equal(progressLabel(chapters, at(id)), `Page ${at(id) + 1} of ${chapters.length}`);
  }
});

test('every other chapter says its place in the reading order', () => {
  assert.equal(progressLabel(chapters, at('paper/abstract')), `Page 1 of ${chapters.length}`);
  assert.equal(progressLabel(chapters, at('paper/conclusion')), `Page ${chapters.length} of ${chapters.length}`);
  assert.equal(progressLabel(chapters, at('paper/results')), `Page ${at('paper/results') + 1} of ${chapters.length}`);
});

test('the label depends only on the position in the given list', () => {
  assert.equal(progressLabel([{ id: 'a' }, { id: 'levels/x' }, { id: 'b' }], 1), 'Page 2 of 3');
});
