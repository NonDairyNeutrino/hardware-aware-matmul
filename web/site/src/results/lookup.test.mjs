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
  // n^3 multiply-adds at the largest size (128^3), with thousands separators.
  assert.equal(resolvePlaceholder(data, 'env madds'), '2,097,152');
});

test('env sizes is a list with "and" before the last size', () => {
  const sizes = (list) => {
    const copy = structuredClone(data);
    copy.parameters.sizes = list;
    return resolvePlaceholder(copy, 'env sizes');
  };
  assert.equal(sizes([64]), '64');
  assert.equal(sizes([64, 128]), '64 and 128');
  assert.equal(sizes([256, 512, 1024, 2048]), '256, 512, 1024 and 2048');
});

test('env cache sizes, in KiB below 1 MiB and in MiB above', () => {
  assert.equal(resolvePlaceholder(data, 'env l1d'), '48 KiB');
  assert.equal(resolvePlaceholder(data, 'env l2'), '1.25 MiB');
  assert.equal(resolvePlaceholder(data, 'env l3'), '8 MiB');
  // An older results.json has no caches: the placeholder must throw, not render.
  const old = structuredClone(data);
  delete old.environment.caches;
  for (const name of ['l1d', 'l2', 'l3']) {
    assert.throws(() => resolvePlaceholder(old, `env ${name}`), /the data has no value for it/, name);
  }
});

test('the hardware probe: triad bandwidth and arithmetic peak, per thread count and at most', () => {
  assert.equal(resolvePlaceholder(data, 'triad t=1'), '10.0 GB/s');
  assert.equal(resolvePlaceholder(data, 'triad'), '15.1 GB/s'); // default: the most threads
  assert.equal(resolvePlaceholder(data, 'peak t=1'), '0.0 GFLOP/s');
  assert.equal(resolvePlaceholder(data, 'env triad_max'), '15.1 GB/s');
  assert.equal(resolvePlaceholder(data, 'env peak_max'), '0.1 GFLOP/s');
  const old = structuredClone(data);
  delete old.environment.hardware;
  for (const bad of ['env triad_max', 'env peak_max']) {
    assert.throws(() => resolvePlaceholder(old, bad), /the data has no value for it/, bad);
  }
  for (const bad of ['triad', 'peak t=2']) {
    assert.throws(() => resolvePlaceholder(old, bad), /unresolvable placeholder/, bad);
  }
  for (const bad of ['triad t=4', 'peak t=3', 'triad n=64', 'triad lite', 'peak t=1 t=2', 'triad simd']) {
    assert.throws(() => resolvePlaceholder(data, bad), /unresolvable placeholder/, bad);
  }
});

test('frac: a level\'s throughput as a share of the arithmetic peak at the same thread count', () => {
  // Level 3, n=128, 2 threads: 0.02517 GFLOP/s against a peak of 0.05.
  assert.equal(resolvePlaceholder(data, 'frac simd'), '50%');
  // Level 3, n=128, 1 thread: 0.01258 against 0.02.
  assert.equal(resolvePlaceholder(data, 'frac simd t=1'), '63%');
  assert.equal(resolvePlaceholder(data, 'frac simd t=1 n=64'), '8%');
  // Level 0 is one thread, so its share is of the one-thread peak whatever t= says.
  assert.equal(resolvePlaceholder(data, 'frac naive t=2'), resolvePlaceholder(data, 'frac naive t=1'));
  // The peak was measured natively only.
  for (const bad of ['frac simd lite', 'frac simd threads', 'frac', 'frac simd/naive']) {
    assert.throws(() => resolvePlaceholder(data, bad), /unresolvable placeholder/, bad);
  }
});

test('a null, undefined or empty env value throws instead of rendering', () => {
  for (const [field, name] of [['governor', 'governor'], ['cpu', 'cpu'], ['os', 'os']]) {
    for (const bad of [null, undefined, '']) {
      const broken = structuredClone(data);
      broken.environment[field] = bad;
      if (bad === undefined) delete broken.environment[field];
      assert.throws(() => resolvePlaceholder(broken, `env ${name}`), /the data has no value for it/, `${name}=${bad}`);
    }
  }
});

test('a dirty-tree commit keeps its suffix', () => {
  const dirty = structuredClone(data);
  dirty.environment.commit = 'abcdef0123 (with uncommitted changes)';
  assert.equal(resolvePlaceholder(dirty, 'env commit'), 'abcdef0 (with uncommitted changes)');
});

test('inherited object keys are not fields, levels or aliases', () => {
  assert.throws(() => resolvePlaceholder(data, 'env toString'), /unresolvable placeholder/);
  assert.throws(() => resolvePlaceholder(data, 'env constructor'), /unresolvable placeholder/);
  assert.throws(() => resolvePlaceholder(data, 'ms constructor'), /unknown level/);
  assert.throws(() => resolvePlaceholder(data, 'ms simd constructor'), /unknown selector/);
});

test('duplicate selectors throw', () => {
  for (const bad of ['ms simd n=64 n=128', 'ms simd t=1 t=2', 'ms simd native lite']) {
    assert.throws(() => resolvePlaceholder(data, bad), /duplicate selector/, bad);
  }
});

test('threads_* and rustflags env fields', () => {
  assert.equal(resolvePlaceholder(data, 'env threads_native'), '2');
  assert.equal(resolvePlaceholder(data, 'env threads_lite'), '1');
  assert.equal(resolvePlaceholder(data, 'env threads_threaded'), '2');
  assert.equal(resolvePlaceholder(data, 'env rustflags'), 'none');
  const flags = structuredClone(data);
  flags.environment.rustflags = '-C target-cpu=native';
  assert.equal(resolvePlaceholder(flags, 'env rustflags'), '-C target-cpu=native');
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
  for (const name of ['l1d', 'l2', 'l3', 'triad_max', 'peak_max']) assert.ok(ENV_FIELD_NAMES.includes(name), name);
  for (const name of ENV_FIELD_NAMES) assert.ok(resolvePlaceholder(real, `env ${name}`).length > 0, name);
  for (const t of real.parameters.threads.native) {
    assert.match(resolvePlaceholder(real, `triad t=${t}`), /^\d+\.\d GB\/s$/);
    assert.match(resolvePlaceholder(real, `peak t=${t}`), /^\d+\.\d GFLOP\/s$/);
    for (const level of ['naive', 'threaded', 'cache_friendly', 'simd', 'streaming']) {
      assert.match(resolvePlaceholder(real, `frac ${level} t=${t}`), /^\d+%$/);
    }
  }
  assert.match(resolvePlaceholder(real, 'env sizes'), /^\d+(, \d+)* and \d+$/);
  for (const metric of ['ms', 'gflops', 'iqr']) {
    for (const level of ['naive', 'threaded', 'cache_friendly', 'simd', 'streaming']) {
      for (const environment of ['native', 'lite', 'threads']) {
        assert.doesNotMatch(resolvePlaceholder(real, `${metric} ${level} ${environment}`), /NaN|undefined/);
      }
    }
  }
  // Facts the Results prose states unconditionally.
  for (const n of real.parameters.sizes) {
    const hashes = new Set(real.runs.filter((r) => r.n === n).map((r) => r.hash));
    assert.equal(hashes.size, 1, `all runs at n=${n} share one hash`);
  }
  assert.deepEqual(real.environment.browser_isolated, { 'browser-lite': true, 'browser-threads': true });
  assert.deepEqual(real.parameters.threads['browser-lite'], [1]);
  assert.equal(real.environment.rustflags, '');
  assert.equal(typeof real.environment.native_isa, 'string');
  assert.ok(real.environment.native_isa.length > 0);
  assert.match(resolvePlaceholder(real, 'speedup simd/naive native'), /^\d+\.\d×$/);
});
