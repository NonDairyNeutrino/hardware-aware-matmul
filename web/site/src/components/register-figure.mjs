// The level 3 figure: the memory operations one step along k of an MR x NR block of C asks
// for at level 2 (axpy once per row) and at level 3 (the micro-kernel, C in registers).
// A count of requests, not a measurement of time. Pure functions that return HTML.
//
// KEEP IN STEP with src/simd.rs: the defaults (MR = 4, NR = 4, 2 f64 lanes) are the
// micro-tile of the SSE2 / WebAssembly SIMD128 builds. The Node container cannot read the
// Rust source, so there is no automatic guard against drift.

function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got ${value}`);
}

/** Memory operations per k-step, by kind, and the arithmetic. */
export function registerCounts({ mr = 4, nr = 4, lanes = 2 } = {}) {
  positiveInteger('mr', mr);
  positiveInteger('nr', nr);
  positiveInteger('lanes', lanes);
  if (nr % lanes !== 0) throw new Error(`nr = ${nr} must be divisible by lanes = ${lanes}`);
  const vectors = nr / lanes;
  const level2 = { a: mr, b: mr * vectors, cLoad: mr * vectors, cStore: mr * vectors };
  level2.total = level2.a + level2.b + level2.cLoad + level2.cStore;
  const level3 = { a: mr, b: vectors, cLoad: 0, cStore: 0 };
  level3.total = level3.a + level3.b;
  return { level2, level3, multiplies: mr * vectors, adds: mr * vectors, ratio: level2.total / level3.total };
}

const SEGMENTS = [
  ['a', 'A loads (broadcast)', 'a'],
  ['b', 'B loads (vector)', 'b'],
  ['cLoad', 'C loads (vector)', 'cl'],
  ['cStore', 'C stores (vector)', 'cs'],
];

function bar(title, counts, max) {
  const segments = SEGMENTS.filter(([key]) => counts[key] > 0).map(([key, name, cls]) =>
    `<span class="rg-seg rg-${cls}" style="width:${(counts[key] / max) * 100}%" title="${name}: ${counts[key]}">${counts[key]}</span>`);
  return `<div class="rg-row"><div class="rg-label">${title}: <strong>${counts.total}</strong> memory operations per k-step</div>` +
    `<div class="rg-bar">${segments.join('')}</div></div>`;
}

/** The figure: two stacked bars, a legend, and the arithmetic and ratio line. */
export function registerFigure({ mr = 4, nr = 4, lanes = 2 } = {}) {
  const c = registerCounts({ mr, nr, lanes });
  const ratio = (Math.round(c.ratio * 10) / 10).toFixed(1);
  const label = `For one step along k of a ${mr} × ${nr} block of C: level 2 asks for ${c.level2.total} memory operations ` +
    `(${c.level2.a} A loads, ${c.level2.b} B loads, ${c.level2.cLoad} C loads, ${c.level2.cStore} C stores); ` +
    `level 3 asks for ${c.level3.total} memory operations (${c.level3.a} A loads, ${c.level3.b} B loads). ` +
    `Both do ${c.multiplies} multiplies and ${c.adds} adds, so level 3 asks for ${ratio} times fewer.`;
  const legend = SEGMENTS.map(([, name, cls]) => `<span class="rg-key rg-${cls}">${name}</span>`).join('');
  return `<figure class="register-figure"><div role="img" aria-label="${label}">` +
    `<p class="rg-header">One step along k of a ${mr} × ${nr} block of C (${lanes} values per vector register)</p>` +
    bar('Level 2, axpy once per row', c.level2, c.level2.total) +
    bar('Level 3, micro-kernel', c.level3, c.level2.total) +
    `<div class="rg-legend">${legend}</div>` +
    `<p class="rg-sum">Arithmetic is the same in both: ${c.multiplies} multiplies and ${c.adds} adds (vector operations). ` +
    `Memory operations: ${c.level2.total} / ${c.level3.total} = <strong>${ratio}× fewer</strong> at level 3. ` +
    `At level 3, C is loaded once and stored once per cache block, which is not counted per step.</p></div>` +
    `<figcaption>This counts requests, not time: the processor overlaps loads with arithmetic, and the measured gain of level 3 ` +
    `over level 2 (reported in the Discussion) is much smaller than this count, so memory operations are one limit among several. ` +
    `The constants MR = ${mr}, NR = ${nr} and ${lanes} lanes are those of the SSE2 and WebAssembly SIMD128 builds.</figcaption></figure>`;
}
