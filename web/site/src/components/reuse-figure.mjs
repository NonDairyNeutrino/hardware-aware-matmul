// The level 2 figure: how many times each element of B is fetched from the slow memory by
// one thread, without and with cache blocking. A model that COUNTS under a stated
// assumption (the cache holds one block of B but not all of B); it is not a measurement.
// Pure functions that return HTML, like cache-figure.mjs.

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const BYTES_PER_VALUE = 8;

function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got ${value}`);
}

/** A byte count as B, KiB, MiB or GiB, with at most one decimal. */
export function formatBytes(bytes) {
  const [unit, size] = bytes >= GIB ? ['GiB', GIB] : bytes >= MIB ? ['MiB', MIB] : bytes >= KIB ? ['KiB', KIB] : ['B', 1];
  const value = Math.round((bytes / size) * 10) / 10;
  return `${value} ${unit}`;
}

/** The counts for one thread of `threads`, each owning n / threads rows of C. */
export function reuseCounts({ n, block, threads }) {
  positiveInteger('n', n);
  positiveInteger('threads', threads);
  if (!Array.isArray(block) || block.length !== 2) throw new Error('block must be [tileK, tileJ]');
  const [tileK, tileJ] = block;
  positiveInteger('tileK', tileK);
  positiveInteger('tileJ', tileJ);
  if (n % threads !== 0) throw new Error(`the thread count ${threads} must divide n = ${n}`);
  const rows = n / threads;
  const bBytes = n * n * BYTES_PER_VALUE;
  return {
    rows,
    fetchesWithout: rows,
    fetchesWith: 1,
    bytesWithout: rows * bBytes,
    bytesWith: bBytes,
    blockBytes: tileK * tileJ * BYTES_PER_VALUE,
  };
}

const times = (count) => (count === 1 ? 'once' : `${count} times`);

function row(label, fetches, bytes, width, note) {
  return `<div class="rf-row"><div class="rf-label"><strong>${label}</strong> ${note}</div>` +
    `<div class="rf-track"><div class="rf-fill${width === 100 ? '' : ' rf-short'}" style="width:${width}%"></div></div>` +
    `<div class="rf-numbers">B is fetched <strong>${times(fetches)}</strong>: <strong>${formatBytes(bytes)}</strong> per thread</div></div>`;
}

/** The figure: two rows (without and with blocking), bars on a log scale of bytes. */
export function reuseFigure({ n, block, threads }) {
  const c = reuseCounts({ n, block, threads });
  const [tileK, tileJ] = block;
  // Log scale: the bar length is log(bytes) / log(largest), so the 256-fold gap shows as a
  // shorter bar instead of a bar too thin to see.
  const width = (bytes) => Math.round((Math.log(bytes) / Math.log(c.bytesWithout)) * 1000) / 10;
  const header = `Example: ${n} × ${n} matrices of 8-byte values, ${threads} threads (${c.rows} rows of C each), ` +
    `blocks of B of ${tileK} × ${tileJ} values = ${formatBytes(c.blockBytes)}`;
  const label = `${header}. Without blocking, each element of B is fetched ${times(c.fetchesWithout)} per thread, ` +
    `${formatBytes(c.bytesWithout)}. With blocking, each element of B is fetched ${times(c.fetchesWith)} per thread, ` +
    `${formatBytes(c.bytesWith)}.`;
  return `<figure class="reuse-figure"><div role="img" aria-label="${label}">` +
    `<p class="rf-header">${header}</p>` +
    row('Without blocking', c.fetchesWithout, c.bytesWithout, width(c.bytesWithout),
      `(<code>i-k-j</code> alone: each of the ${c.rows} rows streams all of B again)`) +
    row('With blocking', c.fetchesWith, c.bytesWith, width(c.bytesWith),
      `(a ${formatBytes(c.blockBytes)} block of B stays in the cache while all ${c.rows} rows use it)`) +
    `</div><figcaption>This counts fetches under one assumption: the cache holds one block of B but not all of B. ` +
    `It is a model of what the loops ask for, not a measurement, and the real saving depends on the cache sizes of the machine. ` +
    `Bar lengths are on a log scale of bytes (the length is the logarithm, so the blocked bar stands for ${c.rows} times fewer bytes ` +
    `but is drawn only a little shorter). The example uses ${threads} threads.</figcaption></figure>`;
}
