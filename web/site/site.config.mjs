import results from './src/data/results.json' with { type: 'json' };
import { bestTable, scalingChart, scalingTable, throughputChart } from './src/results/render.mjs';

// Everything about the site that is not in docs/: the chapters have no frontmatter
// (rustdoc would show it as text), so their titles, order and routes live here.

// GitHub Pages serves this repository at /hardware-aware-matmul/.
export const base = '/hardware-aware-matmul/';
export const siteTitle = 'Mechanical sympathy';
export const siteSubtitle = 'Five levels of matrix multiplication in Rust';
// The reference run's data: the numbers of the Results page (placeholders in its prose,
// and the tables and charts built from it) come from here and nowhere else.
export { results };
export const repoUrl = 'https://github.com/NonDairyNeutrino/hardware-aware-matmul';

// The site is laid out as a paper: abstract (the home page), introduction, methods (the
// levels), and later results, discussion and conclusion. Pages rendered from docs/ (id =
// path under docs/, no extension), in reading order. `route` is relative to `base`.
// `section` groups pages in the navigation: a section with several pages is shown as a
// labelled group (see `sectionTitles`), a section with one page as a plain link.
export const chapters = [
  { id: 'paper/abstract', title: 'Abstract', route: '', section: 'abstract' },
  { id: 'introduction', title: 'Introduction', route: 'introduction/', section: 'introduction' },
  { id: 'levels/naive', title: 'Level 0: the naive loop', route: 'levels/naive/', section: 'methods' },
  { id: 'levels/threaded', title: 'Level 1: threads', route: 'levels/threaded/', section: 'methods' },
  { id: 'levels/cache_friendly', title: 'Level 2: cache blocking', route: 'levels/cache_friendly/', section: 'methods' },
  { id: 'levels/simd', title: 'Level 3: registers and SIMD', route: 'levels/simd/', section: 'methods' },
  { id: 'levels/streaming', title: 'Level 4: streaming', route: 'levels/streaming/', section: 'methods' },
  { id: 'paper/results', title: 'Results', route: 'results/', section: 'results' },
];

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
  { chapter: 'levels/threaded', afterHeading: 'What it gets right', level: 1 },
  { chapter: 'levels/cache_friendly', afterHeading: 'Change 2: cache blocking', level: 2 },
  { chapter: 'levels/simd', afterHeading: 'The micro-kernel', level: 3 },
  { chapter: 'levels/streaming', afterHeading: 'The algorithm', level: 4 },
];

// Figures and demos inserted after a heading of a chapter (by heading text).
export const insertions = [
  ...demos.map(({ chapter, afterHeading, level }) => ({
    chapter,
    afterHeading,
    html: `<step-through level="${level}"></step-through>`,
  })),
  {
    chapter: 'levels/naive',
    afterHeading: 'The idea',
    html: video('NaiveMatMul.mp4', 'The textbook triple loop, animated.'),
  },
  {
    chapter: 'levels/threaded',
    afterHeading: 'What changed from level 0',
    html: video(
      'ParallelNaiveMatMul.mp4',
      'Three threads, one row of the output each: the one-row case of the row blocks described below.',
    ),
  },
  // The Results page: tables and charts generated from the data, after the paragraph that
  // introduces each.
  { chapter: 'paper/results', afterHeading: 'Native', blocksAfter: 1,
    html: bestTable(results, { environment: 'native' }) },
  { chapter: 'paper/results', afterHeading: 'Thread scaling, native', blocksAfter: 1,
    html: scalingTable(results, { environment: 'native' }) + scalingChart(results, { environment: 'native' }) },
  { chapter: 'paper/results', afterHeading: 'In the browser', blocksAfter: 1,
    html: bestTable(results, { environment: 'browser-lite' }) + bestTable(results, { environment: 'browser-threads' }) +
      throughputChart(results, {}) },
  { chapter: 'paper/results', afterHeading: 'Thread scaling in the browser', blocksAfter: 1,
    html: scalingTable(results, { environment: 'browser-threads' }) + scalingChart(results, { environment: 'browser-threads' }) },
];
