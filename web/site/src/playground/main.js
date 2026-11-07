// The playground page: picks the build (threaded if the page is cross-origin isolated, else
// tries once to enable isolation through a service worker, else the single-threaded lite
// build), wires the form to the worker through the controller, and shows the results.
import { createController } from './controller.mjs';
import { ATTEMPTS_KEY, LEFT_ROOT_KEY, decide, leaveRootWorker } from './isolation.mjs';
import { DEFAULTS, clampRequest, timeoutMs } from './request.mjs';
import { createUi } from './ui.js';

const root = document.getElementById('playground');
const base = root.dataset.base;
const reference = JSON.parse(root.dataset.reference); // size -> the reference run's result hash
const query = new URLSearchParams(location.search);
const ui = createUi(root);

// A tiny WebAssembly module using a 128-bit SIMD instruction: it validates only in browsers
// that support WebAssembly SIMD, which both builds of the module need.
const SIMD_PROBE = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const supportsSimd = () => {
  try { return WebAssembly.validate(SIMD_PROBE); } catch { return false; }
};

const GATES = ['threads', 'lite', 'recover', 'fallback', 'migrate'];
// The gates serve a GATE=1 build (__GATE_BUILD__, astro.config.mjs) from http://127.0.0.1; in
// production the gate driver is not even built, and on a real site `?gate=` does nothing.
const gate = __GATE_BUILD__ && ['127.0.0.1', 'localhost'].includes(location.hostname) && GATES.includes(query.get('gate')) ? query.get('gate') : null;

const store = {
  get() { try { return Number(sessionStorage.getItem(ATTEMPTS_KEY) || 0); } catch { return 0; } },
  set(value) { try { sessionStorage.setItem(ATTEMPTS_KEY, String(value)); } catch { /* storage blocked */ } },
  clear() { try { sessionStorage.removeItem(ATTEMPTS_KEY); } catch { /* storage blocked */ } },
};

// Whether this tab already reloaded to leave the old root service worker. If storage is blocked
// the guard cannot work, so it reads as "already reloaded" and the page never reloads for it.
const leftRoot = {
  get() { try { return sessionStorage.getItem(LEFT_ROOT_KEY) === '1'; } catch { return true; } },
  set() { try { sessionStorage.setItem(LEFT_ROOT_KEY, '1'); return true; } catch { return false; } },
};

// The service worker's scope is the playground's own directory, not the site root: the script is
// served from playground/, so coi-serviceworker's default scope is /<base>playground/, and Vite
// writes the workers (and their wasm) under playground/_worker/ (astro.config.mjs). The page and
// its workers get the isolation headers; the paper's pages are not controlled. Earlier versions
// registered it at the site root. Production now serves a kill-switch at that URL, which removes
// the root registration on its next update check (src/playground/kill-switch-sw.js); this page
// does not wait for that: it unregisters the root registration itself and says whether the page
// is still controlled by that worker.
const SW_SCRIPT = `${base}playground/coi-serviceworker.js`;
async function removeRootServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  const rootScope = new URL(base, location.href).href;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((r) => r.scope === rootScope).map((r) => r.unregister()));
  } catch { /* nothing to clean up */ }
  return navigator.serviceWorker.controller?.scriptURL === new URL(`${base}coi-serviceworker.js`, location.href).href;
}

/** Resolves to 'threads' or 'lite' (never, if the page reloads to enable isolation). */
async function chooseBuild() {
  const controlledByRoot = await removeRootServiceWorker();
  if (leaveRootWorker({ controlledByRoot, reloaded: leftRoot.get() }) === 'reload' && leftRoot.set()) {
    // Its workers would get no isolation headers (isolation.mjs): reload once, uncontrolled.
    ui.setBanner('Removing an old service worker: this page will reload once.', 'info');
    location.reload();
    return new Promise(() => {});
  }
  const decision = decide({ isolated: self.crossOriginIsolated, attempts: store.get(), serviceWorkers: 'serviceWorker' in navigator });
  if (decision.action === 'threads') {
    store.clear();
    return { build: 'threads' };
  }
  if (decision.action === 'register') {
    store.set(1);
    ui.setBanner('Enabling multithreading: this page will reload once.', 'info');
    // coi-serviceworker registers itself, then reloads the page so the service worker's
    // headers apply. It is loaded here and nowhere else on the site.
    const script = document.createElement('script');
    script.src = SW_SCRIPT;
    document.head.append(script);
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return { build: 'lite', reason: 'the service worker did not start in time (reload the page to try again)' };
  }
  return { build: 'lite', reason: decision.reason };
}

async function main() {
  const context = { ui, reference, base, build: null, pool: 1, lastOutcome: null };
  if (!supportsSimd()) {
    ui.setBanner('This browser has no WebAssembly SIMD support, which the playground needs. Firefox 114, Chrome 91 and Safari 16.4 or later have it.', 'warning');
    ui.disableAll('The playground cannot run in this browser.');
    context.unsupported = true;
    if (gate) (await import('./gate.js')).runGate(gate, context);
    return;
  }
  ui.disableAll('Choosing how to run…');
  const { build, reason } = await chooseBuild();
  context.build = build;
  let maxThreads = build === 'threads' ? Math.min(navigator.hardwareConcurrency || 1, 8) : 1;
  context.pool = maxThreads;
  for (const control of root.querySelectorAll('input, select, button')) control.disabled = false;
  ui.setRunning(false);
  ui.lockThreads(build === 'lite');
  ui.setMaxThreads(maxThreads);
  ui.writeForm(clampRequest(DEFAULTS, { pool: maxThreads, build }));
  if (build === 'lite') {
    ui.setBanner(`Single-threaded mode: ${reason}. Threads are limited to 1, so the results will be slower than the threaded ones.`, 'warning');
  } else {
    ui.setBanner(null);
  }
  ui.setBuild(build === 'threads' ? `Threaded build (up to ${maxThreads} threads)` : 'Single-threaded (lite) build');
  ui.setStatus('Ready.');

  const requested = Number(query.get('timeout_ms'));
  const timeoutOverride = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 3600000) : 0;
  // The run being shown, and the results that arrived for it so far (reset by run()).
  let seen = [];
  let current = null;
  // The fallback gate makes the first worker fail to load, as a broken threaded start would.
  let failNextWorker = gate === 'fallback';
  const controller = createController({
    makeWorker: () => {
      if (failNextWorker) {
        failNextWorker = false;
        return new Worker(`${base}no-such-worker.js`, { type: 'module' });
      }
      return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    },
    build,
    onFallback: ({ reason: why }) => {
      // The threaded build failed to start: the controller reruns on the lite build from now on.
      context.build = 'lite';
      context.pool = maxThreads = 1;
      ui.lockThreads(true);
      ui.setMaxThreads(1);
      ui.writeForm(clampRequest(ui.readForm(), { pool: 1, build: 'lite' }));
      ui.setBanner(`The multithreaded build failed to start (${why}), so the playground switched to the single-threaded build. Reload the page to try threads again.`, 'warning');
    },
    onMessage: (message) => {
      if (message.type === 'ready') {
        const e = message.env;
        ui.setBuild(`${message.build === 'threads' ? `Threaded build, pool of ${message.pool} threads` : 'Single-threaded (lite) build'}; ${e.isa}; micro-tile ${e.micro_tile[0]}×${e.micro_tile[1]}`);
        ui.setStatus('Running…');
      } else if (message.type === 'result' && current) {
        // The controller forwards only the current run's messages, and run() resets `seen`.
        seen.push({ level: message.level, times_ms: message.times_ms, hash: message.hash, batch: message.batch ?? 1 });
        ui.showResults(seen, current.n, reference[current.n] ?? null, { final: false });
        ui.setStatus(`Running… ${ui.levelName(message.level)} done`);
      }
    },
  });
  context.controller = controller;

  /** Runs `request` (clamped by the caller) and shows the outcome. */
  async function run(request, { timeout = timeoutMs(request) } = {}) {
    seen = [];
    current = request;
    ui.clearResults();
    ui.setRunning(true);
    ui.setStatus('Starting (the first run loads the module)…');
    let outcome;
    try {
      outcome = await controller.start(request, { timeout });
    } catch (error) {
      outcome = { status: 'error', message: error?.message ?? String(error), results: [], timeout, startFailed: true };
    }
    current = null;
    // The request the worker ran (re-clamped by it: one thread after a fallback to lite), else ours.
    context.lastOutcome = { ...outcome, request: outcome.request ?? request };
    ui.setRunning(false);
    const final = outcome.status === 'done';
    if (outcome.results.length > 0) ui.showResults(outcome.results, request.n, reference[request.n] ?? null, { final });
    ui.setStatus({
      done: 'Done.',
      cancelled: 'Cancelled. The worker was restarted; the next run will reload the module.',
      timeout: `Stopped after ${(outcome.timeout / 1000).toFixed(0)} s (the time budget for this size). The worker was restarted.`,
      error: `The run failed: ${outcome.message}.${outcome.startFailed ? '' : ' The worker was restarted.'}`,
    }[outcome.status]);
    return outcome;
  }
  context.run = (request, options) => run(request, options);

  ui.elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (controller.running) return;
    const request = clampRequest(ui.readForm(), { pool: maxThreads, build: controller.build });
    ui.writeForm(request);
    run(request, timeoutOverride > 0 ? { timeout: timeoutOverride } : undefined);
  });
  ui.elements.cancel.addEventListener('click', () => controller.cancel());

  if (gate) (await import('./gate.js')).runGate(gate, context);
}

main();
