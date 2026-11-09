// Everything about the site that is not in docs/: the chapters have no frontmatter
// (rustdoc would show it as text), so their titles, order and routes live here.

import results from './src/data/results.json' with { type: 'json' };
import { cacheLineFigure } from './src/components/cache-figure.mjs';
import { packFigure } from './src/components/pack-figure.mjs';
import { registerFigure } from './src/components/register-figure.mjs';
import { reuseFigure } from './src/components/reuse-figure.mjs';
import { bestTable, countersTable, scalingChart, scalingTable, sizeChart, throughputChart } from './src/results/render.mjs';
import { substitute } from './src/results/lookup.mjs';

// GitHub Pages serves this repository at /hardware-aware-matmul/.
export const base = '/hardware-aware-matmul/';
export const siteTitle = 'Mechanical sympathy';
export const siteSubtitle = 'Six levels of matrix multiplication in Rust';
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
  { id: 'levels/packed', title: 'Level 4: packing B', route: 'levels/packed/', section: 'methods' },
  { id: 'levels/streaming', title: 'Level 5: streaming', route: 'levels/streaming/', section: 'methods' },
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
  packed: 'levels/packed/',
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
// heading of the chapter they go under. Levels 1, 2, 3 and 5 have one; level 0 has no plan to show,
// and level 4 splits the rows exactly as level 3 does, so its figure is the pack figure instead.
export const demos = [
  { chapter: 'levels/threaded', afterHeading: 'What it gets right', level: 1,
    lookFor: "Each colour is one thread, and each colour owns a block of rows of the output. Press Step: every thread finishes one row at a time, and no thread touches another&rsquo;s rows, which is why no locking is needed and the result does not change." },
  { chapter: 'levels/cache_friendly', afterHeading: 'Change 2: cache blocking', level: 2,
    lookFor: "The output C and the input B are drawn side by side (stacked on a narrow screen); B is cut into numbered blocks (the cache blocks the section above describes; the picture does not highlight the current one). The real kernel finishes with one block of B for every row of its part of the output before moving to the next, so that block stays in the cache. Change Cache block k and Cache block j and watch how many blocks B is cut into: smaller blocks fit in the cache more easily but are visited more often." },
  { chapter: 'levels/simd', afterHeading: 'The micro-kernel', level: 3,
    lookFor: "The dashed lines cut each thread&rsquo;s block of the output into micro-tiles. A micro-tile is the piece of the output the kernel keeps in vector registers for the whole run along the shared dimension, loaded and stored once per cache block of B, instead of being read and written back at every step." },
  { chapter: 'levels/streaming', afterHeading: 'The algorithm', level: 5,
    lookFor: "The numbers show the order in which tiles are claimed; press Step to watch them complete, each by whichever worker is free. Each tile is a piece of the output computed from a strip of A and a strip of B streamed through small buffers. At most as many tiles are in flight as there are workers, and that bound is what limits the memory used." },
];

// What the measurements found, one line per level chapter, shown in a box under the chapter's
// first heading (generated here, not in docs/levels, which are rustdoc too and carry no numbers).
// Plain text with placeholders, resolved at build time; every comparison in them is a claim
// tested in src/results/claims.test.mjs.
export const levelFindings = {
  'levels/naive': 'At n = {{env largest}} the textbook loop took {{ms naive}}.',
  'levels/threaded': 'At n = {{env largest}} it took {{ms threaded t=1}} on one thread, {{ms threaded t=4}} on four threads and {{ms threaded t=8}} on eight.',
  'levels/cache_friendly': 'At n = {{env largest}} it took {{ms cache_friendly t=1}} on one thread, which is faster than level 1 on every thread count (it took {{ms threaded t=8}} on eight threads).',
  'levels/simd': 'At n = {{env largest}} it took {{ms simd t=1}} on one thread and {{ms simd}} on {{env threads_native}} threads, which is {{speedup simd/naive}} faster than the textbook loop.',
  'levels/packed': 'At n = {{env largest}} it took {{ms packed t=1}} on one thread, against level 3\'s {{ms simd t=1}}. At the two largest sizes it was faster than level 3 at every thread count.',
  'levels/streaming': 'At n = {{env largest}} it took {{ms streaming t=4}} on four threads, {{speedup streaming/naive t=4}} faster than the textbook loop: the fastest case measured at that size.',
};

// The chapter's first heading, where the strip goes.
const findingsHeading = {
  'levels/naive': 'The idea',
  'levels/threaded': 'What changed from level 0',
  'levels/cache_friendly': 'What changed from level 1',
  'levels/simd': 'What changed from level 2',
  'levels/packed': 'What changed from level 3',
  'levels/streaming': 'The problem',
};

// Where the reader is in the case, one box per level chapter, above the measurements strip: what
// the chapters before have found (level 0: what the case is), and what this level asks. Plain
// text condensed from the level pages, with no numbers and no placeholders (it goes through no
// substitute). The one comparison it repeats, level 2 on one thread against level 1 on every
// thread, is the claim tested as 'the first clue' in src/results/claims.test.mjs, and the naive box's "far from what the processor can do" is tested there as 'the hook'.
export const levelStory = {
  'levels/naive': {
    label: 'The case:',
    so_far: 'The textbook loop is correct and easy to read, and every other level is measured against it. It is also far from what the processor can do, and nothing in the code says why.',
    this_level: 'Set out the baseline: one thread, three nested loops, no tricks. The chapters that follow look for the reason it is slow, one suspect at a time.',
  },
  'levels/threaded': {
    label: 'So far:',
    so_far: 'Level 0 is correct but runs on one core, and its inner loop walks down a column of B, so almost every read lands on a different cache line.',
    this_level: 'Test the obvious suspect, that the loop leaves most of the cores idle, by giving every core a share of the same loop.',
  },
  'levels/cache_friendly': {
    label: 'So far:',
    so_far: "Adding threads did not fix the loop, so the number of cores doing the arithmetic was not what held it back. Each thread still runs the level 0 loop, only on its own rows.",
    this_level: 'Go after the best remaining suspect, the way the loop walks memory: reorder the loops so that each thread reads whole rows, and block for the cache so that data is reused while it is still there.',
  },
  'levels/simd': {
    label: 'So far:',
    so_far: 'Level 2 put the data close to the core, and on one thread it beat level 1 on every thread. Its inner loop still carries the output block through memory on every step.',
    this_level: 'Remove that last trip: keep a small block of the output in vector registers for the whole inner loop.',
  },
  'levels/packed': {
    label: 'So far:',
    so_far: 'Level 3 keeps a block of the output in registers, but its kernel still reads B where it lies in memory, a row apart at every step.',
    this_level: 'Copy each block of B once into a contiguous buffer, in the order the micro-kernel reads it, and ask whether the copy earns its cost back.',
  },
  'levels/streaming': {
    label: 'So far:',
    so_far: 'Every level so far asks how to make the product faster, and every one needs A, B and C to fit in memory at once.',
    this_level: 'Ask a different question: what if the matrices do not fit in memory at all? Compute the output one small tile at a time, streaming the inputs through small buffers.',
  },
};

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
  {
    chapter: 'levels/streaming',
    afterHeading: 'The idea',
    html: video(
      'StreamingMatMul.mp4',
      'One output tile of C at a time: slices of A and B stream through three small buffers into a running sum, and workers claim tiles from a shared counter.',
    ),
  },
  {
    chapter: 'levels/packed',
    afterHeading: 'What changed from level 3',
    html: video(
      'PackedMatMul.mp4',
      'A strip of B, read in place, touches a new cache line on every step along k; packed into a contiguous buffer first, the same strip is a short run of adjacent values, read by the unchanged micro-kernel.',
    ),
  },
  // Level 4: what one strip of B touches, in place and packed, after the paragraph that says
  // the micro-kernel is level 3's (the heading's blocks: the video, three paragraphs, the
  // diagram, the paragraph on strips, then that one = 6 from the heading, counting the diagram
  // code block).
  { chapter: 'levels/packed', afterHeading: 'What changed from level 3', blocksAfter: 6,
    html: `<p class="st-lookfor"><strong>What to look for.</strong> The same strip of B, read two ways. In place, every step along k lands on a different line, and with a long row, a different page; packed, the strip is a short run of adjacent lines.</p>` +
      packFigure({ n: Math.max(...results.parameters.sizes), tileK: results.parameters.block[0], nr: results.environment.native_micro_tile[1] }) },
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
  { chapter: 'paper/results', afterHeading: 'Hardware event counts', blocksAfter: 2,
    html: countersTable(results) },
  { chapter: 'paper/results', afterHeading: 'Thread scaling in the browser', blocksAfter: 1,
    html: scalingTable(results, { environment: 'browser-threads' }) + scalingChart(results, { environment: 'browser-threads' }) },
  // The measurements strips come last: insertions are spliced in order, each at heading + 1 +
  // blocksAfter, so with blocksAfter 0 a strip lands above the videos and demos already put
  // under the same heading, and it shifts no blocksAfter count above.
  ...Object.entries(levelFindings).map(([chapter, text]) => ({
    chapter,
    afterHeading: findingsHeading[chapter],
    blocksAfter: 0,
    html: `<aside class="findings"><strong>What the measurements found.</strong> ${substitute(text, results)}</aside>`,
  })),
  // The story boxes come after the strips, so each lands above its chapter's strip (same heading,
  // blocksAfter 0). Under the heading: story box, measurements strip, then the videos and demos.
  ...Object.entries(levelStory).map(([chapter, { label, so_far, this_level }]) => ({
    chapter,
    afterHeading: findingsHeading[chapter],
    blocksAfter: 0,
    html: `<aside class="story"><p><strong>${label}</strong> ${so_far}</p><p><strong>This level:</strong> ${this_level}</p></aside>`,
  })),
];
