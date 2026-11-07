// Looks numbers up in the reference run's data (src/data/results.json), for the prose
// placeholders and the generated tables and charts of the Results page. Pure functions:
// no file access, so they can be tested with a small fake dataset.
//
// A placeholder is written `{{metric subject selectors}}` in the Markdown, for example
//   {{ms simd n=1024 native}}            median time of level 3 at n = 1024, native
//   {{gflops cache_friendly lite}}       throughput of level 2, browser, lite build
//   {{speedup simd/naive n=512 native}}  how many times faster level 3 is than level 0
//   {{iqr streaming t=4}}                noise of level 4 with 4 threads, native
//   {{env cpu}}                          a fact about the reference run
//   {{triad t=4}}, {{peak t=4}}          the hardware probe at 4 threads: triad bandwidth
//                                        (GB/s) and arithmetic peak (GFLOP/s), native
//   {{frac simd t=4}}                    level 3's throughput as a share of that peak
// Selectors: `n=<size>` (default: the largest), `t=<threads>` (default: the largest count
// measured; ignored for level 0, which is always one thread), and one environment: native
// (default), lite or browser-lite, threads or browser-threads. Giving a selector twice is
// an error. `env` takes one field name: cpu, cores, physical_cores, governor, os, date,
// commit (seven characters, plus a note if the tree was dirty), firefox, rustc_native,
// rustc_lite, rustc_threads, native_isa, browser_isa, pool, runs, repeats, warmup, sizes,
// largest, madds (the multiply-adds of one product at the largest size, n cubed), block,
// tile, rustflags (the recorded RUSTFLAGS, `none` if empty), and
// threads_native, threads_lite, threads_threaded (the largest thread count measured in
// that environment), l1d, l2, l3 (the cache sizes, in KiB below 1 MiB, else MiB), and
// triad_max, peak_max (the largest triad bandwidth and arithmetic peak over the thread
// counts probed). `triad` and `peak` take only `t=` (default: the largest native count);
// `frac` takes a level and the usual selectors but only the native environment, because
// the probe ran natively. An `env` value that is missing or empty is an error, never text.
// Anything that does not resolve throws, so a stale or misspelt placeholder fails the
// build instead of publishing a wrong number.

/** Levels by module name (and the L0 to L4 shorthand). */
export const LEVELS = { naive: 0, threaded: 1, cache_friendly: 2, simd: 3, streaming: 4 };
for (let level = 0; level <= 4; level += 1) LEVELS[`L${level}`] = level;

/** The names of the three measured environments, and the short forms prose may use. */
export const ENVIRONMENTS = ['native', 'browser-lite', 'browser-threads'];
const ENVIRONMENT_ALIASES = { lite: 'browser-lite', threads: 'browser-threads' };

/** Interquartile range of `times` (inclusive quartiles), a noise measure that one slow
 *  outlier cannot dominate the way max minus min can. */
export function interquartileRange(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q) => {
    const position = (sorted.length - 1) * q;
    const below = Math.floor(position);
    const above = Math.ceil(position);
    return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
  };
  return at(0.75) - at(0.25);
}

/** A run's noise: the interquartile range as a fraction of its median. */
export function noise(run) {
  return interquartileRange(run.times_ms) / run.median_ms;
}

/** The run for exactly this environment, level, size and thread count, or undefined. */
export function findRun(data, environment, level, n, threads) {
  return data.runs.find(
    (r) => r.environment === environment && r.level === level && r.n === n && r.threads === threads,
  );
}

/** The thread counts measured for an environment (level 0 is always measured with 1). */
export function threadCounts(data, environment) {
  return data.parameters.threads[environment];
}

/** The largest size, and the largest thread count of an environment. */
export function defaultSize(data) {
  return Math.max(...data.parameters.sizes);
}
export function defaultThreads(data, environment, level) {
  return level === 0 ? 1 : Math.max(...threadCounts(data, environment));
}

/** `ms` as text: seconds (one decimal) from 10 s, whole milliseconds from 100 ms, else one
 *  decimal. Whole milliseconds up to 10 s, because a tenth of a second there would make a
 *  gap of a few percent look like one of ten. */
export function formatMs(ms) {
  if (Math.round(ms) >= 10000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}
export const formatGflops = (value) => `${value.toFixed(1)} GFLOP/s`;
export const formatSpeedup = (ratio) => `${ratio.toFixed(1)}×`;
export const formatPercent = (fraction) => `${Math.round(fraction * 100)}%`;
export const formatGbs = (value) => `${value.toFixed(1)} GB/s`;

/** A byte count as text: KiB below 1 MiB, else MiB, with at most two decimals. */
export function formatBytes(bytes) {
  const trim = (x) => String(Number(x.toFixed(2)));
  return bytes < 2 ** 20 ? `${trim(bytes / 2 ** 10)} KiB` : `${trim(bytes / 2 ** 20)} MiB`;
}

/** `items` as an English list: "a", "a and b", "a, b and c". */
export function listText(items) {
  const words = items.map(String);
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** The size of the data (or unified) cache of `level`, as text, or undefined. */
function cacheSize(d, level) {
  const cache = d.environment.caches?.find((c) => c.level === level && c.type !== 'Instruction');
  return cache === undefined ? undefined : formatBytes(cache.size_bytes);
}

/** The largest value of a per-thread-count table of the hardware probe, or undefined. */
function probeMax(table) {
  return table === undefined ? undefined : Math.max(...Object.values(table));
}

const ENV_FIELDS = {
  cpu: (d) => d.environment.cpu,
  cores: (d) => String(d.environment.logical_cores),
  physical_cores: (d) => String(d.environment.physical_cores),
  governor: (d) => d.environment.governor,
  os: (d) => d.environment.os,
  date: (d) => d.generated.slice(0, 10),
  commit: (d) => {
    const commit = d.environment.commit;
    // The assembler appends ' (with uncommitted changes)' to the hash of a dirty tree.
    return typeof commit === 'string' && commit.includes(' (')
      ? `${commit.slice(0, 7)} (with uncommitted changes)`
      : commit?.slice(0, 7);
  },
  firefox: (d) => d.environment.firefox.replace(/^Mozilla /, ''),
  rustc_native: (d) => d.environment.toolchains.native,
  rustc_lite: (d) => d.environment.toolchains['browser-lite'],
  rustc_threads: (d) => d.environment.toolchains['browser-threads'],
  native_isa: (d) => d.environment.native_isa,
  browser_isa: (d) => d.environment.browser_isa,
  pool: (d) => String(d.environment.browser_pool),
  runs: (d) => String(d.runs.length),
  repeats: (d) => String(d.parameters.repeats),
  warmup: (d) => String(d.parameters.warmup),
  sizes: (d) => listText(d.parameters.sizes),
  largest: (d) => String(defaultSize(d)),
  madds: (d) => (defaultSize(d) ** 3).toLocaleString('en-US'),
  block: (d) => d.parameters.block.join(' x '),
  tile: (d) => d.parameters.tile.join(' x '),
  rustflags: (d) => d.environment.rustflags || 'none',
  threads_native: (d) => String(Math.max(...threadCounts(d, 'native'))),
  threads_lite: (d) => String(Math.max(...threadCounts(d, 'browser-lite'))),
  threads_threaded: (d) => String(Math.max(...threadCounts(d, 'browser-threads'))),
  l1d: (d) => cacheSize(d, 1),
  l2: (d) => cacheSize(d, 2),
  l3: (d) => cacheSize(d, 3),
  triad_max: (d) => {
    const best = probeMax(d.environment.hardware?.triad_gbs);
    return best === undefined ? undefined : formatGbs(best);
  },
  peak_max: (d) => {
    const best = probeMax(d.environment.hardware?.peak_gflops);
    return best === undefined ? undefined : formatGflops(best);
  },
};

/** The names `{{env ...}}` accepts. */
export const ENV_FIELD_NAMES = Object.keys(ENV_FIELDS);

function parseSelectors(data, tokens, problem) {
  const selectors = { environment: 'native', n: defaultSize(data), threads: null };
  const seen = new Set();
  const once = (kind, token) => {
    if (seen.has(kind)) problem(`duplicate selector "${token}"`);
    seen.add(kind);
  };
  for (const token of tokens) {
    if (ENVIRONMENTS.includes(token)) {
      once('environment', token);
      selectors.environment = token;
    } else if (Object.hasOwn(ENVIRONMENT_ALIASES, token)) {
      once('environment', token);
      selectors.environment = ENVIRONMENT_ALIASES[token];
    } else if (/^n=\d+$/.test(token)) {
      once('n', token);
      selectors.n = Number(token.slice(2));
    } else if (/^t=\d+$/.test(token)) {
      once('t', token);
      selectors.threads = Number(token.slice(2));
    } else problem(`unknown selector "${token}" (use n=<size>, t=<threads>, or one of ${[...ENVIRONMENTS, ...Object.keys(ENVIRONMENT_ALIASES)].join(', ')})`);
  }
  return selectors;
}

function level(name, problem) {
  if (!Object.hasOwn(LEVELS, name)) problem(`unknown level "${name}" (use ${Object.keys(LEVELS).join(', ')})`);
  return LEVELS[name];
}

function runFor(data, selectors, levelNumber, problem) {
  // Level 0 is single-threaded whatever `t=` says.
  const threads = levelNumber === 0 ? 1 : (selectors.threads ?? defaultThreads(data, selectors.environment, levelNumber));
  const run = findRun(data, selectors.environment, levelNumber, selectors.n, threads);
  if (!run) {
    problem(`no measurement for level ${levelNumber}, n=${selectors.n}, ${threads} thread(s) in ${selectors.environment}`);
  }
  return run;
}

/**
 * The text a placeholder stands for. `text` is what is between the braces, `data` the
 * parsed results.json. Throws an Error that quotes the placeholder if it cannot resolve.
 */
export function resolvePlaceholder(data, text) {
  const problem = (message) => {
    throw new Error(`unresolvable placeholder "{{${text}}}": ${message}`);
  };
  const [metric, subject, ...rest] = text.trim().split(/\s+/);
  if (metric === 'env') {
    if (!Object.hasOwn(ENV_FIELDS, subject) || rest.length > 0) {
      return problem(`env needs one of: ${ENV_FIELD_NAMES.join(', ')}`);
    }
    const value = ENV_FIELDS[subject](data);
    if (value === null || value === undefined || value === '' || /\b(undefined|null|NaN)\b/.test(value)) {
      return problem(`the data has no value for it`);
    }
    return value;
  }
  if (metric === 'triad' || metric === 'peak') {
    const table = data.environment.hardware?.[metric === 'triad' ? 'triad_gbs' : 'peak_gflops'];
    if (table === undefined) return problem('the data has no hardware probe');
    const tokens = [subject, ...rest].filter((token) => token !== undefined);
    if (tokens.length > 1 || (tokens.length === 1 && !/^t=\d+$/.test(tokens[0]))) {
      return problem(`${metric} takes only t=<threads>`);
    }
    const threads = tokens.length === 1 ? Number(tokens[0].slice(2)) : defaultThreads(data, 'native', null);
    const value = table[threads];
    if (!Number.isFinite(value) || value <= 0) return problem(`the hardware probe has no value for ${threads} thread(s)`);
    return metric === 'triad' ? formatGbs(value) : formatGflops(value);
  }
  if (!['ms', 'gflops', 'speedup', 'iqr', 'frac'].includes(metric)) {
    return problem('the metric must be ms, gflops, speedup, iqr, frac, triad, peak or env');
  }
  if (!subject) return problem('a level is needed');
  const selectors = parseSelectors(data, rest, problem);
  if (metric === 'speedup') {
    const parts = subject.split('/');
    if (parts.length !== 2) return problem('speedup needs two levels, like simd/naive (how many times faster the first is)');
    const faster = runFor(data, selectors, level(parts[0], problem), problem);
    const baseline = runFor(data, selectors, level(parts[1], problem), problem);
    return formatSpeedup(baseline.median_ms / faster.median_ms);
  }
  const run = runFor(data, selectors, level(subject, problem), problem);
  if (metric === 'frac') {
    if (selectors.environment !== 'native') return problem('the arithmetic peak was measured natively only');
    const peak = data.environment.hardware?.peak_gflops?.[run.threads];
    if (!Number.isFinite(peak) || peak <= 0) return problem(`the hardware probe has no peak for ${run.threads} thread(s)`);
    return formatPercent(run.gflops / peak);
  }
  if (metric === 'ms') return formatMs(run.median_ms);
  if (metric === 'gflops') return formatGflops(run.gflops);
  return formatPercent(noise(run));
}

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

/** Whether `text` contains a placeholder. */
export function hasPlaceholder(text) {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/** `text` with every placeholder replaced; `data` may be null (then any placeholder throws). */
export function substitute(text, data) {
  return text.replace(PLACEHOLDER, (_whole, inner) => {
    if (!data) throw new Error(`placeholder "{{${inner}}}" found but no results data was given`);
    return resolvePlaceholder(data, inner);
  });
}
