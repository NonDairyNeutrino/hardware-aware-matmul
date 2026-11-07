import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { data, run } from './fixture.mjs';
import { NOISY, bestTable, scalingChart, scalingTable, sizeChart, throughputChart } from './render.mjs';

const count = (haystack, needle) => haystack.split(needle).length - 1;

test('the best-configuration table has one row per level with the numbers from the data', () => {
  const html = bestTable(data, { environment: 'native' });
  assert.equal(count(html, '<tr>'), 6); // header + 5 levels
  assert.match(html, /<figcaption id="table-native-best-128">Native, n = 128: median of 3 runs\. "vs level 0" is the speedup/);
  assert.match(html, /<table class="results" aria-labelledby="table-native-best-128">/);
  assert.match(html, /<div class="table-scroll" tabindex="0" role="region" aria-labelledby="table-native-best-128">/);
  // level 3 at 2 threads: 1000 / 6 ms, 6.0 times faster than level 0 (1 s)
  assert.match(html, /<th scope="row">Level 3: SIMD<\/th><td>2<\/td><td>167 ms<\/td><td>[\d.]+ GFLOP\/s<\/td><td>6\.0×<\/td><td>2%<\/td>/);
  assert.match(html, /<th scope="row">Level 0: naive<\/th><td>1<\/td><td>1\.0 s<\/td>/);
  assert.doesNotMatch(html, /†|NaN|undefined/);
});

test('a noisy case is marked with a dagger and the table says what it means', () => {
  const noisy = structuredClone(data);
  const target = noisy.runs.find((r) => r.environment === 'native' && r.level === 3 && r.n === 128 && r.threads === 2);
  target.times_ms = [target.median_ms * 0.5, target.median_ms, target.median_ms * 1.5];
  const html = bestTable(noisy, { environment: 'native' });
  assert.match(html, /<td class="noisy">50% †<\/td>/);
  assert.match(html, /table-note">† The interquartile range is above 20%/);
});

test('the scaling table shows each thread count with the speedup over one thread', () => {
  const html = scalingTable(data, { environment: 'native', n: 64 });
  assert.match(html, /<th scope="col">1 thread<\/th><th scope="col">2 threads<\/th>/);
  // level 2: 500 ms with 1 thread, 250 ms with 2
  assert.match(html, /Level 2: cache blocking<\/th><td>500 ms \(1\.0×\)<\/td><td>250 ms \(2\.0×\)<\/td>/);
  assert.equal(count(html, '<tr>'), 5);
  assert.match(html, /<div class="table-scroll" tabindex="0" role="region" aria-labelledby="table-native-scaling-64">/);
});

test('the throughput chart is an accessible SVG with a bar per level and environment', () => {
  const html = throughputChart(data, {});
  assert.match(html, /<div class="chart-scroll" tabindex="0" role="region" aria-labelledby="throughput-128-title"><svg viewBox/);
  assert.match(html, /<\/svg><\/div><figcaption>/);
  assert.match(html, /<svg viewBox="0 0 640 320" role="img" aria-labelledby="throughput-128-title throughput-128-desc">/);
  assert.match(html, /<title id="throughput-128-title">Throughput of each level, n = 128<\/title>/);
  // two environments in the fixture: 5 bars each, plus one legend swatch each
  assert.equal(count(html, 'class="bar bar-native"'), 6);
  assert.equal(count(html, 'class="bar bar-browser-lite"'), 6);
  assert.match(html, /<desc id="throughput-128-desc">GFLOP\/s at the largest thread count\. Native: level 0 [\d.]+, level 1 [\d.]+/);
  assert.equal(count(html, '<svg'), 1);
  assert.equal(count(html, '</svg>'), 1);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the scaling chart has a line per level over the measured thread counts, and the ideal', () => {
  const html = scalingChart(data, { environment: 'native', n: 64 });
  for (const level of [1, 2, 3, 4]) assert.equal(count(html, `<polyline class="line line-${level}"`), 1);
  assert.equal(count(html, '<polyline class="ideal"'), 1);
  assert.equal(count(html, '<circle'), 8); // 4 levels x 2 thread counts
  assert.match(html, /<div class="chart-scroll" tabindex="0" role="region" aria-labelledby="scaling-native-64-title"><svg/);
  assert.match(html, /<title id="scaling-native-64-title">Thread scaling, native, n = 64<\/title>/);
  // every level in the fixture scales perfectly: 2 threads is 2.0x
  assert.match(html, /level 1: 1 thread 1\.0×, 2 threads 2\.0×/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

// The fixture's own throughputs are tiny, so the numbers are checked on a copy 1000 times faster.
const fastData = {
  ...data,
  runs: data.runs.map((r) => run(r.environment, r.level, r.n, r.threads, r.median_ms / 1000)),
};

test('the size chart has a line per level, a dot per size and the numbers in its description', () => {
  const html = sizeChart(fastData, { environment: 'native' });
  for (let level = 0; level <= 4; level += 1) {
    assert.equal(count(html, `<polyline class="line line-${level}"`), 1);
    assert.equal(count(html, `<circle class="dot line-${level}"`), 2);
  }
  assert.match(html, /<div class="chart-scroll" tabindex="0" role="region" aria-labelledby="size-native-1-title"><svg/);
  assert.match(html, /<title id="size-native-1-title">Throughput against matrix size, native, one thread<\/title>/);
  // 2n^3 / (1 ms) at n = 64 and 128 for level 0; level L at one thread takes 1/L of that time
  assert.match(html, /level 0: n = 64 0\.5, n = 128 4\.2\./);
  assert.match(html, /level 4: n = 64 2\.1, n = 128 16\.8\./);
  assert.match(html, /matrix size n<\/text>/);
  assert.match(html, />64<\/text>/);
  assert.match(html, />128<\/text>/);
  assert.match(html, /<figcaption>Native, one thread: throughput in GFLOP\/s \(higher is faster\) of each level against the matrix size\. The size axis is logarithmic: each tick doubles the size\.<\/figcaption>/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  assert.doesNotMatch(sizeChart(data, { environment: 'native' }), /NaN|undefined|Infinity/);
});

test('the size chart takes a thread count for levels 1 to 4 and keeps level 0 at one thread', () => {
  const html = sizeChart(fastData, { environment: 'native', threads: 2 });
  assert.match(html, /id="size-native-2-title"/);
  assert.match(html, /Native, 2 threads: throughput/);
  assert.match(html, /level 0: n = 64 0\.5, n = 128 4\.2\./);
  assert.match(html, /level 1: n = 64 1\.0, n = 128 8\.4\./);
  assert.match(html, /level 4: n = 64 4\.2, n = 128 33\.6\./);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  assert.throws(() => sizeChart(data, { environment: 'native', threads: 3 }), /no measurement/);
});

test('chart ids are unique when two sizes are rendered', () => {
  const ids = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const all = [
    ...ids(throughputChart(data, { n: 64 })), ...ids(throughputChart(data, { n: 128 })),
    ...ids(scalingChart(data, { environment: 'native', n: 64 })), ...ids(scalingChart(data, { environment: 'native', n: 128 })),
  ];
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 8);
});

test('the scaling chart axis grows to hold a superlinear speedup', () => {
  const fast = structuredClone(data);
  // level 3 at 2 threads becomes 5x faster than at 1 thread: above the 2x ideal line
  const one = fast.runs.find((r) => r.environment === 'native' && r.level === 3 && r.n === 64 && r.threads === 1);
  const two = fast.runs.find((r) => r.environment === 'native' && r.level === 3 && r.n === 64 && r.threads === 2);
  two.median_ms = one.median_ms / 5;
  const html = scalingChart(fast, { environment: 'native', n: 64 });
  assert.match(html, />5×<\/text>/); // the top tick is the largest speedup, not the thread count
  assert.match(html, /level 3: 1 thread 1\.0×, 2 threads 5\.0×/);
  assert.doesNotMatch(html, /cy="-/);
});

test('missing measurements are an error, never a silent gap', () => {
  assert.throws(() => bestTable(data, { environment: 'browser-threads' }), /no measurement for browser-threads/);
  assert.throws(() => scalingTable(data, { environment: 'native', n: 999 }), /no measurement/);
});

test('the real results.json renders every table and chart without gaps', () => {
  const real = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url), 'utf8'));
  for (const environment of ['native', 'browser-lite', 'browser-threads']) {
    assert.doesNotMatch(bestTable(real, { environment }), /NaN|undefined/);
  }
  for (const environment of ['native', 'browser-threads']) {
    assert.doesNotMatch(scalingTable(real, { environment }), /NaN|undefined/);
    assert.doesNotMatch(scalingChart(real, { environment }), /NaN|undefined|Infinity/);
  }
  assert.doesNotMatch(throughputChart(real, {}), /NaN|undefined|Infinity/);
});

test('the noise threshold is the 20% that docs/paper/results.md states', () => {
  // The prose says "IQR is above 20%": change both together.
  assert.equal(NOISY, 0.2);
});
