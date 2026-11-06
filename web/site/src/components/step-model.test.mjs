import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OWNER_COUNT, cacheBlocks, caption, microLines, ownerColour, parsePlan, rowDone, rowOwners,
  stepCount, tileOfCell,
} from './step-model.mjs';

// The plan for level 1, 10 rows, 4 threads (from the core crate's own example).
const rows = parsePlan('{"kind":"rows","blocks":[[0,3],[3,6],[6,9],[9,10]]}');
// A 2 x 2 grid of 2 x 3 tiles over a 4 x 6 output.
const tiles = parsePlan(
  '{"kind":"tiles","tiles":[{"rows":[0,2],"cols":[0,3]},{"rows":[0,2],"cols":[3,6]},' +
    '{"rows":[2,4],"cols":[0,3]},{"rows":[2,4],"cols":[3,6]}],"depth":[[0,4],[4,6]],"workers":2}',
);

test('parsePlan rejects anything that is not a plan', () => {
  assert.throws(() => parsePlan('{"kind":"nope"}'), /unrecognised plan/);
  assert.throws(() => parsePlan('{"kind":"rows"}'), /unrecognised plan/);
});

test('rowOwners gives each row the block that computes it', () => {
  assert.deepEqual(rowOwners(rows, 10), [0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
});

test('a rows plan takes as many steps as its largest block has rows', () => {
  assert.equal(stepCount(rows), 3);
  assert.equal(stepCount(parsePlan('{"kind":"rows","blocks":[[0,10]]}')), 10);
});

test('rows finish one per step within each block, all blocks at once', () => {
  const done = (step) => [...Array(10).keys()].filter((r) => rowDone(rows, r, step));
  assert.deepEqual(done(0), []);
  assert.deepEqual(done(1), [0, 3, 6, 9]);
  assert.deepEqual(done(2), [0, 1, 3, 4, 6, 7, 9]);
  assert.deepEqual(done(3), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a tiles plan takes one step per tile', () => {
  assert.equal(stepCount(tiles), 4);
});

test('tileOfCell numbers each cell by the tile that covers it, in claim order', () => {
  assert.deepEqual(tileOfCell(tiles, 4, 6), [
    0, 0, 0, 1, 1, 1,
    0, 0, 0, 1, 1, 1,
    2, 2, 2, 3, 3, 3,
    2, 2, 2, 3, 3, 3,
  ]);
});

test('every cell of a real-shaped tiles plan is covered exactly once', () => {
  const edge = parsePlan(
    '{"kind":"tiles","tiles":[{"rows":[0,4],"cols":[0,4]},{"rows":[0,4],"cols":[4,5]},' +
      '{"rows":[4,5],"cols":[0,4]},{"rows":[4,5],"cols":[4,5]}],"depth":[[0,4]],"workers":1}',
  );
  assert.ok(!tileOfCell(edge, 5, 5).includes(-1));
});

test('owner colours wrap around the palette', () => {
  assert.equal(ownerColour(0), 0);
  assert.equal(ownerColour(OWNER_COUNT), 0);
  assert.equal(ownerColour(OWNER_COUNT + 3), 3);
});

test('cacheBlocks walks B in tile_k by tile_j pieces, clipped at the edges', () => {
  assert.deepEqual(cacheBlocks(5, 4, 3, 3), [
    { rows: [0, 3], cols: [0, 3] },
    { rows: [0, 3], cols: [3, 4] },
    { rows: [3, 5], cols: [0, 3] },
    { rows: [3, 5], cols: [3, 4] },
  ]);
});

test('microLines marks every MR-th or NR-th position inside the extent', () => {
  assert.deepEqual(microLines(10, 4), [4, 8]);
  assert.deepEqual(microLines(4, 4), []);
});

test('captions describe the plan that is drawn', () => {
  assert.match(caption(1, rows, 2, 3), /Step 2 of 3: each of the 4 threads has finished 2 rows/);
  assert.match(caption(4, tiles, 1, 4), /1 of 4 tiles done.*2 workers/);
  assert.match(caption(0, rows, 0, 3), /One thread/);
});

test('level 2 and 3 captions say the rows are shown one per step', () => {
  for (const [level, step] of [[2, 2], [3, 1]]) {
    const text = caption(level, rows, step, 3);
    assert.match(text, /side by side/);
    assert.match(text, /once per cache block/);
  }
});
