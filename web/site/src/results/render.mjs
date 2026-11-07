// Builds the Results page's tables and charts as static HTML and SVG from the reference
// run's data, at build time: no JavaScript on the page, and every number comes from
// results.json. (The prose cites numbers through placeholders; see lookup.mjs.)
import {
  ENVIRONMENTS, defaultThreads, findRun, formatGflops, formatMs, formatPercent, formatSpeedup, noise,
  threadCounts,
} from './lookup.mjs';

/** Cases whose interquartile range exceeds this share of the median are marked as noisy. */
export const NOISY = 0.2;

export const LEVEL_NAMES = [
  'Level 0: naive', 'Level 1: threaded', 'Level 2: cache blocking', 'Level 3: SIMD', 'Level 4: streaming',
];
export const ENVIRONMENT_LABELS = {
  native: 'Native',
  'browser-lite': 'Browser, lite build (one thread)',
  'browser-threads': 'Browser, threaded build',
};
const ENVIRONMENT_SHORT = { native: 'native', 'browser-lite': 'lite', 'browser-threads': 'threaded' };

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sizeOf(data, n) {
  return n ?? Math.max(...data.parameters.sizes);
}

function mustFind(data, environment, level, n, threads) {
  const run = findRun(data, environment, level, n, threads);
  if (!run) throw new Error(`no measurement for ${environment}, level ${level}, n=${n}, ${threads} thread(s)`);
  return run;
}

/** Marks a noisy case with a dagger. */
function noiseCell(run) {
  const value = noise(run);
  return value > NOISY
    ? `<td class="noisy">${formatPercent(value)} †</td>`
    : `<td>${formatPercent(value)}</td>`;
}

const NOISE_NOTE = `<p class="table-note">† The interquartile range is above ${Math.round(NOISY * 100)}% of the median: treat these figures as indicative.</p>`;

/**
 * One row per level at the environment's largest thread count (level 0 with 1): median,
 * throughput, speedup over level 0 in the same environment, and the noise.
 */
export function bestTable(data, { environment, n }) {
  const size = sizeOf(data, n);
  const baseline = mustFind(data, environment, 0, size, 1);
  let anyNoisy = false;
  const rows = [0, 1, 2, 3, 4].map((level) => {
    const run = mustFind(data, environment, level, size, defaultThreads(data, environment, level));
    anyNoisy ||= noise(run) > NOISY;
    return `<tr><th scope="row">${escape(LEVEL_NAMES[level])}</th><td>${run.threads}</td>` +
      `<td>${formatMs(run.median_ms)}</td><td>${formatGflops(run.gflops)}</td>` +
      `<td>${formatSpeedup(baseline.median_ms / run.median_ms)}</td>${noiseCell(run)}</tr>`;
  });
  const id = `table-${ENVIRONMENT_SHORT[environment]}-best-${size}`;
  return `<figure class="results-figure"><figcaption id="${id}">${escape(ENVIRONMENT_LABELS[environment])}, n = ${size}: median of ${data.parameters.repeats} runs. ` +
    `"vs level 0" is the speedup over level 0 in the same environment; IQR is the noise.</figcaption>` +
    `<div class="table-scroll" tabindex="0" role="region" aria-labelledby="${id}"><table class="results" aria-labelledby="${id}">` +
    `<thead><tr><th scope="col">Level</th><th scope="col">Threads</th><th scope="col">Median</th>` +
    `<th scope="col">Throughput</th><th scope="col">vs level 0</th><th scope="col">IQR</th></tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table></div></figure>${anyNoisy ? NOISE_NOTE : ''}`;
}

/**
 * Levels 1 to 4 against the thread counts measured for the environment: the median, and
 * in brackets the speedup over the same level with one thread.
 */
export function scalingTable(data, { environment, n }) {
  const size = sizeOf(data, n);
  const counts = threadCounts(data, environment);
  let anyNoisy = false;
  const rows = [1, 2, 3, 4].map((level) => {
    const single = mustFind(data, environment, level, size, 1);
    const cells = counts.map((threads) => {
      const run = mustFind(data, environment, level, size, threads);
      const noisy = noise(run) > NOISY;
      anyNoisy ||= noisy;
      return `<td${noisy ? ' class="noisy"' : ''}>${formatMs(run.median_ms)} (${formatSpeedup(single.median_ms / run.median_ms)})${noisy ? ' †' : ''}</td>`;
    });
    return `<tr><th scope="row">${escape(LEVEL_NAMES[level])}</th>${cells.join('')}</tr>`;
  });
  const heads = counts.map((t) => `<th scope="col">${t} thread${t === 1 ? '' : 's'}</th>`).join('');
  const id = `table-${ENVIRONMENT_SHORT[environment]}-scaling-${size}`;
  return `<figure class="results-figure"><figcaption id="${id}">${escape(ENVIRONMENT_LABELS[environment])}, n = ${size}: median time, and speedup over one thread in brackets</figcaption>` +
    `<div class="table-scroll" tabindex="0" role="region" aria-labelledby="${id}"><table class="results" aria-labelledby="${id}">` +
    `<thead><tr><th scope="col">Level</th>${heads}</tr></thead><tbody>${rows.join('')}</tbody></table></div></figure>${anyNoisy ? NOISE_NOTE : ''}`;
}

const W = 640;
const H = 320;
const M = { left: 56, right: 16, top: 40, bottom: 52 };

function niceMax(value) {
  const step = 10 ** Math.floor(Math.log10(value));
  for (const factor of [1, 2, 5, 10]) if (value <= factor * step) return factor * step;
  return 10 * step;
}

/** Grouped bars: throughput (GFLOP/s) of each level at the largest thread count, per environment. */
export function throughputChart(data, { n }) {
  const size = sizeOf(data, n);
  const environments = ENVIRONMENTS.filter((e) => findRun(data, e, 0, size, 1));
  const values = environments.map((environment) =>
    [0, 1, 2, 3, 4].map((level) => mustFind(data, environment, level, size, defaultThreads(data, environment, level)).gflops));
  const top = niceMax(Math.max(...values.flat()));
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const groupW = plotW / 5;
  const barW = (groupW * 0.8) / environments.length;
  const y = (v) => M.top + plotH - (v / top) * plotH;
  const parts = [];
  for (let i = 0; i <= 4; i += 1) {
    const v = (top / 4) * i;
    parts.push(`<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="tick" x="${M.left - 6}" y="${y(v) + 4}" text-anchor="end">${Number(v.toFixed(1))}</text>`);
  }
  values.forEach((series, e) => {
    series.forEach((v, level) => {
      const x = M.left + level * groupW + groupW * 0.1 + e * barW;
      parts.push(`<rect class="bar bar-${environments[e]}" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${(plotH - (y(v) - M.top)).toFixed(1)}"/>` +
        `<text class="value" x="${(x + (barW - 2) / 2).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" text-anchor="middle">${v.toFixed(1)}</text>`);
    });
  });
  for (let level = 0; level <= 4; level += 1) {
    parts.push(`<text class="axis" x="${(M.left + level * groupW + groupW / 2).toFixed(1)}" y="${H - M.bottom + 18}" text-anchor="middle">Level ${level}</text>`);
  }
  const legend = environments.map((environment, e) =>
    `<rect class="bar bar-${environment}" x="${M.left + e * 190}" y="10" width="12" height="12"/>` +
    `<text class="legend" x="${M.left + e * 190 + 18}" y="20">${escape(ENVIRONMENT_LABELS[environment])}</text>`).join('');
  const description = environments.map((environment, e) =>
    `${ENVIRONMENT_LABELS[environment]}: ${values[e].map((v, level) => `level ${level} ${v.toFixed(1)}`).join(', ')}`).join('. ');
  return `<figure class="chart"><div class="chart-scroll" tabindex="0" role="region" aria-labelledby="throughput-${size}-title"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="throughput-${size}-title throughput-${size}-desc">` +
    `<title id="throughput-${size}-title">Throughput of each level, n = ${size}</title>` +
    `<desc id="throughput-${size}-desc">GFLOP/s at the largest thread count. ${escape(description)}.</desc>` +
    `${legend}${parts.join('')}</svg></div>` +
    `<figcaption>Throughput in GFLOP/s (higher is faster) of each level at n = ${size}, at the largest thread count measured in each environment (level 0 always uses one).</figcaption></figure>`;
}

/** Lines: speedup over one thread against the thread count, levels 1 to 4, with the ideal. */
export function scalingChart(data, { environment, n }) {
  const size = sizeOf(data, n);
  const counts = threadCounts(data, environment);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const series = [1, 2, 3, 4].map((level) => {
    const single = mustFind(data, environment, level, size, 1);
    return counts.map((t) => single.median_ms / mustFind(data, environment, level, size, t).median_ms);
  });
  // The ideal line reaches the largest thread count; a superlinear series must not be clipped.
  const top = Math.max(Math.max(...counts), ...series.flat());
  const x = (i) => M.left + (counts.length === 1 ? plotW / 2 : (plotW * i) / (counts.length - 1));
  const y = (v) => M.top + plotH - (v / top) * plotH;
  const parts = [];
  for (let i = 0; i <= 4; i += 1) {
    const v = (top / 4) * i;
    parts.push(`<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="tick" x="${M.left - 6}" y="${y(v) + 4}" text-anchor="end">${Number(v.toFixed(1))}×</text>`);
  }
  counts.forEach((t, i) => parts.push(`<text class="axis" x="${x(i).toFixed(1)}" y="${H - M.bottom + 18}" text-anchor="middle">${t}</text>`));
  parts.push(`<text class="axis" x="${(M.left + plotW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">threads</text>`);
  parts.push(`<polyline class="ideal" fill="none" points="${counts.map((t, i) => `${x(i).toFixed(1)},${y(t).toFixed(1)}`).join(' ')}"/>`);
  series.forEach((values, index) => {
    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    parts.push(`<polyline class="line line-${index + 1}" fill="none" points="${points.join(' ')}"/>` +
      values.map((v, i) => `<circle class="dot line-${index + 1}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5"/>`).join(''));
  });
  const legend = [1, 2, 3, 4].map((level) =>
    `<line class="line line-${level}" x1="${M.left + (level - 1) * 130}" x2="${M.left + (level - 1) * 130 + 16}" y1="16" y2="16"/>` +
    `<text class="legend" x="${M.left + (level - 1) * 130 + 22}" y="20">Level ${level}</text>`).join('') +
    `<line class="ideal" x1="${M.left + 4 * 130}" x2="${M.left + 4 * 130 + 16}" y1="16" y2="16"/><text class="legend" x="${M.left + 4 * 130 + 22}" y="20">ideal</text>`;
  const description = series.map((values, i) => `level ${i + 1}: ${counts.map((t, k) => `${t} thread${t === 1 ? '' : 's'} ${values[k].toFixed(1)}×`).join(', ')}`).join('. ');
  const id = `scaling-${ENVIRONMENT_SHORT[environment]}-${size}`;
  return `<figure class="chart"><div class="chart-scroll" tabindex="0" role="region" aria-labelledby="${id}-title"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-title ${id}-desc">` +
    `<title id="${id}-title">Thread scaling, ${escape(ENVIRONMENT_LABELS[environment].toLowerCase())}, n = ${size}</title>` +
    `<desc id="${id}-desc">Speedup over one thread. ${escape(description)}.</desc>` +
    `${legend}${parts.join('')}</svg></div>` +
    `<figcaption>${escape(ENVIRONMENT_LABELS[environment])}, n = ${size}: speedup over the same level with one thread against the number of threads. The dashed line is perfect scaling.</figcaption></figure>`;
}

/** Lines: throughput against the matrix size (log scale), one line per level, levels 1 to 4 at `threads` threads and level 0 on one. */
export function sizeChart(data, { environment, threads = 1 }) {
  const sizes = data.parameters.sizes;
  const series = [0, 1, 2, 3, 4].map((level) =>
    sizes.map((n) => mustFind(data, environment, level, n, level === 0 ? 1 : threads).gflops));
  const top = niceMax(Math.max(...series.flat()));
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const lo = Math.log2(Math.min(...sizes));
  const span = Math.log2(Math.max(...sizes)) - lo;
  const x = (n) => M.left + (span === 0 ? plotW / 2 : (plotW * (Math.log2(n) - lo)) / span);
  const y = (v) => M.top + plotH - (v / top) * plotH;
  const parts = [];
  for (let i = 0; i <= 4; i += 1) {
    const v = (top / 4) * i;
    parts.push(`<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="tick" x="${M.left - 6}" y="${y(v) + 4}" text-anchor="end">${Number(v.toFixed(1))}</text>`);
  }
  sizes.forEach((n) => parts.push(`<text class="axis" x="${x(n).toFixed(1)}" y="${H - M.bottom + 18}" text-anchor="middle">${n}</text>`));
  parts.push(`<text class="axis" x="${(M.left + plotW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">matrix size n</text>`);
  series.forEach((values, level) => {
    const points = values.map((v, i) => `${x(sizes[i]).toFixed(1)},${y(v).toFixed(1)}`);
    parts.push(`<polyline class="line line-${level}" fill="none" points="${points.join(' ')}"/>` +
      values.map((v, i) => `<circle class="dot line-${level}" cx="${x(sizes[i]).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5"/>`).join(''));
  });
  const legend = [0, 1, 2, 3, 4].map((level) =>
    `<line class="line line-${level}" x1="${M.left + level * 110}" x2="${M.left + level * 110 + 16}" y1="16" y2="16"/>` +
    `<text class="legend" x="${M.left + level * 110 + 22}" y="20">Level ${level}</text>`).join('');
  const description = series.map((values, level) =>
    `level ${level}: ${sizes.map((n, i) => `n = ${n} ${values[i].toFixed(1)}`).join(', ')}`).join('. ');
  const id = `size-${ENVIRONMENT_SHORT[environment]}-${threads}`;
  const label = `${ENVIRONMENT_LABELS[environment]}, ${threads === 1 ? 'one thread' : `${threads} threads`}`;
  return `<figure class="chart"><div class="chart-scroll" tabindex="0" role="region" aria-labelledby="${id}-title"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-title ${id}-desc">` +
    `<title id="${id}-title">Throughput against matrix size, ${escape(label.toLowerCase())}</title>` +
    `<desc id="${id}-desc">GFLOP/s of each level at each matrix size. ${escape(description)}.</desc>` +
    `${legend}${parts.join('')}</svg></div>` +
    `<figcaption>${escape(label)}: throughput in GFLOP/s (higher is faster) of each level against the matrix size. The size axis is logarithmic: each tick doubles the size.</figcaption></figure>`;
}
