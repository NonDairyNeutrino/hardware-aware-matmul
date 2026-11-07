// The page's side of the playground's worker protocol: start a run, collect the results it
// streams back, and recover. No DOM and no worker of its own: the worker is injected, so the
// protocol is testable with a fake one.
//
// Protocol (messages carry the run's `id`; anything with another id is ignored):
//   page -> worker  { type: 'run', id, build, request }
//   worker -> page  { type: 'ready', id, build, pool, env, isolated }   module and pool are up
//                   { type: 'result', id, level, times_ms, hash, batch } one per level, in order;
//                                          each time is the mean of `batch` runs timed together
//                   { type: 'done', id, request }                        the clamped request that ran
//                   { type: 'error', id, message }
//
// A wasm call cannot be interrupted, and a panic inside the thread pool hangs the caller, so
// cancel, timeout and error all end the same way: terminate the worker. The next run starts a
// fresh one. Only a run that finished with `done` keeps its worker (and its thread pool).
//
// If the THREADED build fails to start (the worker errors before it is `ready`, or is not ready
// within `startTimeout`), the controller switches to the lite build for good and runs the same
// request again on a fresh worker, telling the page through `onFallback`. Nothing falls back
// once the pool is up, on cancel, or on the run's own timeout.

/**
 * @param {object} options
 * @param {() => {postMessage: Function, terminate: Function, onmessage: any, onerror: any}} options.makeWorker
 * @param {'threads'|'lite'} options.build
 * @param {(message: object) => void} [options.onMessage]  called with every message of the current run
 * @param {(note: {from: string, to: string, reason: string}) => void} [options.onFallback]
 *        called when the threaded build failed to start and the run moves to the lite build
 * @param {number} [options.startTimeout]  ms the threaded build may take to become ready
 */
export function createController({ makeWorker, build, onMessage = () => {}, onFallback = () => {}, startTimeout = 30000 }) {
  let worker = null;
  let nextId = 1;
  let current = null;

  const discardWorker = () => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  };

  /**
   * Starts a run. Resolves, never rejects, with `{ status, id, results, ready, ... }` where
   * status is 'done', 'cancelled', 'timeout' or 'error' (with `message`; `startFailed` if the
   * worker could not be made or failed before it was ready), and `fallback` if the threaded
   * build failed to start and the run was repeated on the lite build.
   */
  function start(request, { timeout }) {
    if (current) throw new Error('a run is already in progress');
    const first = attempt(request, { timeout });
    if (build !== 'threads') return first;
    return first.then((outcome) => {
      if (!outcome.startFailed) return outcome;
      const fallback = { from: 'threads', to: 'lite', reason: outcome.message };
      build = 'lite';
      onFallback(fallback);
      return attempt(request, { timeout }).then((second) => ({ ...second, fallback }));
    });
  }

  function attempt(request, { timeout }) {
    const id = nextId++;
    const results = [];
    let ready = null;
    return new Promise((resolve) => {
      let timer = null;
      let startTimer = null;
      const finish = (status, extra = {}) => {
        clearTimeout(timer);
        clearTimeout(startTimer);
        current = null;
        if (status !== 'done') discardWorker();
        resolve({ status, id, results, ready, ...extra });
      };
      try {
        worker ??= makeWorker();
        worker.onmessage = (event) => {
          const message = event.data;
          if (!message || message.id !== id) return;
          if (message.type === 'ready') {
            ready = message;
            clearTimeout(startTimer);
          }
          else if (message.type === 'result') results.push({ level: message.level, times_ms: message.times_ms, hash: message.hash, batch: message.batch ?? 1 });
          onMessage(message);
          if (message.type === 'done') finish('done', { request: message.request });
          else if (message.type === 'error') finish('error', { message: message.message, startFailed: ready === null });
        };
        worker.onerror = (event) => finish('error', { message: (event && event.message) || 'the worker failed', startFailed: ready === null });
        timer = setTimeout(() => finish('timeout', { timeout }), timeout);
        if (build === 'threads' && startTimeout < timeout) {
          startTimer = setTimeout(() => finish('error', {
            message: `the threaded build did not start within ${Math.round(startTimeout / 1000)} s`,
            startFailed: true,
          }), startTimeout);
        }
        current = { cancel: () => finish('cancelled') };
        worker.postMessage({ type: 'run', id, build, request });
      } catch (error) {
        finish('error', { message: (error && error.message) || String(error), startFailed: true });
      }
    });
  }

  return {
    start,
    cancel: () => current?.cancel(),
    get running() { return current !== null; },
    get hasWorker() { return worker !== null; },
    get build() { return build; },
  };
}
