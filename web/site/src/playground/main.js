// The playground page: picks the build (threaded if the page is cross-origin isolated, else
// tries once to enable isolation through a service worker, else the single-threaded lite
// build), wires the form to the worker through the controller, and shows the results.
import { createController } from './controller.mjs';
import { ATTEMPTS_KEY, decide } from './isolation.mjs';
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

const store = {
  get() { try { return Number(sessionStorage.getItem(ATTEMPTS_KEY) || 0); } catch { return 0; } },
  set(value) { try { sessionStorage.setItem(ATTEMPTS_KEY, String(value)); } catch { /* storage blocked */ } },
  clear() { try { sessionStorage.removeItem(ATTEMPTS_KEY); } catch { /* storage blocked */ } },
};

/** Resolves to 'threads' or 'lite' (never, if the page reloads to enable isolation). */
async function chooseBuild() {
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
    script.src = `${base}coi-serviceworker.js`;
    document.head.append(script);
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return { build: 'lite', reason: 'the service worker did not start in time' };
  }
  return { build: 'lite', reason: decision.reason };
}

async function main() {
  const context = { ui, reference, base, build: null, pool: 1, lastOutcome: null };
  if (!supportsSimd()) {
    ui.setBanner('This browser has no WebAssembly SIMD support, which the playground needs. Firefox 89, Chrome 91 and Safari 16.4 or later have it.', 'warning');
    ui.disableAll('The playground cannot run in this browser.');
    context.unsupported = true;
    if (query.get('gate')) (await import('./gate.js')).runGate(query.get('gate'), context);
    return;
  }
  ui.disableAll('Choosing how to run…');
  const { build, reason } = await chooseBuild();
  context.build = build;
  const maxThreads = build === 'threads' ? Math.min(navigator.hardwareConcurrency || 1, 8) : 1;
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

  const timeoutOverride = Number(query.get('timeout_ms'));
  const results = [];
  const controller = createController({
    makeWorker: () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
    build,
    onMessage: (message) => {
      if (message.type === 'ready') {
        const e = message.env;
        ui.setBuild(`${build === 'threads' ? `Threaded build, pool of ${message.pool} threads` : 'Single-threaded (lite) build'}; ${e.isa}; micro-tile ${e.micro_tile[0]}×${e.micro_tile[1]}`);
        ui.setStatus('Running…');
      }
    },
  });
  context.controller = controller;

  /** Runs `request` (clamped by the caller) and shows the outcome. */
  async function run(request, { timeout = timeoutMs(request) } = {}) {
    ui.clearResults();
    ui.setRunning(true);
    ui.setStatus('Starting (the first run loads the module)…');
    results.length = 0;
    const outcome = await controller.start(request, { timeout });
    context.lastOutcome = { ...outcome, request };
    ui.setRunning(false);
    const final = outcome.status === 'done';
    if (outcome.results.length > 0) ui.showResults(outcome.results, request.n, reference[request.n] ?? null, { final });
    ui.setStatus({
      done: 'Done.',
      cancelled: 'Cancelled. The worker was restarted; the next run will reload the module.',
      timeout: `Stopped after ${(outcome.timeout / 1000).toFixed(0)} s (the time budget for this size). The worker was restarted.`,
      error: `The run failed: ${outcome.message}. The worker was restarted.`,
    }[outcome.status]);
    return outcome;
  }
  context.run = (request, options) => run(request, options);
  context.timeoutOverride = timeoutOverride;

  ui.elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (controller.running) return;
    const request = clampRequest(ui.readForm(), { pool: maxThreads, build });
    ui.writeForm(request);
    run(request, timeoutOverride > 0 ? { timeout: timeoutOverride } : undefined);
  });
  ui.elements.cancel.addEventListener('click', () => controller.cancel());

  if (query.get('gate')) (await import('./gate.js')).runGate(query.get('gate'), context);
}

main();
