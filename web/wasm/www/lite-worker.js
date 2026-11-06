// Runs the lite (stable, single-threaded) build in a Web Worker: the same cases as
// the g2 gate, with no thread pool. The page posts { gate, expected }.
import init, { run_case } from '../pkg-lite/hardware_aware_matmul_web.js';
import { g2Cases } from './g2-cases.js';

self.onmessage = async (event) => {
  const { gate, expected } = event.data;
  const out = {
    gate,
    isolated: self.crossOriginIsolated,
    cores: navigator.hardwareConcurrency,
  };
  try {
    await init();
    out.cases = [];
    for (const c of g2Cases()) {
      const started = performance.now();
      const hash = run_case(c.level, c.n, c.threads, c.tile_k, c.tile_j);
      out.cases.push({ ...c, hash, ms: performance.now() - started, ok: hash === expected[String(c.n)] });
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
