import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, LIMITS, clampRequest, timeoutMs } from './request.mjs';

test('an empty request becomes the defaults, capped by the build', () => {
  assert.deepEqual(clampRequest({}, { pool: 8, build: 'threads' }), DEFAULTS);
  assert.equal(clampRequest({}, { pool: 2, build: 'threads' }).threads, 2);
  assert.equal(clampRequest({ threads: 8 }, { pool: 8, build: 'lite' }).threads, 1, 'the lite build has no threads');
});

test('every field is forced into its allowed range', () => {
  const request = clampRequest(
    { n: 100000, levels: [9, -1, 3, 3, 1], threads: 999, repeats: 50, block: [0, 99999], tile: [-5, 3.7, 'x'] },
    { pool: 4, build: 'threads' },
  );
  assert.equal(request.n, 1024);
  assert.deepEqual(request.levels, [1, 3]);
  assert.equal(request.threads, 4);
  assert.equal(request.repeats, 5);
  assert.deepEqual(request.block, [1, LIMITS.maxBlock]);
  assert.deepEqual(request.tile, [1, 4, DEFAULTS.tile[2]]);
});

test('sizes snap to the nearest allowed size; garbage falls back to the default', () => {
  assert.equal(clampRequest({ n: 300 }).n, 256);
  assert.equal(clampRequest({ n: 400 }).n, 512);
  assert.equal(clampRequest({ n: 'banana' }).n, DEFAULTS.n);
  assert.equal(clampRequest({ n: NaN }).n, DEFAULTS.n);
  assert.equal(clampRequest({ repeats: 2 }).repeats, 1, 'ties go to the first (smaller) value');
  assert.equal(clampRequest({ repeats: 4 }).repeats, 3);
});

test('null and numeric strings are accepted', () => {
  assert.deepEqual(clampRequest(null, { pool: 8, build: 'threads' }), DEFAULTS);
  assert.equal(clampRequest({ n: '512' }).n, 512);
});

test('a request with no valid level runs every level', () => {
  assert.deepEqual(clampRequest({ levels: [] }).levels, DEFAULTS.levels);
  assert.deepEqual(clampRequest({ levels: [7, 8] }).levels, DEFAULTS.levels);
  assert.deepEqual(clampRequest({ levels: 'all' }).levels, DEFAULTS.levels);
});

test('clamping is idempotent and never throws on hostile input', () => {
  const hostile = [null, undefined, 5, 'x', [], { n: {}, levels: {}, block: 'ab', tile: null, threads: Infinity }];
  for (const raw of hostile) {
    const once = clampRequest(raw, { pool: 8, build: 'threads' });
    assert.deepEqual(clampRequest(once, { pool: 8, build: 'threads' }), once);
  }
});

test('the timeout grows with the size, the levels and the repeats', () => {
  const base = { n: 256, levels: [0, 1, 2, 3, 4], repeats: 3 };
  assert.ok(timeoutMs({ ...base, n: 512 }) > timeoutMs(base));
  assert.ok(timeoutMs({ ...base, repeats: 5 }) > timeoutMs(base));
  assert.ok(timeoutMs({ ...base, levels: [3] }) < timeoutMs(base));
  // never below the 15 s start-up allowance, and a size-1024 run of everything gets minutes
  assert.ok(timeoutMs({ n: 64, levels: [3], repeats: 1 }) >= 15000);
  assert.ok(timeoutMs({ n: 1024, levels: [0, 1, 2, 3, 4], repeats: 5 }) > 120000);
});
