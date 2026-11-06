// One limits probe per fresh Worker (a trap can leave a module unusable).
// The page posts { kind, ... }; this replies with what happened.
import init, {
  initThreadPool,
  pool_threads,
  run_case,
  memory_probe,
  panic_probe,
} from '../pkg/naive_matmul_web.js';

self.onmessage = async (event) => {
  const message = event.data;
  const out = { outcome: 'ok' };
  try {
    await init();
    if (message.kind === 'pool') {
      const started = performance.now();
      await initThreadPool(message.threads);
      out.init_ms = performance.now() - started;
      out.pool_threads = pool_threads();
      const ran = performance.now();
      out.hash = run_case(3, 256, message.threads, 32, 64);
      out.run_ms = performance.now() - ran;
    } else if (message.kind === 'reinit') {
      await initThreadPool(4);
      out.first_pool = pool_threads();
      try {
        await initThreadPool(2);
        out.second_init = 'ok';
        out.second_pool = pool_threads();
      } catch (e) {
        out.second_init = 'error';
        out.second_error = String(e);
        out.pool_after = pool_threads();
      }
    } else if (message.kind === 'panic') {
      await initThreadPool(4);
      try {
        panic_probe();
        out.panic_probe = 'returned';
      } catch (e) {
        out.panic_probe = 'threw';
        out.panic_error = String(e);
      }
      try {
        out.still_usable = run_case(1, 64, 2, 32, 64);
      } catch (e) {
        out.still_usable = 'no: ' + String(e);
      }
    } else if (message.kind === 'memory') {
      out.checksum = String(memory_probe(message.mib));
    } else {
      throw new Error('unknown probe: ' + message.kind);
    }
  } catch (e) {
    out.outcome = 'error';
    out.error = String((e && e.message) || e);
  }
  self.postMessage(out);
};
