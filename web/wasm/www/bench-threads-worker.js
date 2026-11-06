// Runs the reference run's benchmark matrix on the threaded build, with a pool of
// `pool` threads. The page posts { sizes, threads, repeats, warmup, pool }.
import init, {
  initThreadPool,
  pool_threads,
  bench_prepare,
  bench_multiply,
  bench_hash,
  env_info,
} from '../pkg/hardware_aware_matmul_web.js';
import { runBench } from './bench-run.js';

self.onmessage = async (event) => {
  const params = event.data;
  const out = { kind: 'browser-threads', isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency, parameters: params };
  try {
    await init();
    await initThreadPool(params.pool);
    out.pool_threads = pool_threads();
    out.env = JSON.parse(env_info());
    out.runs = runBench({ bench_prepare, bench_multiply, bench_hash }, params);
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
