// The level 4 figure: what one micro-kernel strip (tileK values of k by NR columns of B) touches
// when it is read in place from the row-major B (rows n elements apart) and when it is read from
// the packed copy (rows NR elements apart). The counts are of distinct 64-byte cache lines, 4 KiB
// pages and L1 sets those addresses fall in, worked out exactly from the addresses. A count of
// what is touched, not a measurement of time. Pure functions that return HTML.
//
// KEEP IN STEP with src/packed.rs (`pack_strips`: strip s stores k by k, NR values per k) and
// src/simd.rs (NR = 4 in the SSE2 / WebAssembly SIMD128 builds, MR = 4). The Node container cannot
// read the Rust source, so there is no automatic guard against drift.
//
// Assumptions, stated in the caption: the strip starts on a cache-line and page boundary, lines
// are 64 bytes, pages are 4 KiB, and the L1 has 64 sets (a 32 KiB, 8-way cache). Real addresses
// depend on where the allocator puts the matrix, so this is the typical case, not a prediction.

const LINE = 64;
const PAGE = 4096;
const SETS = 64;
const F64 = 8;

function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got ${value}`);
}

/** Distinct lines, pages and L1 sets among the byte addresses of `tileK` rows of `nr` doubles. */
function touched(rowStrideElements, tileK, nr) {
  const lines = new Set();
  const pages = new Set();
  const sets = new Set();
  for (let k = 0; k < tileK; k += 1) {
    for (let l = 0; l < nr; l += 1) {
      const address = (k * rowStrideElements + l) * F64;
      const line = Math.floor(address / LINE);
      lines.add(line);
      pages.add(Math.floor(address / PAGE));
      sets.add(line % SETS);
    }
  }
  return { lines: lines.size, pages: pages.size, sets: sets.size };
}

/** What one strip touches in place (row stride n) and packed (row stride nr). */
export function packCounts({ n, tileK = 32, nr = 4 } = {}) {
  positiveInteger('n', n);
  positiveInteger('tileK', tileK);
  positiveInteger('nr', nr);
  if (n < nr) throw new Error(`n = ${n} must be at least nr = ${nr}`);
  return { inPlace: touched(n, tileK, nr), packed: touched(nr, tileK, nr) };
}

const ROWS = [
  ['lines', 'cache lines'],
  ['pages', '4 KiB pages'],
  ['sets', 'L1 sets'],
];

function bar(title, counts, max) {
  const cells = ROWS.map(([key, name]) =>
    `<li><span class="pk-name">${name}</span><span class="pk-track"><span class="pk-fill" style="width:${(counts[key] / max[key]) * 100}%"></span></span>` +
    `<span class="pk-count">${counts[key]}</span></li>`);
  return `<div class="pk-row"><div class="pk-label">${title}</div><ul class="pk-list">${cells.join('')}</ul></div>`;
}

/** The figure: two blocks of three bars, and a sentence that says what it assumes. */
export function packFigure({ n, tileK = 32, nr = 4 } = {}) {
  const c = packCounts({ n, tileK, nr });
  const max = Object.fromEntries(ROWS.map(([key]) => [key, Math.max(c.inPlace[key], c.packed[key])]));
  const label = `One strip of B, ${tileK} values of k by ${nr} columns, in a matrix ${n} columns wide. Read in place it ` +
    `touches ${c.inPlace.lines} cache lines, ${c.inPlace.pages} pages and ${c.inPlace.sets} L1 sets. Read from the packed copy ` +
    `it touches ${c.packed.lines} cache lines, ${c.packed.pages} pages and ${c.packed.sets} L1 sets.`;
  return `<figure class="pack-figure"><div role="img" aria-label="${label}">` +
    `<p class="pk-header">One strip of B: ${tileK} values of k by ${nr} columns, with rows ${n} elements apart in B</p>` +
    bar('Read in place (level 3)', c.inPlace, max) +
    bar('Read from the packed copy (level 4)', c.packed, max) +
    `</div><figcaption>These count what the addresses fall in, not time. They assume the strip starts on a line and a page boundary, ` +
    `64-byte lines, 4 KiB pages and an L1 with 64 sets (32 KiB, 8-way). Where several rows land in few sets, a cache with 8 ways ` +
    `cannot hold them all at once, which is the conflict the paper&rsquo;s Discussion considers. The processor can hide much of ` +
    `this cost, so the counts say what packing removes, not how much faster it runs.</figcaption></figure>`;
}
