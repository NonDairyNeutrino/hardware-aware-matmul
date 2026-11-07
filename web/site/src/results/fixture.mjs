// A small made-up dataset shaped like results.json, for the tests of the lookup and the
// renderers: two sizes, native with 1 and 2 threads, one single-threaded browser build.
// Native level L at T threads takes 1000 / (L * T) ms (level 0: 1000 ms) and browser-lite
// level L takes 4000 / (L + 1) ms, so every expected number can be worked out by hand.
// The caches and the hardware probe (triad bandwidth, arithmetic peak) are made up too;
// the peaks are tiny so that the levels' share of them is a readable percentage.
export function run(environment, level, n, threads, median) {
  const times = [median * 0.98, median, median * 1.02];
  return {
    environment, level, n, threads, repeats: 3, times_ms: times, median_ms: median,
    min_ms: times[0], max_ms: times[2], gflops: (2 * n ** 3) / (median / 1000) / 1e9, hash: 'h',
  };
}
export const data = {
  schema: 1,
  generated: '2026-11-06T21:32:04Z',
  environment: {
    cpu: 'Test CPU', logical_cores: 8, physical_cores: 4, governor: 'performance', os: 'TestOS',
    commit: 'abcdef0123456789', firefox: 'Mozilla Firefox 1.0', native_isa: 'SSE2',
    browser_isa: 'WASM SIMD128', browser_pool: 8, rustflags: '',
    browser_isolated: { 'browser-lite': true, 'browser-threads': true },
    toolchains: { native: 'rustc N', 'browser-lite': 'rustc L', 'browser-threads': 'rustc T' },
    caches: [
      { level: 1, type: 'Data', size_bytes: 49152, shared_cpu_list: '0,4' },
      { level: 1, type: 'Instruction', size_bytes: 32768, shared_cpu_list: '0,4' },
      { level: 2, type: 'Unified', size_bytes: 1310720, shared_cpu_list: '0,4' },
      { level: 3, type: 'Unified', size_bytes: 8388608, shared_cpu_list: '0-7' },
    ],
    hardware: {
      triad_gbs: { 1: 10.04, 2: 15.06 },
      peak_gflops: { 1: 0.02, 2: 0.05 },
    },
  },
  parameters: {
    sizes: [64, 128], repeats: 3, warmup: 1, block: [32, 64], tile: [128, 128, 128],
    threads: { native: [1, 2], 'browser-lite': [1], 'browser-threads': [1, 2] },
  },
  runs: [
    ...[64, 128].flatMap((n) => [
      run('native', 0, n, 1, 1000),
      ...[1, 2].flatMap((t) => [1, 2, 3, 4].map((l) => run('native', l, n, t, 1000 / (l * t)))),
      ...[0, 1, 2, 3, 4].map((l) => run('browser-lite', l, n, 1, 4000 / (l + 1))),
    ]),
  ],
};
