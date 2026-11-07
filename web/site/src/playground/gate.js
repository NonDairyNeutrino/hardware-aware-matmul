// Automated runs of the playground for the browser gates (web/site/gate-c3.sh), chosen by
// `?gate=threads|lite|recover` in the URL. They drive the real page and POST a report that
// web/dev/check_report.py judges. A normal visit never uses this module.
import { DEFAULTS, clampRequest } from './request.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, timeoutMs, what) {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

async function post(report) {
  await fetch('/report', { method: 'POST', body: JSON.stringify(report) });
}

export async function runGate(name, context) {
  const { ui, base } = context;
  const report = {
    gate: `playground-${name}`,
    base,
    build: context.build,
    isolated: self.crossOriginIsolated,
    service_workers: 'serviceWorker' in navigator,
    unsupported: Boolean(context.unsupported),
  };
  try {
    if (context.unsupported) throw new Error('the browser has no WebAssembly SIMD');
    const expected = await (await fetch(`${base}expected.json`)).json();
    report.expected_hash = expected['64'];
    const small = clampRequest({ ...DEFAULTS, n: 64, threads: 2, repeats: 1 }, { pool: context.pool, build: context.build });
    report.threads_control_disabled = ui.elements.form.elements.threads.disabled;
    report.banner = ui.elements.banner.hidden ? null : ui.elements.banner.textContent;

    if (name === 'threads' || name === 'lite') {
      // The real page path: fill the form, press Run, read what the page shows.
      ui.writeForm(small);
      ui.elements.form.requestSubmit();
      await waitFor(() => context.lastOutcome && !context.controller.running, 120000, 'the run to finish');
      const outcome = context.lastOutcome;
      report.status = outcome.status;
      report.pool = outcome.ready?.pool ?? null;
      report.env = outcome.ready?.env ?? null;
      report.threads_used = outcome.request?.threads ?? null;
      report.results = outcome.results.map((r) => ({ level: r.level, median_ms: r.times_ms.reduce((a, b) => a + b, 0) / r.times_ms.length, hash: r.hash }));
      report.rows = [...document.querySelectorAll('#pg-table tbody tr')].map((tr) => tr.firstChild.textContent);
      report.table_text = document.querySelector('#pg-table').textContent;
      report.batches = outcome.results.map((r) => r.batch);
      report.verdict_ok = ui.elements.verdict.dataset.ok === 'true';
      report.verdict_text = ui.elements.verdict.textContent;
      report.build_text = ui.elements.build.textContent;
    } else if (name === 'recover') {
      // Cancel, time out, and then prove the page still works with a fresh worker.
      const big = clampRequest({ n: 1024, levels: [0, 1, 2, 3, 4], threads: 2, repeats: 5 }, { pool: context.pool, build: context.build });
      const first = context.run(big, { timeout: 120000 });
      await waitFor(() => context.controller.running, 5000, 'the big run to start');
      await wait(800);
      context.controller.cancel();
      const cancelled = await first;
      const timedOut = await context.run(big, { timeout: 300 });
      const recovered = await context.run(small);
      report.cancel_status = cancelled.status;
      report.timeout_status = timedOut.status;
      report.recovery_status = recovered.status;
      report.recovery_hashes = recovered.results.map((r) => r.hash);
      report.recovery_levels = recovered.results.map((r) => r.level);
      report.verdict_ok = ui.elements.verdict.dataset.ok === 'true';
    } else {
      throw new Error(`unknown gate: ${name}`);
    }
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String((error && error.stack) || error);
  }
  await post(report);
}
