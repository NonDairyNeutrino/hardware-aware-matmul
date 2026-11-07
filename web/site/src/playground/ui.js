// The playground's DOM: reads the form, shows the status, the build, the results table with
// bars, and the "same answer" verdict. No logic about workers or isolation lives here.
import { LIMITS } from './request.mjs';
import { summarise, verdict } from './summary.mjs';

const LEVEL_NAMES = ['Level 0: naive', 'Level 1: threaded', 'Level 2: cache blocking', 'Level 3: SIMD', 'Level 4: streaming'];

const formatMs = (ms) => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  if (ms >= 1) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(3)} ms`;
};

export function createUi(root) {
  const $ = (selector) => root.querySelector(selector);
  const form = $('#pg-form');
  const elements = {
    form,
    run: $('#pg-run'),
    cancel: $('#pg-cancel'),
    status: $('#pg-status'),
    banner: $('#pg-banner'),
    build: $('#pg-build'),
    body: $('#pg-table tbody'),
    table: $('#pg-table'),
    verdict: $('#pg-verdict'),
  };

  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };

  return {
    /** The values currently in the form (unclamped: the controller clamps them). */
    readForm() {
      const data = new FormData(form);
      const number = (name) => Number(data.get(name));
      return {
        n: number('n'),
        levels: LIMITS.levels.filter((level) => data.getAll('levels').includes(String(level))),
        threads: number('threads'),
        repeats: number('repeats'),
        block: [number('block-k'), number('block-j')],
        tile: [number('tile-rows'), number('tile-cols'), number('tile-depth')],
      };
    },
    /** Puts a (clamped) request back into the form. */
    writeForm(request) {
      form.elements.n.value = String(request.n);
      for (const box of form.querySelectorAll('input[name="levels"]')) box.checked = request.levels.includes(Number(box.value));
      form.elements.threads.value = String(request.threads);
      form.elements.repeats.value = String(request.repeats);
      form.elements['block-k'].value = String(request.block[0]);
      form.elements['block-j'].value = String(request.block[1]);
      form.elements['tile-rows'].value = String(request.tile[0]);
      form.elements['tile-cols'].value = String(request.tile[1]);
      form.elements['tile-depth'].value = String(request.tile[2]);
    },
    /** Limits the threads control to what the build can use. */
    setMaxThreads(max) {
      form.elements.threads.max = String(max);
      form.elements.threads.disabled = max <= 1;
      if (Number(form.elements.threads.value) > max) form.elements.threads.value = String(max);
    },
    setBanner(message, kind = 'info') {
      elements.banner.hidden = !message;
      elements.banner.textContent = message ?? '';
      elements.banner.dataset.kind = kind;
    },
    setBuild(message) { elements.build.textContent = message; },
    setStatus(message) { elements.status.textContent = message; },
    levelName(level) { return LEVEL_NAMES[level]; },
    setRunning(running) {
      elements.run.disabled = running;
      elements.cancel.disabled = !running;
      for (const control of form.querySelectorAll('input, select')) control.disabled = running;
      // The lite build has one thread: that control stays locked when the run ends.
      if (!running) form.elements.threads.disabled = form.elements.threads.dataset.locked === 'true';
      elements.table.setAttribute('aria-busy', String(running));
      // Keep the keyboard on a usable control, but never take focus from somewhere else.
      const active = document.activeElement;
      if (running) elements.cancel.focus();
      else if (active === document.body || active === elements.cancel || active === null) elements.run.focus();
    },
    /** Locks the controls the build cannot use (the lite build has one thread). */
    lockThreads(locked) {
      form.elements.threads.dataset.locked = String(locked);
      form.elements.threads.disabled = locked;
    },
    disableAll(reason) {
      for (const control of form.querySelectorAll('input, select, button')) control.disabled = true;
      elements.status.textContent = reason;
    },
    /** Shows the table and the verdict for the results so far. */
    showResults(results, n, reference, { final }) {
      const summary = summarise(results, n);
      elements.body.replaceChildren(...summary.rows.map((row) => {
        const tr = document.createElement('tr');
        tr.append(text('th', LEVEL_NAMES[row.level]));
        tr.lastChild.scope = 'row';
        tr.append(text('td', row.timed ? formatMs(row.median_ms) : 'too fast to time'));
        tr.lastChild.title = `fastest ${formatMs(row.min_ms)}, slowest ${formatMs(row.max_ms)}` +
          (row.batch > 1 ? `; each time is the mean of ${row.batch} runs timed together` : '');
        tr.append(text('td', row.gflops === null ? '' : `${row.gflops.toFixed(1)} GFLOP/s`));
        tr.append(text('td', row.vsNaive === null ? '' : `${row.vsNaive.toFixed(1)}×`));
        tr.append(text('td', row.vsPrevious === null ? '' : `${row.vsPrevious.toFixed(1)}×`));
        const bar = document.createElement('td');
        const fill = document.createElement('span');
        fill.className = 'pg-bar';
        fill.style.width = `${Math.max(2, row.bar * 100).toFixed(1)}%`;
        fill.setAttribute('aria-hidden', 'true');
        bar.append(fill);
        tr.append(bar);
        return tr;
      }));
      elements.table.parentElement.hidden = elements.table.hidden = summary.rows.length === 0;
      if (final) {
        const v = verdict(summary, reference);
        elements.verdict.hidden = false;
        elements.verdict.dataset.ok = String(v.ok);
        elements.verdict.textContent = `${v.ok ? '✓' : '✗'} ${v.text}`;
      } else {
        elements.verdict.hidden = true;
      }
      return summary;
    },
    clearResults() {
      elements.body.replaceChildren();
      elements.table.parentElement.hidden = elements.table.hidden = true;
      elements.verdict.hidden = true;
    },
    elements,
  };
}
