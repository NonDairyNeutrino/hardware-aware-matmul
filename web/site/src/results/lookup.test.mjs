import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { data, run } from './fixture.mjs';
import {
  ENV_FIELD_NAMES, formatMs, hasPlaceholder, interquartileRange, noise, resolvePlaceholder, substitute,
} from './lookup.mjs';

test('formats times as seconds, whole milliseconds or one decimal', () => {
  assert.equal(formatMs(3796.2), '3.8 s');
  assert.equal(formatMs(222.23), '222 ms');
  assert.equal(formatMs(42.46), '42.5 ms');
});

test('the interquartile range ignores a single outlier', () => {
  assert.equal(interquartileRange([10, 10, 10, 10, 1000]), 0);
  assert.equal(interquartileRange([1, 2, 3, 4, 5]), 2);
  const r = run('native', 0, 64, 1, 100);
  assert.ok(Math.abs(noise(r) - 0.02) < 1e-9);
});

test('resolves ms, gflops, speedup and iqr with the defaults (native, largest n, most threads)', () => {
  // level 3 native at n=128 with 2 threads: 1000/(3*2) ms
  assert.equal(resolvePlaceholder(data, 'ms simd'), '167 ms');
  assert.equal(resolvePlaceholder(data, 'gflops simd'), `${((2 * 128 ** 3) / (1000 / 6 / 1000) / 1e9).toFixed(1)} GFLOP/s`);
  // level 0 is always single-threaded: 1000 ms
  assert.equal(resolvePlaceholder(data, 'ms naive'), '1.0 s');
  // simd is 6 times faster than naive here (1000 / 166.7)
  assert.equal(resolvePlaceholder(data, 'speedup simd/naive'), '6.0×');
  assert.equal(resolvePlaceholder(data, 'iqr simd'), '2%');
});

test('selectors choose the size, thread count and environment', () => {
  assert.equal(resolvePlaceholder(data, 'ms threaded n=64 t=1'), '1.0 s');
  assert.equal(resolvePlaceholder(data, 'ms streaming n=64 t=1'), '250 ms');
  assert.equal(resolvePlaceholder(data, 'ms simd n=64 lite'), '1.0 s');
  assert.equal(resolvePlaceholder(data, 'ms L3 browser-lite'), '1.0 s');
  // t= is ignored for level 0
  assert.equal(resolvePlaceholder(data, 'ms naive t=2'), '1.0 s');
});

test('env facts', () => {
  assert.equal(resolvePlaceholder(data, 'env cpu'), 'Test CPU');
  assert.equal(resolvePlaceholder(data, 'env date'), '2026-11-06');
  assert.equal(resolvePlaceholder(data, 'env commit'), 'abcdef0');
  assert.equal(resolvePlaceholder(data, 'env firefox'), 'Firefox 1.0');
  assert.equal(resolvePlaceholder(data, 'env sizes'), '64 and 128');
  assert.equal(resolvePlaceholder(data, 'env runs'), String(data.runs.length));
});

test('anything that does not resolve throws and quotes the placeholder', () => {
  for (const bad of ['ms nonsense', 'ms simd n=999', 'ms simd t=64', 'ms simd weird', 'bogus simd', 'ms',
    'speedup simd', 'speedup simd/naive/x', 'env nothing', 'env cpu extra', 'ms simd lite t=2']) {
    assert.throws(() => resolvePlaceholder(data, bad), new RegExp(`unresolvable placeholder "\\{\\{${bad.replace(/[/]/g, '\\/')}\\}\\}"`), bad);
  }
});

test('substitute replaces every placeholder in a sentence and leaves the rest alone', () => {
  const out = substitute('Level 3 took {{ms simd}} on a {{env cpu}}, {{speedup simd/naive}} faster.', data);
  assert.equal(out, 'Level 3 took 167 ms on a Test CPU, 6.0× faster.');
  assert.equal(substitute('no placeholders { here } or {single}', data), 'no placeholders { here } or {single}');
  assert.ok(hasPlaceholder('a {{ms simd}} b'));
  assert.ok(!hasPlaceholder('a {ms simd} b'));
});

test('a placeholder with no data is an error', () => {
  assert.throws(() => substitute('{{ms simd}}', null), /no results data/);
});

test('the committed results.json resolves every kind of placeholder the prose uses', () => {
  const real = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url), 'utf8'));
  for (const name of ENV_FIELD_NAMES) assert.ok(resolvePlaceholder(real, `env ${name}`).length > 0, name);
  for (const metric of ['ms', 'gflops', 'iqr']) {
    for (const level of ['naive', 'threaded', 'cache_friendly', 'simd', 'streaming']) {
      for (const environment of ['native', 'lite', 'threads']) {
        assert.doesNotMatch(resolvePlaceholder(real, `${metric} ${level} ${environment}`), /NaN|undefined/);
      }
    }
  }
  assert.match(resolvePlaceholder(real, 'speedup simd/naive native'), /^\d+\.\d×$/);
});
