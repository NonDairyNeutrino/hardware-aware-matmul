import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median, referenceHash, summarise, verdict } from './summary.mjs';

test('the median of odd and even lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
});

const results = [
  { level: 0, times_ms: [1000, 1000, 1000], hash: 'h' },
  { level: 1, times_ms: [500, 520, 480], hash: 'h' },
  { level: 3, times_ms: [100, 100, 100], hash: 'h' },
];

test('rows carry median, throughput, speedups and bar lengths', () => {
  const { rows } = summarise(results, 128);
  assert.deepEqual(rows.map((r) => r.level), [0, 1, 3]);
  assert.deepEqual(rows.map((r) => r.median_ms), [1000, 500, 100]);
  assert.equal(rows[0].vsNaive, 1);
  assert.equal(rows[2].vsNaive, 10);
  assert.equal(rows[0].vsPrevious, null);
  assert.equal(rows[1].vsPrevious, 2);
  assert.equal(rows[2].vsPrevious, 5);
  assert.deepEqual(rows.map((r) => r.bar), [1, 0.5, 0.1]);
  assert.ok(Math.abs(rows[0].gflops - (2 * 128 ** 3) / 1 / 1e9) < 1e-9);
  assert.equal(rows[1].min_ms, 480);
  assert.equal(rows[1].max_ms, 520);
});

test('without level 0 there is no speedup over naive', () => {
  const { rows } = summarise(results.slice(1), 128);
  assert.equal(rows[0].vsNaive, null);
  assert.equal(rows[1].vsPrevious, 5);
});

test('a time of zero never becomes Infinity or NaN', () => {
  const { rows } = summarise([
    { level: 0, times_ms: [0, 0, 0], hash: 'h' },
    { level: 3, times_ms: [2, 2, 2], hash: 'h' },
  ], 64);
  assert.equal(rows[0].timed, false);
  assert.equal(rows[0].gflops, null);
  assert.equal(rows[1].vsNaive, null, 'no speedup over a zero time');
  assert.equal(rows[1].vsPrevious, null);
  assert.equal(rows[1].timed, true);
  assert.ok(Number.isFinite(rows[1].gflops));
});

test('the same answer is true only if every hash agrees', () => {
  assert.equal(summarise(results, 128).sameAnswer, true);
  assert.equal(summarise(results, 128).hash, 'h');
  const wrong = [...results.slice(0, 2), { level: 3, times_ms: [100], hash: 'x' }];
  assert.equal(summarise(wrong, 128).sameAnswer, false);
  assert.equal(summarise(wrong, 128).hash, null);
  assert.equal(summarise([], 128).sameAnswer, false);
});

test('the reference hash is looked up by size', () => {
  const runs = [{ n: 512, hash: 'a' }, { n: 1024, hash: 'b' }];
  assert.equal(referenceHash(runs, 1024), 'b');
  assert.equal(referenceHash(runs, 64), null);
});

test('the verdict names the failure modes plainly', () => {
  const ok = summarise(results, 128);
  assert.match(verdict(ok, null).text, /All 3 levels gave the same answer/);
  assert.equal(verdict(ok, null).ok, true);
  assert.match(verdict(ok, 'h').text, /matches the reference run/);
  assert.equal(verdict(ok, 'other').ok, false);
  assert.match(verdict(ok, 'other').text, /differs from the reference run/);
  const bad = summarise([{ level: 0, times_ms: [1], hash: 'a' }, { level: 1, times_ms: [1], hash: 'b' }], 64);
  assert.equal(verdict(bad, null).ok, false);
  assert.match(verdict(bad, null).text, /DIFFERENT answers/);
  assert.equal(verdict(summarise([], 64), null).ok, false);
});
