import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packCounts, packFigure } from './pack-figure.mjs';

test('n = 1024, tileK = 32, nr = 4: every row of the strip is a page and a set of its own apart', () => {
  const c = packCounts({ n: 1024, tileK: 32, nr: 4 });
  // 8 KiB between rows: 32 lines on 32 different pages, all in the same L1 set.
  assert.deepEqual(c.inPlace, { lines: 32, pages: 32, sets: 1 });
  // Packed: 32 * 4 * 8 = 1024 contiguous bytes = 16 lines, one page, 16 sets.
  assert.deepEqual(c.packed, { lines: 16, pages: 1, sets: 16 });
});

test('a row length that is not a power of two spreads the strip over many sets', () => {
  const c = packCounts({ n: 1000, tileK: 32, nr: 4 });
  assert.equal(c.inPlace.lines, 32);
  assert.ok(c.inPlace.sets > 8, `sets = ${c.inPlace.sets}`);
});

test('a row shorter than a line shares lines between rows', () => {
  // n = 8 doubles = 64 bytes: row k starts on line k, so 4 values per row are 4 of 8 in a line.
  assert.equal(packCounts({ n: 8, tileK: 4, nr: 4 }).inPlace.lines, 4);
  // n = 4: rows are 32 bytes apart, two rows per line.
  assert.equal(packCounts({ n: 4, tileK: 4, nr: 4 }).inPlace.lines, 2);
});

test('packing never touches more than reading in place', () => {
  for (const n of [4, 8, 64, 100, 256, 512, 1000, 1024]) {
    const c = packCounts({ n, tileK: 32, nr: 4 });
    assert.ok(c.packed.lines <= c.inPlace.lines, `lines at n = ${n}`);
    assert.ok(c.packed.pages <= c.inPlace.pages, `pages at n = ${n}`);
  }
});

test('the figure shows both layouts, three bars each, and says what it assumes', () => {
  const html = packFigure({ n: 1024 });
  assert.match(html, /<figure class="pack-figure">/);
  assert.equal((html.match(/class="pk-row"/g) ?? []).length, 2);
  assert.equal((html.match(/class="pk-fill"/g) ?? []).length, 6);
  assert.match(html, /32 cache lines, 32 pages and 1 L1 sets/);
  assert.match(html, /role="img" aria-label="[^"]*16 cache lines, 1 pages/);
  assert.match(html, /not time/);
  assert.match(html, /64 sets/);
  assert.doesNotMatch(html, /<script/);
});

test('invalid inputs are rejected', () => {
  assert.throws(() => packCounts({}), /n must be a positive integer/);
  assert.throws(() => packCounts({ n: 0 }), /n must be/);
  assert.throws(() => packCounts({ n: 64, tileK: 0 }), /tileK must be/);
  assert.throws(() => packCounts({ n: 2, nr: 4 }), /at least nr/);
  assert.throws(() => packCounts({ n: 64, nr: 1.5 }), /nr must be/);
});
