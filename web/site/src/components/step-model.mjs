// What the step-through draws, as plain data, with no DOM and no WebAssembly: the
// element feeds it the JSON from `partition_plan` and draws the result. Keeping
// it separate makes the rules testable with `node --test`.

/** How many owner colours the stylesheet defines (`--owner-0` ...). */
export const OWNER_COUNT = 8;

/** Parses the `partition_plan` JSON and checks its shape. */
export function parsePlan(json) {
  const plan = typeof json === 'string' ? JSON.parse(json) : json;
  if (plan.kind === 'rows' && Array.isArray(plan.blocks)) return plan;
  if (plan.kind === 'tiles' && Array.isArray(plan.tiles) && Array.isArray(plan.depth)) return plan;
  throw new Error('unrecognised plan: ' + JSON.stringify(plan).slice(0, 80));
}

/** Rows plans: the block (and so thread) that owns each output row. */
export function rowOwners(plan, rows) {
  const owners = new Array(rows).fill(-1);
  plan.blocks.forEach(([start, end], block) => {
    for (let row = start; row < end; row += 1) owners[row] = block;
  });
  return owners;
}

/**
 * Number of steps. A thread works through its block one row per step, all
 * threads at once, so a rows plan takes as many steps as its largest block has
 * rows. A tiles plan takes one step per tile, in the order tiles are claimed.
 */
export function stepCount(plan) {
  if (plan.kind === 'rows') return Math.max(...plan.blocks.map(([a, b]) => b - a));
  return plan.tiles.length;
}

/** Rows plans: is output row `row` finished after `step` steps? */
export function rowDone(plan, row, step) {
  const block = plan.blocks.find(([a, b]) => row >= a && row < b);
  return block !== undefined && row - block[0] < step;
}

/**
 * Tiles plans: for each output cell (row-major, `rows` by `cols`), the claim
 * number of the tile that covers it. A plan from `partition_plan` covers every
 * cell exactly once.
 */
export function tileOfCell(plan, rows, cols) {
  const owners = new Array(rows * cols).fill(-1);
  plan.tiles.forEach((tile, claim) => {
    for (let r = tile.rows[0]; r < tile.rows[1]; r += 1) {
      for (let c = tile.cols[0]; c < tile.cols[1]; c += 1) owners[r * cols + c] = claim;
    }
  });
  return owners;
}

/** The colour index of the thread or worker slot `n`. */
export function ownerColour(n) {
  return ((n % OWNER_COUNT) + OWNER_COUNT) % OWNER_COUNT;
}

/**
 * Level 2's cache blocks over `B` (`inner` rows by `cols` columns): the
 * `tile_k` by `tile_j` pieces `B` is walked in, in the order the kernel visits
 * them, clipped at the edges.
 */
export function cacheBlocks(inner, cols, tileK, tileJ) {
  const blocks = [];
  for (let k = 0; k < inner; k += tileK) {
    for (let j = 0; j < cols; j += tileJ) {
      blocks.push({ rows: [k, Math.min(k + tileK, inner)], cols: [j, Math.min(j + tileJ, cols)] });
    }
  }
  return blocks;
}

/** Level 3's micro-tile grid lines over a block of `C`: positions of the lines. */
export function microLines(extent, size) {
  const lines = [];
  for (let at = size; at < extent; at += size) lines.push(at);
  return lines;
}

/** The sentence under the grid for the current step. */
export function caption(level, plan, step, total) {
  if (level === 0) return 'One thread computes every row, in order.';
  if (plan.kind === 'tiles') {
    const workers = plan.workers;
    return (
      `${step} of ${total} tiles done. Tiles are claimed in this order by whichever ` +
      `worker is free; with ${workers} worker${workers === 1 ? '' : 's'}, up to ${workers} ` +
      `tile${workers === 1 ? ' is' : 's are'} in flight at once.`
    );
  }
  const threads = plan.blocks.length;
  return (
    `Step ${step} of ${total}: each of the ${threads} thread${threads === 1 ? '' : 's'} has ` +
    `finished ${step} row${step === 1 ? '' : 's'} of its block (a block with fewer rows finishes early).`
  );
}
