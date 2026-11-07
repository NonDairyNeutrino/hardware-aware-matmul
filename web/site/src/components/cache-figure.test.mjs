import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheLineFigure, walkLines } from './cache-figure.mjs';

test('walking along a row uses every value of the cache lines it fetches', () => {
  const walk = walkLines(8, 4, 'row');
  assert.deepEqual(walk.lines, [0, 1]);
  assert.equal(walk.used, 8);
  assert.equal(walk.fetched, 8);
});

test('walking down a column fetches one cache line per row and uses a quarter of them', () => {
  const walk = walkLines(8, 4, 'column');
  assert.deepEqual(walk.lines, [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.equal(walk.used, 8);
  assert.equal(walk.fetched, 32);
});

test('with 8-value lines a column walk uses one value in eight', () => {
  const walk = walkLines(16, 8, 'column');
  assert.equal(walk.used / walk.fetched, 1 / 8);
});

test('a line length that does not divide the row length is rejected', () => {
  assert.throws(() => walkLines(8, 3, 'row'), /divide/);
  assert.throws(() => cacheLineFigure({ n: 8, lineLen: 3 }), /divide/);
});

test('the figure draws both walks, marks used and wasted cells, and states the counts', () => {
  const html = cacheLineFigure();
  assert.equal((html.match(/class="cl /g) ?? []).length, 128);
  // Every cache line starts at one marked cell: 16 lines of 4 values in each 8 x 8 grid.
  assert.equal((html.match(/ ls/g) ?? []).length, 32);
  assert.equal((html.match(/ used"/g) ?? []).length, 16);
  assert.equal((html.match(/ wasted"/g) ?? []).length, 24);
  assert.match(html, /Walking along a row: 8 values used, 2 cache lines fetched/);
  assert.match(html, /Walking down a column: 8 values used, 8 cache lines fetched/);
  assert.match(html, /<figure class="cache-figure">/);
  // Each grid has a text alternative.
  assert.equal((html.match(/role="img" aria-label="/g) ?? []).length, 2);
});
