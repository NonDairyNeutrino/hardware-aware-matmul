// Everything about the site that is not in docs/: the chapters have no frontmatter
// (rustdoc would show it as text), so their titles, order and routes live here.

import results from './src/data/results.json' with { type: 'json' };
import { cacheLineFigure } from './src/components/cache-figure.mjs';
import { registerFigure } from './src/components/register-figure.mjs';
import { reuseFigure } from './src/components/reuse-figure.mjs';
import { bestTable, scalingChart, scalingTable, sizeChart, throughputChart } from './src/results/render.mjs';

// GitHub Pages serves this repository at /hardware-aware-matmul/.
export const base = '/hardware-aware-matmul/';
export const siteTitle = 'Mechanical sympathy';
export const siteSubtitle = 'Five levels of matrix multiplication in Rust';
// The reference run's data: the numbers of the Results page (placeholders in its prose,
// and the tables and charts built from it) come from here and nowhere else.
export { results };
export const repoUrl = 'https://github.com/NonDairyNeutrino/hardware-aware-matmul';

// The site is laid out as a paper: abstract (the home page), introduction, methods (the
// levels), results, discussion and conclusion. Pages rendered from docs/ (id =
// path under docs/, no extension), in reading order. `route` is relative to `base`.
// `section` groups pages in the navigation: a section with several pages is shown as a
// labelled group (see `sectionTitles`), a section with one page as a plain link.
export const chapters = [
  { id: 'paper/abstract', title: 'Abstract', route: '', section: 'abstract' },
  { id: 'paper/introduction', title: 'Introduction', route: 'introduction/', section: 'introduction' },
  { id: 'paper/primer', title: 'Primer', route: 'primer/', section: 'primer' },
  { id: 'levels/naive', title: 'Level 0: the naive loop', route: 'levels/naive/', section: 'methods' },
  { id: 'levels/threaded', title: 'Level 1: threads', route: 'levels/threaded/', section: 'methods' },
  { id: 'levels/cache_friendly', title: 'Level 2: cache blocking', route: 'levels/cache_friendly/', section: 'methods' },
  { id: 'levels/simd', title: 'Level 3: registers and SIMD', route: 'levels/simd/', section: 'methods' },
  { id: 'levels/streaming', title: 'Level 4: streaming', route: 'levels/streaming/', section: 'methods' },
  { id: 'paper/results', title: 'Results', route: 'results/', section: 'results' },
  { id: 'paper/discussion', title: 'Discussion', route: 'discussion/', section: 'discussion' },
  { id: 'paper/conclusion', title: 'Conclusion', route: 'conclusion/', section: 'conclusion' },
];

// Pages that are not part of the paper's reading order but are linked from the navigation.
// The playground may register the service worker (one reload) to enable multithreading, which
// is why it is not a chapter: the chapters must stay reload-free.
export const extraPages = [{ title: 'Playground', route: 'playground/' }];

// Labels for the sections that group several pages.
export const sectionTitles = { methods: 'Methods' };

// Every intra-doc link target in the chapters must be listed (without the "crate::"
// prefix). A string is a route under `base`; null shows the text as plain code (no
// published API docs yet). Anything not listed fails the build.
export const links = {
  // Chapters.
  naive: 'levels/naive/',
  threaded: 'levels/threaded/',
  cache_friendly: 'levels/cache_friendly/',
  simd: 'levels/simd/',
  streaming: 'levels/streaming/',
  results: 'results/',
  discussion: 'discussion/',
  conclusion: 'conclusion/',
  introduction: 'introduction/',
  primer: 'primer/',
  playground: 'playground/',
  // API items and rustdoc-only pages.
  ...Object.fromEntries([
    'streaming::TileSource', 'streaming::TileSink', 'streaming::FileMatrix',
    'threaded::row_block_plan', 'streaming::StreamConfig::with_tile_shape',
    'streaming::StreamConfig::peak_buffer_bytes', 'simd::target_vector_isa',
    'simd::micro_tile_shape', 'naive::matmul', 'guide::in_memory', 'guide::getting_started',
    'design::architecture', 'Matrix', 'MatmulError',
    'TileSource', 'TileSink', 'StreamConfig::peak_buffer_bytes', 'StreamConfig::with_tile_shape',
    'target_vector_isa', 'micro_tile_shape', 'matrix', 'matmul', 'guide', 'design', 'error',
    'DimensionMismatch',
  ].map((key) => [key, null])),
};

const video = (file, caption) =>
  `<figure class="video"><video controls playsinline preload="metadata" src="${base}media/${file}"></video>` +
  `<figcaption>${caption}</figcaption></figure>`;

// Step-through demos (see src/components/step-through.js): the level they show and the
// heading of the chapter they go under. Levels 1 to 4 have one; level 0 has no plan to show.
export const demos = [
  { chapter: 'levels/threaded', afterHeading: 'What it gets right', level: 1,
    lookFor: "Each colour is one thread, and each colour owns a block of rows of the output. Press Step: every thread finishes one row at a time, and no thread touches another&rsquo;s rows, which is why no locking is needed and the result does not change." },
  { chapter: 'levels/cache_friendly', afterHeading: 'Change 2: cache blocking', level: 2,
    lookFor: "The output C and the input B are drawn side by side (stacked on a narrow screen); B is cut into numbered blocks (the cache blocks the section above describes; the picture does not highlight the current one). The real kernel finishes with one block of B for every row of its part of the output before moving to the next, so that block stays in the cache. Change Cache block k and Cache block j and watch how many blocks B is cut into: smaller blocks fit in the cache more easily but are visited more often." },
  { chapter: 'levels/simd', afterHeading: 'The micro-kernel', level: 3,
    lookFor: "The dashed lines cut each thread&rsquo;s block of the output into micro-tiles. A micro-tile is the piece of the output the kernel keeps in vector registers for the whole run along the shared dimension, loaded and stored once per cache block of B, instead of being read and written back at every step." },
  { chapter: 'levels/streaming', afterHeading: 'The algorithm', level: 4,
    lookFor: "The numbers show the order in which tiles are claimed; press Step to watch them complete, each by whichever worker is free. Each tile is a piece of the output computed from a strip of A and a strip of B streamed through small buffers. At most as many tiles are in flight as there are workers, and that bound is what limits the memory used." },
];

// Figures and demos inserted after a heading of a chapter (by heading text).
export const insertions = [
  ...demos.map(({ chapter, afterHeading, level, lookFor }) => ({
    chapter,
    afterHeading,
    html: `<p class="st-lookfor"><strong>What to look for.</strong> ${lookFor}</p><step-through level="${level}"></step-through>`,
  })),
  {
    chapter: 'levels/naive',
    afterHeading: 'The idea',
    html: video('NaiveMatMul.mp4', 'The textbook triple loop, animated.'),
  },
  // Site only: the rustdoc build of this chapter has no primer to link to.
  {
    chapter: 'levels/naive',
    afterHeading: 'The idea',
    html: `<p class="primer-pointer">New to caches, cache lines or SIMD? Read the <a href="${base}primer/">primer</a> first, then come back.</p>`,
  },
  {
    chapter: 'levels/threaded',
    afterHeading: 'What changed from level 0',
    html: video(
      'ParallelNaiveMatMul.mp4',
      'Three threads, one row of the output each: the one-row case of the row blocks described below.',
    ),
  },
  {
    chapter: 'levels/cache_friendly',
    afterHeading: 'What changed from level 1',
    html: video(
      'CacheFriendlyMatMul.mp4',
      'Walking down a column of B touches a new cache line on every read; the i-k-j order reads whole rows, and blocking reuses a block of B for every row.',
    ),
  },
  {
    chapter: 'levels/simd',
    afterHeading: 'What changed from level 2',
    html: video(
      'SimdMatMul.mp4',
      'A 2 &times; 4 block of C stays in two vector registers for the whole run along k, with four lanes (a 4 &times; 4 example, so a row of B fills a register); C is stored once at the end.',
    ),
  },
  // Level 2: how often B is fetched, after the paragraph that gives the size of a block of B
  // (the step-through demo sits right after the heading and counts as one of the blocksAfter).
  // Threads = 4 is stated in the caption.
  { chapter: 'levels/cache_friendly', afterHeading: 'Change 2: cache blocking', blocksAfter: 5,
    html: `<p class="st-lookfor"><strong>What to look for.</strong> Compare the two counts: without blocking every element of B is fetched once per row of the thread&rsquo;s part of the output; with blocking it is fetched once, because the block stays in the cache while all those rows use it.</p>` +
      reuseFigure({ n: Math.max(...results.parameters.sizes), block: results.parameters.block, threads: 4 }) },
  // Level 3: the memory operations per step, after the paragraph that says per k the kernel
  // does one B load and MR broadcasts. blocksAfter counts the already-inserted demo node (the
  // demos are spliced in first, right after the same heading): demo, paragraph, two code
  // blocks, then that paragraph = 5.
  { chapter: 'levels/simd', afterHeading: 'The micro-kernel', blocksAfter: 5,
    html: `<p class="st-lookfor"><strong>What to look for.</strong> The arithmetic is the same in both bars; only the memory operations differ, because level 3 no longer loads and stores C at every step.</p>` +
      registerFigure({ tileJ: results.parameters.block[1] }) },
  // The primer: the cache-line picture, after the paragraph that sets up the 8 x 8 example.
  { chapter: 'paper/primer', afterHeading: 'Walking along a row, walking down a column', blocksAfter: 1,
    html: cacheLineFigure() },
  // The Results page: tables and charts generated from the data, after the paragraph that
  // introduces each.
  { chapter: 'paper/results', afterHeading: 'Native', blocksAfter: 2,
    html: bestTable(results, { environment: 'native', n: 512 }) + bestTable(results, { environment: 'native' }) },
  { chapter: 'paper/results', afterHeading: 'Throughput against matrix size, native', blocksAfter: 2,
    html: sizeChart(results, { environment: 'native', threads: 1 }) },
  { chapter: 'paper/results', afterHeading: 'Thread scaling, native', blocksAfter: 2,
    html: scalingTable(results, { environment: 'native' }) + scalingChart(results, { environment: 'native' }) },
  { chapter: 'paper/results', afterHeading: 'In the browser', blocksAfter: 2,
    html: bestTable(results, { environment: 'browser-lite' }) + bestTable(results, { environment: 'browser-threads' }) +
      throughputChart(results, {}) },
  { chapter: 'paper/results', afterHeading: 'Thread scaling in the browser', blocksAfter: 1,
    html: scalingTable(results, { environment: 'browser-threads' }) + scalingChart(results, { environment: 'browser-threads' }) },
];
