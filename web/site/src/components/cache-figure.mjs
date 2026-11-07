// The picture of the primer: an n x n matrix stored row by row, cut into cache lines of
// `lineLen` values, with the cells a row walk and a column walk use and the cells they
// fetch and waste. Pure functions that return HTML, like src/results/render.mjs.

/** Which cache lines a walk down the first row or the first column touches. A cache line is
 *  `lineLen` consecutive values in row-major order. */
export function walkLines(n, lineLen, walk) {
  if (n % lineLen !== 0) throw new Error(`the line length ${lineLen} must divide the row length ${n}`);
  const touched = [];
  for (let i = 0; i < n; i += 1) touched.push(walk === 'row' ? [0, i] : [i, 0]);
  const lines = [...new Set(touched.map(([row, column]) => Math.floor((row * n + column) / lineLen)))].sort((a, b) => a - b);
  return { touched, lines, used: touched.length, fetched: lines.length * lineLen };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function grid(n, lineLen, walk, label) {
  const { touched, lines } = walkLines(n, lineLen, walk);
  const used = new Set(touched.map(([row, column]) => row * n + column));
  const fetched = new Set(lines);
  const cells = [];
  for (let index = 0; index < n * n; index += 1) {
    const line = Math.floor(index / lineLen);
    const state = used.has(index) ? ' used' : fetched.has(line) ? ' wasted' : '';
    const start = index % lineLen === 0 ? ' ls' : '';
    cells.push(`<span class="cl cl-${line % 2}${start}${state}"></span>`);
  }
  return `<div class="cache-walk"><div class="cache-grid" style="--n:${n}" role="img" aria-label="${label}">${cells.join('')}</div>` +
    `<p>${label}</p></div>`;
}

/** The figure: both walks side by side, with a legend. */
export function cacheLineFigure({ n = 8, lineLen = 4 } = {}) {
  const row = walkLines(n, lineLen, 'row');
  const column = walkLines(n, lineLen, 'column');
  const describe = (name, walk) => `${name}: ${plural(walk.used, 'value')} used, ${plural(walk.lines.length, 'cache line')} fetched`;
  return `<figure class="cache-figure"><div class="cache-pair">` +
    grid(n, lineLen, 'row', describe('Walking along a row', row)) +
    grid(n, lineLen, 'column', describe('Walking down a column', column)) +
    `</div><figcaption>An ${n} × ${n} matrix stored row by row, with cache lines of ${lineLen} values (a heavy bar marks where each ` +
    `line starts, and the shade alternates from one line to the next). In real hardware a line holds eight values, not four. Blue cells are the values the walk uses; outlined cells arrive in the same cache lines ` +
    `and are not used.</figcaption></figure>`;
}
