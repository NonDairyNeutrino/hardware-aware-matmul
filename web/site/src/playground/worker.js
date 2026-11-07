// The playground's Web Worker: it owns the wasm module (threaded or lite, chosen by the page)
// and runs benchmark requests through the bench API, streaming one result per level. The page
// never calls wasm directly; see controller.mjs for the protocol and for why cancel and
// timeout end by terminating this worker.
import { chooseBatch, timeSample } from './batching.mjs';
import { clampRequest } from './request.mjs';

let loaded = null; // { build, api, pool, env }

/** Loads and starts the module for `build` once per worker. */
async function load(build) {
  if (loaded && loaded.build === build) return loaded;
  const api = build === 'threads'
    ? await import('../../../wasm/pkg/hardware_aware_matmul_web.js')
    : await import('../../../wasm/pkg-lite/hardware_aware_matmul_web.js');
  await api.default();
  let pool = 1;
  if (build === 'threads') {
    // The pool is fixed for the life of the worker; the threads control is the number of jobs
    // handed to it, up to this size.
    await api.initThreadPool(Math.min(self.navigator.hardwareConcurrency || 1, 8));
    pool = api.pool_threads();
  }
  loaded = { build, api, pool, env: JSON.parse(api.env_info()) };
  return loaded;
}

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || message.type !== 'run') return;
  const { id, build } = message;
  try {
    const { api, pool, env } = await load(build);
    self.postMessage({ type: 'ready', id, build, pool, env, isolated: self.crossOriginIsolated });
    // Clamp again here: the worker trusts nothing it is sent.
    const request = clampRequest(message.request, { pool, build });
    api.bench_prepare(request.n);
    for (const level of request.levels) {
      const run = () => api.bench_multiply(
        level, request.threads, request.block[0], request.block[1],
        request.tile[0], request.tile[1], request.tile[2],
      );
      run(); // one untimed warm-up per level
      // On a page that is not cross-origin isolated the clock is coarse (about 1 ms), so short runs
      // are timed in batches and divided; long ones have a batch of 1 and are timed directly.
      const now = () => performance.now();
      const batch = chooseBatch(run, now);
      const times = [];
      for (let i = 0; i < request.repeats; i += 1) times.push(Number(timeSample(run, now, batch).toFixed(4)));
      self.postMessage({ type: 'result', id, level, times_ms: times, hash: api.bench_hash(), batch });
    }
    self.postMessage({ type: 'done', id, request });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String((error && error.message) || error) });
  }
};
