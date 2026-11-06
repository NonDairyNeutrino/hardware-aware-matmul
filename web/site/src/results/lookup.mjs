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

/** `ms` as text: seconds from 1000 ms, whole milliseconds from 100, else one decimal. */
export function formatMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}
export const formatGflops = (value) => `${value.toFixed(1)} GFLOP/s`;
export const formatSpeedup = (ratio) => `${ratio.toFixed(1)}×`;
export const formatPercent = (fraction) => `${Math.round(fraction * 100)}%`;

const ENV_FIELDS = {
  cpu: (d) => d.environment.cpu,
  cores: (d) => String(d.environment.logical_cores),
  physical_cores: (d) => String(d.environment.physical_cores),
  governor: (d) => d.environment.governor,
  os: (d) => d.environment.os,
  date: (d) => d.generated.slice(0, 10),
  commit: (d) => d.environment.commit.slice(0, 7),
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
  sizes: (d) => d.parameters.sizes.join(' and '),
  largest: (d) => String(defaultSize(d)),
  block: (d) => d.parameters.block.join(' x '),
  tile: (d) => d.parameters.tile.join(' x '),
};

/** The names `{{env ...}}` accepts. */
export const ENV_FIELD_NAMES = Object.keys(ENV_FIELDS);

function parseSelectors(data, tokens, problem) {
  const selectors = { environment: 'native', n: defaultSize(data), threads: null };
  for (const token of tokens) {
    if (ENVIRONMENTS.includes(token)) selectors.environment = token;
    else if (token in ENVIRONMENT_ALIASES) selectors.environment = ENVIRONMENT_ALIASES[token];
    else if (/^n=\d+$/.test(token)) selectors.n = Number(token.slice(2));
    else if (/^t=\d+$/.test(token)) selectors.threads = Number(token.slice(2));
    else problem(`unknown selector "${token}" (use n=<size>, t=<threads>, or one of ${[...ENVIRONMENTS, ...Object.keys(ENVIRONMENT_ALIASES)].join(', ')})`);
  }
  return selectors;
}

function level(name, problem) {
  if (!(name in LEVELS)) problem(`unknown level "${name}" (use ${Object.keys(LEVELS).join(', ')})`);
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
    if (!(subject in ENV_FIELDS) || rest.length > 0) {
      return problem(`env needs one of: ${ENV_FIELD_NAMES.join(', ')}`);
    }
    return ENV_FIELDS[subject](data);
  }
  if (!['ms', 'gflops', 'speedup', 'iqr'].includes(metric)) {
    return problem('the metric must be ms, gflops, speedup, iqr or env');
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
