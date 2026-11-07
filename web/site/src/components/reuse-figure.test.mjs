import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes, reuseCounts, reuseFigure } from './reuse-figure.mjs';

test('formatBytes prints KiB, MiB and GiB', () => {
  assert.equal(formatBytes(16384), '16 KiB');
  assert.equal(formatBytes(8 * 1024 * 1024), '8 MiB');
  assert.equal(formatBytes(2 * 1024 ** 3), '2 GiB');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1.5 * 1024 ** 2), '1.5 MiB');
});

test('n = 1024, 4 threads, block 32 x 64: B is fetched 256 times without blocking and once with', () => {
  const c = reuseCounts({ n: 1024, block: [32, 64], threads: 4 });
  assert.equal(c.rows, 256);
  assert.equal(c.fetchesWithout, 256);
  assert.equal(c.fetchesWith, 1);
  assert.equal(c.bytesWithout, 2 * 1024 ** 3);
  assert.equal(c.bytesWith, 8 * 1024 ** 2);
  assert.equal(c.blockBytes, 16384);
});

test('the figure states the example, both counts and the byte totals', () => {
  const html = reuseFigure({ n: 1024, block: [32, 64], threads: 4 });
  assert.match(html, /<figure class="reuse-figure">/);
  assert.match(html, /1024 × 1024/);
  assert.match(html, /4 threads/);
  assert.match(html, /32 × 64/);
  assert.match(html, /16 KiB/);
  assert.match(html, /256 times/);
  assert.match(html, /once/);
  assert.match(html, /2 GiB/);
  assert.match(html, /8 MiB/);
  assert.match(html, /not a measurement/);
  assert.doesNotMatch(html, /log scale/);
  assert.match(html, /to scale/);
  assert.equal((html.match(/role="img" aria-label="[^"]*256 times[^"]*"/g) ?? []).length, 1);
  assert.match(html, /aria-label="[^"]*the cache holds one block of B but not all of B[^"]*not a measurement/);
  assert.doesNotMatch(html, /<script/);
});

test('the bars are drawn to scale: the blocked bar is a sliver of the unblocked one', () => {
  const html = reuseFigure({ n: 1024, block: [32, 64], threads: 4 });
  const widths = [...html.matchAll(/class="rf-fill[^"]*" style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 2);
  assert.equal(widths[0], 100);
  // 8 MiB against 2 GiB is 1 in 256: 0.39 %, drawn with a minimum width so it stays visible.
  assert.ok(widths[1] >= 0.4 && widths[1] <= 0.5, String(widths[1]));
});

test('invalid inputs are rejected', () => {
  assert.throws(() => reuseFigure({ n: 0, block: [32, 64], threads: 4 }), /positive integer/);
  assert.throws(() => reuseFigure({ n: 1024, block: [32, 0], threads: 4 }), /positive integer/);
  assert.throws(() => reuseFigure({ n: 1024, block: [32, 64], threads: 1.5 }), /positive integer/);
  assert.throws(() => reuseFigure({ n: 1024, block: [32], threads: 4 }), /block/);
  assert.throws(() => reuseFigure({ n: 1000, block: [32, 64], threads: 3 }), /divisible|divide/);
});
