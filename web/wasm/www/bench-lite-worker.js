// Runs the reference run's benchmark matrix on the lite (stable, single-threaded) build.
// The page posts { sizes, threads, repeats, warmup }.
import init, { bench_prepare, bench_multiply, bench_hash, env_info } from '../pkg-lite/hardware_aware_matmul_web.js';
import { runBench, BLOCK, TILE } from './bench-run.js';

self.onmessage = async (event) => {
  const params = event.data;
  const out = { kind: 'browser-lite', isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency, parameters: { ...params, block: BLOCK, tile: TILE } };
  try {
    await init();
    out.env = JSON.parse(env_info());
    out.runs = runBench({ bench_prepare, bench_multiply, bench_hash }, params);
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
