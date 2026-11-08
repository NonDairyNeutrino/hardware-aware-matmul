// The paper's prose states some rankings and comparisons in words ("level 5 was faster than
// level 3", "levels 3 and 4 came closest to native speed"), with the numbers filled in from
// results.json by placeholders. A placeholder keeps a number current; it cannot keep a
// sentence true. These tests check, against the committed results.json, every such
// comparison the prose makes, so that a re-run that flips one fails here and the sentence
// is rewritten instead of silently going wrong. Each test names the page that depends on it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findRun, noise } from './lookup.mjs';

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
const physicalCores = data.environment.physical_cores;
const mostNative = Math.max(...nativeThreads);

test('the sizes the prose names were measured (Discussion: "Four sizes", n = 256 to 2048)', () => {
  assert.deepEqual(sizes, [256, 512, 1024, 2048]);
  assert.deepEqual(nativeThreads, [1, 2, 4, 8]);
  // "the second four threads", "where the physical cores run out".
  assert.equal(physicalCores, 4);
});

test('level 5 is faster than level 3 at every native thread count at the two largest sizes (Discussion, Conclusion, introduction.md, streaming.md)', () => {
  for (const n of sizes.slice(-2)) {
    for (const t of nativeThreads) {
      assert.ok(native(5, n, t) < native(3, n, t), `n=${n} t=${t}`);
    }
  }
  // "by less" at the second largest size than at the largest, at every thread count.
  const [second] = sizes.slice(-2);
  for (const t of nativeThreads) {
    assert.ok(native(5, second, t) / native(3, second, t) > native(5, largest, t) / native(3, largest, t), `t=${t}`);
  }
});

test('at the smaller sizes level 5 loses that lead: sometimes ahead, sometimes behind, never more than a tenth behind (Discussion, Conclusion)', () => {
  const smaller = sizes.slice(0, -2);
  const ratios = smaller.flatMap((n) => nativeThreads.map((t) => native(5, n, t) / native(3, n, t)));
  assert.ok(ratios.some((r) => r < 1), 'level 5 ahead somewhere');
  assert.ok(ratios.some((r) => r > 1), 'level 5 behind somewhere');
  assert.ok(ratios.every((r) => r < 1.1), `never more than about a tenth behind: ${ratios}`);
});

test('level 4 (packing) against level 3: a lead only at the two largest sizes, and the larger one at the largest (Discussion, Conclusion, packed.md)', () => {
  for (const n of sizes.slice(-2)) {
    for (const t of nativeThreads) {
      assert.ok(native(4, n, t) < native(3, n, t), `n=${n} t=${t}`);
    }
  }
  // The lead at the largest size is several times the lead at the next one, at every thread count.
  const [second] = sizes.slice(-2);
  for (const t of nativeThreads) {
    const lead = (n) => Math.log(native(3, n, t) / native(4, n, t));
    assert.ok(lead(largest) > 3 * lead(second), `t=${t}: ${lead(largest)} against ${lead(second)}`);
  }
  // At the smaller sizes the two are within a tenth either way.
  for (const n of sizes.slice(0, -2)) {
    for (const t of nativeThreads) {
      const r = native(4, n, t) / native(3, n, t);
      assert.ok(r > 0.9 && r < 1.1, `n=${n} t=${t}: ${r}`);
    }
  }
});

test('level 5 stays ahead of level 4 at the largest size, and level 4 gets most of the way from level 3 to level 5 (Discussion, Conclusion)', () => {
  for (const t of nativeThreads) {
    assert.ok(native(5, largest, t) < native(4, largest, t), `t=${t}`);
    const share = Math.log(native(3, largest, t) / native(4, largest, t))
      / Math.log(native(3, largest, t) / native(5, largest, t));
    assert.ok(share > 0.5, `t=${t}: level 4 gets ${share} of the way`);
  }
});

test('level 5 on four threads, natively, is the fastest case measured at the largest size (Discussion)', () => {
  // "the fastest case measured at that size": every environment, not just native.
  const runs = data.runs.filter((r) => r.n === largest);
  const fastest = runs.reduce((a, b) => (b.median_ms < a.median_ms ? b : a));
  assert.equal(fastest.environment, 'native');
  assert.equal(fastest.level, 5);
  assert.equal(fastest.threads, 4);
});

const countsAt = (n) => data.environment.counters.find((r) => r.n === n);

test('the event counts were taken at two sizes, 1024 and the largest, on one thread, with the compiler of the timed runs (Discussion, results.md)', () => {
  assert.deepEqual(data.environment.counters.map((r) => r.n), [1024, largest]);
  for (const report of data.environment.counters) {
    assert.equal(report.threads, 1);
    assert.equal(report.min_counted_pct, 100, 'no event was time-shared');
    // "native rustc" is the nightly the timed runs used; the counts must come from the same one.
    assert.ok(data.environment.toolchains.native.startsWith(report.rustc.split(' (')[0]), report.rustc);
  }
});

test('the event counts at n=1024: packing removes most L1 misses without changing the cycles by more than a tenth (Discussion, results.md)', () => {
  const counted = countsAt(1024).per_multiplication;
  const misses = (level) => counted[level]['L1-dcache-load-misses'];
  assert.ok(misses('simd') / misses('packed') > 5, 'packing removes most of the L1 misses');
  assert.ok(Math.abs(counted.packed.cycles / counted.simd.cycles - 1) < 0.1, 'cycles within a tenth');
  // The naive loop misses the L1 about as often as it loads, and the blocked levels far less.
  assert.ok(counted.naive.l1d_miss_rate > 0.4);
  for (const level of ['cache_friendly', 'simd', 'packed', 'streaming']) {
    assert.ok(counted[level].l1d_miss_rate < 0.35, level);
    assert.ok(counted[level].cycles < 0.2 * counted.naive.cycles, level);
  }
  // Fewer loads sent on to the last-level cache, about the same instructions per cycle.
  assert.ok(counted.packed['LLC-loads'] < counted.simd['LLC-loads']);
  assert.ok(Math.abs(counted.packed.ipc / counted.simd.ipc - 1) < 0.1);
  // The naive loop sends far more loads to the last-level cache than level 2 does.
  assert.ok(counted.naive['LLC-loads'] > 10 * counted.cache_friendly['LLC-loads']);
  // Level 4 leads level 3 by less than a tenth in time here too (one thread).
  assert.ok(native(4, 1024, 1) / native(3, 1024, 1) > 0.9);
});

test('the event counts at the largest size: the cycles follow the times, and packing sends far fewer loads past the L2 (Discussion, results.md)', () => {
  const counted = countsAt(largest).per_multiplication;
  const misses = (level) => counted[level]['L1-dcache-load-misses'];
  assert.ok(misses('simd') / misses('packed') > 5, 'packing removes most of the L1 misses');
  assert.ok(counted.simd['LLC-loads'] > 10 * counted.packed['LLC-loads'], 'and most of the loads that reach the last-level cache');
  // Cycles fall by about the fraction that the one-thread time falls, for level 4 against level 3.
  const cycles = counted.packed.cycles / counted.simd.cycles;
  const time = native(4, largest, 1) / native(3, largest, 1);
  assert.ok(cycles < 0.95 && Math.abs(cycles - time) < 0.05, `cycles ${cycles}, time ${time}`);
  // The cycles order levels 3, 4 and 5 as the times do, and level 5 does more loads than level 4.
  assert.ok(counted.streaming.cycles < counted.packed.cycles && counted.packed.cycles < counted.simd.cycles);
  assert.ok(native(5, largest, 1) < native(4, largest, 1) && native(4, largest, 1) < native(3, largest, 1));
  assert.ok(counted.streaming['L1-dcache-loads'] > 2 * counted.packed['L1-dcache-loads']);
  assert.ok(counted.streaming['LLC-loads'] < 0.1 * counted.simd['LLC-loads']);
  assert.ok(counted.packed.ipc > counted.simd.ipc && counted.streaming.ipc > counted.packed.ipc);
  // Few data-TLB misses for levels 3 and 4 (so no TLB effect to read), at both sizes.
  for (const n of [1024, largest]) {
    for (const level of ['simd', 'packed']) assert.ok(countsAt(n).per_multiplication[level]['dTLB-load-misses'] < 1e5, `${level} n=${n}`);
  }
  // Level 1 counted about twice level 0's L1 loads, at both sizes: the Discussion calls it unexplained.
  for (const n of [1024, largest]) {
    const c = countsAt(n).per_multiplication;
    assert.ok(Math.abs(c.threaded['L1-dcache-loads'] / c.naive['L1-dcache-loads'] - 2) < 0.1, `n=${n}`);
  }
});

test('levels 0 and 1 one-thread native runs at the largest size are tight, and level 1 is no faster than level 0 (Discussion)', () => {
  for (const level of [0, 1]) {
    const run = findRun(data, 'native', level, largest, 1);
    assert.ok(run.times_ms.every((t) => Math.abs(t / run.median_ms - 1) < 0.05), `level ${level}: all within 5% of the median`);
    assert.ok(noise(run) < 0.2, `level ${level} IQR`);
  }
  // Level 1 on one thread is no faster than level 0 (within 5%), at the two largest sizes.
  for (const n of sizes.slice(-2)) {
    assert.ok(Math.abs(native(1, n, 1) / native(0, n, 1) - 1) < 0.05, `n=${n}`);
  }
});

test('level 1 thread scaling: about halving to two threads, a smaller gain to four, no loss at eight (Discussion, threaded.md)', () => {
  for (const n of sizes.slice(-2)) {
    const ratio = native(1, n, 1) / native(1, n, 2);
    assert.ok(ratio > 1.8 && ratio < 2.2, `n=${n} two threads: ${ratio}`);
    assert.ok(native(1, n, mostNative) <= native(1, n, physicalCores), `n=${n} eight no slower than four`);
  }
  // At the largest size the gain from four to eight threads is under a tenth.
  assert.ok(native(1, largest, physicalCores) / native(1, largest, mostNative) < 1.1);
  // Introduction: level 2 on one thread beats level 1 on all threads.
  assert.ok(native(2, largest, 1) < native(1, largest, mostNative));  // docs/levels/threaded.md: the speedup falls well short of the thread count, to four threads and to eight.
  assert.ok(native(1, largest, 1) / native(1, largest, physicalCores) < 0.9 * physicalCores);
  assert.ok(native(1, largest, 1) / native(1, largest, mostNative) < 0.9 * mostNative);
});

test('levels 2 to 5 stop scaling at the physical cores; level 2 gains a little more from the second four (Discussion, Conclusion)', () => {
  for (const level of [3, 4, 5]) {
    assert.ok(native(level, largest, 8) > 0.95 * native(level, largest, 4), `level ${level}`);
  }
  for (const level of [2, 3, 4, 5]) {
    assert.ok(native(level, largest, 1) / native(level, largest, 4) > 2, `level ${level} first four`);
    assert.ok(native(level, largest, 4) / native(level, largest, 8) < 1.15, `level ${level} second four`);
  }
  const gain = (level) => native(level, largest, 4) / native(level, largest, 8);
  assert.ok(gain(2) > gain(3) && gain(2) > gain(4) && gain(2) > gain(5));
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

test('level 3 gains much less over level 2 than level 2 over level 0, on one thread at the largest size (Discussion)', () => {
  const l2 = native(0, largest, 1) / native(2, largest, 1);
  const l3 = native(2, largest, 1) / native(3, largest, 1);
  assert.ok(l3 > 1, 'level 3 still faster');
  assert.ok(Math.log(l3) < 0.25 * Math.log(l2), `"much smaller": ${l3} against ${l2}`);
});

test('the growth of level 2\'s gain after n=512 is mostly level 0 slowing down (Discussion)', () => {
  // gain(n) / gain(512) = fall of level 0 / fall of level 2 (falls in throughput from n=512).
  for (const n of sizes.filter((size) => size > 512)) {
    const fall0 = gflops(0, 512, 1) / gflops(0, n, 1);
    const fall2 = gflops(2, 512, 1) / gflops(2, n, 1);
    const growth = fall0 / fall2;
    assert.ok(growth > 1, `n=${n}: the gain grows`);
    assert.ok(Math.log(fall0) > 0.5 * Math.log(growth) && fall0 > fall2, `n=${n}: level 0 falls ${fall0}, level 2 ${fall2}`);
  }
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

test('level 3 four-thread throughput falls after n=512 much more than one thread does (Discussion)', () => {
  assert.ok(gflops(3, 512, 4) / gflops(3, 1024, 4) > 1.2);
  assert.ok(gflops(3, 512, 4) / gflops(3, largest, 4) > 1.2);
  for (const n of [1024, largest]) {
    const one = Math.log(gflops(3, 512, 1) / gflops(3, n, 1));
    const four = Math.log(gflops(3, 512, 4) / gflops(3, n, 4));
    assert.ok(one > 0 && one < 0.6 * four, `n=${n}: one thread ${one}, four ${four}`);
  }
});

test('on one thread, level 4 loses less throughput after n=512 than level 3 does (Discussion)', () => {
  const fall = (level) => gflops(level, 512, 1) / gflops(level, largest, 1);
  assert.ok(fall(4) > 1 && fall(4) < fall(3), `level 4 falls ${fall(4)}, level 3 ${fall(3)}`);
});

test('the hardware probe: triad stops gaining at four threads, the peak keeps gaining, level 5 is far from the triad limit (Discussion)', () => {
  const triad = (t) => hardware.triad_gbs[t];
  const peak = (t) => hardware.peak_gflops[t];
  assert.ok(triad(physicalCores) > triad(1) && triad(mostNative) <= triad(physicalCores));
  // "kept gaining". Tight on the reference run (1.14): a re-run near 1.1 should prompt a
  // rewording, not a lower threshold.
  assert.ok(peak(mostNative) > 1.1 * peak(physicalCores));
  // Level 3's share of the test's rate falls from one thread to eight, and with eight
  // threads the test found more arithmetic than any level uses.
  assert.ok(gflops(3, largest, mostNative) / peak(mostNative) < gflops(3, largest, 1) / peak(1));
  for (const level of [1, 2, 3, 4, 5]) {
    assert.ok(gflops(level, largest, mostNative) < peak(mostNative), `level ${level}`);
  }
  // About 1 GB of tile reads (a strip of A and of B, 2 n * tile * 8 bytes, per output tile),
  // at the four-thread triad rate, is under a tenth of level 5's four-thread time.
  const [rows, cols] = data.parameters.tile;
  const tiles = (largest / rows) * (largest / cols);
  const bytes = tiles * (rows + cols) * largest * 8;
  assert.ok(bytes > 0.9e9 && bytes < 1.2e9, `about 1 GB: ${bytes}`);
  assert.ok(bytes / (triad(physicalCores) * 1e9) < 0.1 * native(5, largest, physicalCores) / 1000);
});

test('browser against native at the largest size (Discussion, Conclusion)', () => {
  const ratio = (level) => lite(level, largest) / native(level, largest, 1);
  for (const level of [2, 3, 4, 5]) assert.ok(ratio(level) > 1, `level ${level} slower in the browser`);
  // Levels 3 and 4, the two written around vector registers, lose least at every size; levels
  // 2 and 5 lose more.
  for (const n of sizes) {
    const r = (level) => lite(level, n) / native(level, n, 1);
    assert.ok(Math.max(r(3), r(4)) < Math.min(r(2), r(5)), `levels 3 and 4 closest among 2 to 5 at n=${n}`);
  }
  // Levels 0 and 1 are about the same as native at the largest size (within 6%), and well
  // over a third slower at n=1024.
  for (const level of [0, 1]) {
    assert.ok(Math.abs(ratio(level) - 1) < 0.06, `level ${level} about the same in the browser at the largest size`);
    assert.ok(lite(level, 1024) > 1.5 * native(level, 1024, 1), `level ${level} much slower in the browser at n=1024`);
  }
  // In the lite build level 4 is faster than level 3 at the two largest sizes (as it is
  // natively), and level 5 is much slower than level 3 at the largest (natively it is faster).
  for (const n of sizes.slice(-2)) assert.ok(lite(4, n) < lite(3, n), `lite level 4 ahead at n=${n}`);
  assert.ok(lite(5, largest) > 1.3 * lite(3, largest));
  // Threaded build: level 3 within about an eighth of native at the most threads (tight on
  // the reference run, 1.12), and no gain after four.
  const most = Math.max(...data.parameters.threads['browser-threads']);
  const threaded = (level, t) => ms('browser-threads', level, largest, t);
  const against = threaded(3, most) / native(3, largest, mostNative);
  assert.ok(against > 1 && against < 1.125, `threaded level 3 against native: ${against}`);
  assert.ok(threaded(3, most) > 0.95 * threaded(3, physicalCores));
  // One thread, against the single-threaded build: faster for levels 0, 2, 4 and 5, and
  // within 5% for levels 1 and 3.
  for (const level of [0, 2, 4, 5]) {
    assert.ok(threaded(level, 1) < lite(level, largest), `level ${level} faster in the threaded build`);
  }
  for (const level of [1, 3]) {
    assert.ok(Math.abs(threaded(level, 1) / lite(level, largest) - 1) < 0.05, `level ${level} about the same`);
  }
});

test('the hook: the textbook loop uses a small fraction of a test loop\'s rate on one core (Abstract, Introduction)', () => {
  // "a small fraction": the story only holds while the loop is well under a tenth of the probe.
  assert.ok(gflops(0, largest, 1) / hardware.peak_gflops[1] < 0.1);
});

test('the first clue: level 2 on one thread beats level 1 on every thread, and level 1 barely gains from four to eight (Abstract, Introduction, Discussion)', () => {
  for (const t of nativeThreads) {
    assert.ok(native(2, largest, 1) < native(1, largest, t), `level 1 at ${t} threads`);
  }
  // "barely": eight threads are less than a tenth faster than four.
  assert.ok(native(1, largest, mostNative) > 0.9 * native(1, largest, physicalCores));
});

test('the verdict: the fastest case at the largest size is level 5 on four threads (Abstract, Conclusion)', () => {
  const all = [];
  for (const level of [0, 1, 2, 3, 4, 5]) {
    for (const t of level === 0 ? [1] : data.parameters.threads.native) all.push([level, t, native(level, largest, t)]);
  }
  const fastest = all.reduce((a, b) => (b[2] < a[2] ? b : a));
  assert.deepEqual(fastest.slice(0, 2), [5, physicalCores]);
});

test('the opening: the textbook loop takes over half a minute and level 5 on four threads under two seconds at the largest size (Introduction heading)', () => {
  assert.ok(native(0, largest, 1) > 30000, `level 0: ${native(0, largest, 1)} ms`);
  assert.ok(native(5, largest, physicalCores) < 2000, `level 5: ${native(5, largest, physicalCores)} ms`);
});
