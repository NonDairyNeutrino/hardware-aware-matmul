// The paper's prose states some rankings and comparisons in words ("level 4 was faster than
// level 3", "level 3 came closest to native speed"), with the numbers filled in from
// results.json by placeholders. A placeholder keeps a number current; it cannot keep a
// sentence true. These tests check, against the committed results.json, every such
// comparison the prose makes, so that a re-run that flips one fails here and the sentence
// is rewritten instead of silently going wrong. Each test names the page that depends on it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findRun } from './lookup.mjs';

const data = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url), 'utf8'));
const sizes = [...data.parameters.sizes].sort((a, b) => a - b);
const largest = sizes.at(-1);
const nativeThreads = data.parameters.threads.native;
const ms = (environment, level, n, threads = 1) => {
  const run = findRun(data, environment, level, n, level === 0 ? 1 : threads);
  assert.ok(run, `no run for ${environment} level ${level} n=${n} t=${threads}`);
  return run.median_ms;
};
const native = (level, n, threads) => ms('native', level, n, threads);
const lite = (level, n) => ms('browser-lite', level, n, 1);
const gflops = (level, n, threads) => (2 * n ** 3) / (native(level, n, threads) / 1000) / 1e9;
const cacheBytes = (level) => data.environment.caches
  .find((c) => c.level === level && c.type !== 'Instruction').size_bytes;
const hardware = data.environment.hardware;

test('the sizes the prose names were measured (Discussion: "Four sizes", n = 256 to 1024)', () => {
  assert.deepEqual(sizes, [256, 512, 1024, 2048]);
  assert.deepEqual(nativeThreads, [1, 2, 4, 8]);
});

test('level 4 is faster than level 3 at every native thread count at the two largest sizes (Discussion, Conclusion, introduction.md, streaming.md)', () => {
  for (const n of sizes.slice(-2)) {
    for (const t of nativeThreads) {
      assert.ok(native(4, n, t) < native(3, n, t), `n=${n} t=${t}`);
    }
  }
  // "by less" at the second largest size than at the largest, at every thread count.
  const [second] = sizes.slice(-2);
  for (const t of nativeThreads) {
    assert.ok(native(4, second, t) / native(3, second, t) > native(4, largest, t) / native(3, largest, t), `t=${t}`);
  }
});

test('at the smaller sizes level 4 loses its lead: sometimes ahead, sometimes behind, never more than a tenth behind (Discussion, Conclusion)', () => {
  const smaller = sizes.slice(0, -2);
  const ratios = smaller.flatMap((n) => nativeThreads.map((t) => native(4, n, t) / native(3, n, t)));
  for (const n of smaller) {
    assert.ok(nativeThreads.some((t) => native(4, n, t) >= native(3, n, t)), `level 4 not ahead everywhere at n=${n}`);
  }
  assert.ok(ratios.some((r) => r < 1), 'level 4 ahead somewhere');
  assert.ok(ratios.some((r) => r > 1), 'level 4 behind somewhere');
  assert.ok(ratios.every((r) => r < 1.1), `never more than about a tenth behind: ${ratios}`);
});

test('level 4 on four threads is the fastest native case at the largest size (Discussion)', () => {
  const runs = data.runs.filter((r) => r.environment === 'native' && r.n === largest);
  const fastest = runs.reduce((a, b) => (b.median_ms < a.median_ms ? b : a));
  assert.equal(fastest.level, 4);
  assert.equal(fastest.threads, 4);
});

test('levels 0 and 1 one-thread native runs at the largest size are split in two groups but under the 20% IQR mark (Discussion)', () => {
  for (const level of [0, 1]) {
    const run = findRun(data, 'native', level, largest, 1);
    const fast = run.times_ms.filter((t) => t < 0.9 * run.median_ms).length;
    const near = run.times_ms.filter((t) => Math.abs(t / run.median_ms - 1) < 0.05).length;
    assert.ok(fast >= 2 && near >= 2, `level ${level}: ${fast} fast, ${near} near the median`);
    const sorted = [...run.times_ms].sort((a, b) => a - b);
    const q = (p) => sorted[Math.floor((sorted.length - 1) * p)];
    assert.ok((q(0.75) - q(0.25)) / run.median_ms < 0.2, `level ${level} IQR`);
    // "At n = 1024, where the one-thread runs do not split".
    const tight = findRun(data, 'native', level, 1024, 1);
    assert.ok(tight.times_ms.every((t) => Math.abs(t / tight.median_ms - 1) < 0.05), `level ${level} n=1024`);
  }
  // At the largest size, level 1 on one thread is no faster than level 0 (within 5%).
  assert.ok(Math.abs(native(1, largest, 1) / native(0, largest, 1) - 1) < 0.05);
});

test('level 1 thread scaling: superlinear to two and no gain to eight at the largest size; halving and a small gain at n=1024 (Discussion)', () => {
  assert.ok(native(1, largest, 1) / native(1, largest, 2) > 2);
  assert.ok(native(1, largest, 8) >= native(1, largest, 4));
  const ratio = native(1, 1024, 1) / native(1, 1024, 2);
  assert.ok(ratio > 1.8 && ratio < 2.2, `n=1024 two threads: ${ratio}`);
  assert.ok(native(1, 1024, 8) < native(1, 1024, 4));
  // Introduction: level 2 on one thread beats level 1 on all threads.
  assert.ok(native(2, largest, 1) < native(1, largest, Math.max(...nativeThreads)));
});

test('levels 2 to 4 stop scaling at the physical cores; level 2 gains a little more from the second four (Discussion, Conclusion)', () => {
  for (const level of [3, 4]) {
    assert.ok(native(level, largest, 8) > 0.95 * native(level, largest, 4), `level ${level}`);
  }
  for (const level of [2, 3, 4]) {
    assert.ok(native(level, largest, 1) / native(level, largest, 4) > 2, `level ${level} first four`);
    assert.ok(native(level, largest, 4) / native(level, largest, 8) < 1.15, `level ${level} second four`);
  }
  const gain = (level) => native(level, largest, 4) / native(level, largest, 8);
  assert.ok(gain(2) > gain(3) && gain(2) > gain(4));
  assert.ok(native(2, largest, 8) < native(2, largest, 4));
});

test('most of the one-thread gain arrives with level 2, and its gain over level 0 grows after n=512 (Discussion, Abstract, Conclusion)', () => {
  const l2 = Math.log(native(0, largest, 1) / native(2, largest, 1));
  const l3 = Math.log(native(0, largest, 1) / native(3, largest, 1));
  assert.ok(l2 / l3 > 0.5);
  const speedup = (n) => native(0, n, 1) / native(2, n, 1);
  assert.ok(Math.abs(speedup(256) / speedup(512) - 1) < 0.2, 'barely moves between the smaller sizes');
  assert.ok(speedup(512) < speedup(1024) && speedup(1024) < speedup(largest));
  assert.ok(gflops(0, 512, 1) > gflops(0, 1024, 1) && gflops(0, 1024, 1) > gflops(0, largest, 1));
});

test('the cache facts the Discussion and primer state hold for the recorded caches', () => {
  const matrices = (n) => 3 * n * n * 8;
  assert.ok(matrices(512) <= cacheBytes(3) && matrices(1024) > cacheBytes(3), 'three matrices either side of the L3');
  assert.equal(512 * 64, cacheBytes(1), 'a column walk at n=512 is as much as the L1d');
  assert.ok(1024 * 64 > cacheBytes(1), 'a column walk at n=1024 exceeds the L1d');
  // L1d and L2 per core (shared by its two hyper-threads), L3 shared by all.
  for (const cache of data.environment.caches) {
    const cpus = cache.level === 3 ? data.environment.logical_cores : 2;
    const list = cache.shared_cpu_list;
    const count = list.split(',').reduce((sum, part) => {
      const [a, b] = part.split('-').map(Number);
      return sum + (b === undefined ? 1 : b - a + 1);
    }, 0);
    assert.equal(count, cpus, `level ${cache.level} ${cache.type}`);
  }
});

test('level 3 four-thread throughput falls between n=512 and 1024 while one thread hardly changes (Discussion)', () => {
  assert.ok(gflops(3, 512, 4) / gflops(3, 1024, 4) > 1.2);
  assert.ok(gflops(3, 512, 4) / gflops(3, largest, 4) > 1.2);
  for (const n of [1024, largest]) {
    assert.ok(Math.abs(gflops(3, 512, 1) / gflops(3, n, 1) - 1) < 0.1, `n=${n}`);
  }
});

test('the hardware probe: triad stops gaining at four threads, the peak keeps gaining, level 4 is far from the triad limit (Discussion)', () => {
  const triad = (t) => hardware.triad_gbs[t];
  const peak = (t) => hardware.peak_gflops[t];
  assert.ok(triad(4) > triad(1) && triad(8) <= triad(4));
  assert.ok(peak(8) > 1.1 * peak(4));
  // Level 3's share of the peak falls from one thread to eight.
  assert.ok(gflops(3, largest, 8) / peak(8) < gflops(3, largest, 1) / peak(1));
  // About 1 GB of tile reads (a strip of A and of B, 2 n * tile * 8 bytes, per output tile),
  // at the four-thread triad rate, is under a tenth of level 4's four-thread time.
  const [rows, cols] = data.parameters.tile;
  const tiles = (largest / rows) * (largest / cols);
  const bytes = tiles * (rows + cols) * largest * 8;
  assert.ok(bytes > 0.9e9 && bytes < 1.2e9, `about 1 GB: ${bytes}`);
  assert.ok(bytes / (triad(4) * 1e9) < 0.1 * native(4, largest, 4) / 1000);
});

test('browser against native at the largest size (Discussion, Conclusion)', () => {
  const ratio = (level) => lite(level, largest) / native(level, largest, 1);
  for (const level of [2, 3, 4]) assert.ok(ratio(level) > 1, `level ${level} slower in the browser`);
  assert.ok(ratio(3) < ratio(2) && ratio(3) < ratio(4), 'level 3 closest among 2 to 4');
  for (const level of [0, 1]) {
    assert.ok(ratio(level) <= 1, `level ${level} no slower in the browser at the largest size`);
    assert.ok(lite(level, 1024) > native(level, 1024, 1), `level ${level} slower in the browser at n=1024`);
  }
  // Level 4 is slower than level 3 in the lite build (and faster natively, tested above).
  assert.ok(lite(4, largest) > lite(3, largest));
  // Threaded build: level 3 within a tenth of native at the most threads, and no gain after four.
  const most = Math.max(...data.parameters.threads['browser-threads']);
  const threaded = (level, t) => ms('browser-threads', level, largest, t);
  assert.ok(Math.abs(threaded(3, most) / native(3, largest, Math.max(...nativeThreads)) - 1) < 0.1);
  assert.ok(threaded(3, 8) > 0.95 * threaded(3, 4));
  // One thread: the threaded build is slower for level 1 and about the same for level 3.
  assert.ok(threaded(1, 1) > 1.1 * lite(1, largest));
  assert.ok(Math.abs(threaded(3, 1) / lite(3, largest) - 1) < 0.05);
});
