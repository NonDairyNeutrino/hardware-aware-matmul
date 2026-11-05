// Runs a gate inside a Web Worker. The page posts { gate, threads, expected }.
import init, {
  initThreadPool,
  pool_threads,
  sum_squares,
  run_case,
  run_case_std,
} from '../pkg/naive_matmul_web.js';

function g2Cases() {
  const cases = [];
  for (const n of [256, 512]) {
    cases.push({ level: 0, n, threads: 1, tile_k: 32, tile_j: 64 });
    for (const level of [1, 2, 3]) {
      for (const threads of [1, 2, 4]) {
        cases.push({ level, n, threads, tile_k: 32, tile_j: 64 });
      }
    }
  }
  cases.push({ level: 3, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  cases.push({ level: 2, n: 256, threads: 4, tile_k: 1, tile_j: 1 });
  return cases;
}

self.onmessage = async (event) => {
  const { gate, threads, expected } = event.data;
  const out = {
    gate,
    isolated: self.crossOriginIsolated,
    cores: navigator.hardwareConcurrency,
  };
  try {
    await init();
    const started = performance.now();
    await initThreadPool(threads);
    out.pool_init_ms = performance.now() - started;
    out.pool_threads = pool_threads();

    if (gate === 'g1') {
      out.sum = String(sum_squares(5_000_000));
    } else if (gate === 'g2') {
      out.cases = [];
      for (const c of g2Cases()) {
        const t0 = performance.now();
        const hash = run_case(c.level, c.n, c.threads, c.tile_k, c.tile_j);
        out.cases.push({ ...c, hash, ms: performance.now() - t0, ok: hash === expected[String(c.n)] });
      }
    } else if (gate === 'probe') {
      // Runs last and on its own: a trap can leave the module unusable.
      try {
        out.std_hash = run_case_std(1, 64, 2, 32, 64);
        out.std_runner_works = true;
      } catch (e) {
        out.std_runner_works = false;
        out.std_error = String(e);
      }
    } else {
      throw new Error('unknown gate: ' + gate);
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
