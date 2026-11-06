// <step-through level="1"> (levels 1 to 4) draws how a level splits the output matrix C between
// threads (or, at level 4, between tiles). The plan comes from the real Rust code
// compiled to WebAssembly (`partition_plan`), so it is exactly what the level runs.
// Optional attributes set the starting values: rows, cols, inner, threads, tile-k,
// tile-j, tile-rows, tile-cols, tile-depth.
import { loadPlans } from './wasm-lite.js';
import {
  cacheBlocks, caption, microLines, ownerColour, parsePlan, rowDone, rowOwners, stepCount,
  tileOfCell,
} from './step-model.mjs';

const CELL = 22; // pixels per matrix cell
const GUTTER = 28; // room for the thread labels

const FIELDS = {
  rows: { label: 'Output rows', min: 4, max: 16, value: 10 },
  cols: { label: 'Output columns', min: 4, max: 16, value: 8 },
  inner: { label: 'Inner size', min: 4, max: 16, value: 6 },
  threads: { label: 'Threads', min: 1, max: 8, value: 4 },
  tileK: { label: 'Cache block k', min: 1, max: 16, value: 3, attr: 'tile-k' },
  tileJ: { label: 'Cache block j', min: 1, max: 16, value: 4, attr: 'tile-j' },
  tileRows: { label: 'Tile rows', min: 1, max: 16, value: 4, attr: 'tile-rows' },
  tileCols: { label: 'Tile columns', min: 1, max: 16, value: 4, attr: 'tile-cols' },
  tileDepth: { label: 'Tile depth', min: 1, max: 16, value: 3, attr: 'tile-depth' },
};

function fieldsFor(level) {
  const keys = ['rows', 'cols', 'inner', 'threads'];
  if (level === 2) keys.push('tileK', 'tileJ');
  if (level === 4) keys.push('tileRows', 'tileCols', 'tileDepth');
  return keys;
}

// Round to an integer within the field's range; a missing or invalid value falls back to the default.
function clamp(field, value) {
  const whole = Math.round(Number(value));
  if (!Number.isFinite(whole) || whole < 1) return field.value;
  return Math.min(field.max, Math.max(field.min, whole));
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function html(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

class StepThrough extends HTMLElement {
  connectedCallback() {
    if (this.dataset.state) return;
    this.level = Number(this.getAttribute('level'));
    this.params = {};
    for (const key of fieldsFor(this.level)) {
      const field = FIELDS[key];
      this.params[key] = clamp(field, this.getAttribute(field.attr ?? key));
    }
    this.step = 0;
    this.timer = null;
    this.dataset.state = 'loading';
    this.build();
    loadPlans()
      .then((api) => {
        this.api = api;
        this.env = JSON.parse(api.envInfo());
        this.dataset.env = JSON.stringify(this.env);
        this.update();
        this.setEnabled(true);
        this.dataset.state = 'ready';
      })
      .catch((error) => {
        this.dataset.state = 'error';
        this.status.textContent = `The interactive demo could not start (${error}).`;
      });
  }

  disconnectedCallback() {
    this.pause();
  }

  build() {
    this.classList.add('step-through');
    this.controls = html('div', { class: 'st-fields' });
    for (const key of fieldsFor(this.level)) {
      const field = FIELDS[key];
      const input = html('input', { type: 'number', min: field.min, max: field.max, value: this.params[key], 'data-key': key });
      input.addEventListener('change', () => {
        const clamped = clamp(field, input.value);
        input.value = String(clamped);
        this.params[key] = clamped;
        this.step = 0;
        this.pause();
        try {
          this.update();
        } catch (error) {
          this.status.textContent = `Could not draw that (${error.message ?? error}).`;
        }
      });
      const label = html('label');
      label.append(field.label + ' ', input);
      this.controls.append(label);
    }
    this.playButton = html('button', { type: 'button', class: 'st-play' }, 'Play');
    this.playButton.addEventListener('click', () => (this.timer ? this.pause() : this.play()));
    this.stepButton = html('button', { type: 'button', class: 'st-step' }, 'Step');
    this.stepButton.addEventListener('click', () => {
      this.pause();
      this.setStep(this.step >= this.total ? 0 : this.step + 1);
    });
    this.scrub = html('input', { type: 'range', min: 0, max: 0, value: 0, 'aria-label': 'Step' });
    this.scrub.addEventListener('input', () => {
      this.pause();
      this.setStep(Number(this.scrub.value));
    });
    const bar = html('div', { class: 'st-bar' });
    bar.append(this.playButton, this.stepButton, this.scrub);
    this.figure = html('div', { class: 'st-figure' });
    this.status = html('p', { class: 'st-caption', 'aria-live': 'polite' }, 'Loading the demo…');
    this.details = html('details', { class: 'st-plan' });
    this.details.append(html('summary', {}, 'Show the plan'), (this.planText = html('pre')));
    this.replaceChildren(this.controls, bar, this.figure, this.status, this.details);
    this.setEnabled(false);
  }

  // The controls need the wasm module, so they stay disabled until it is ready (and after an error).
  setEnabled(on) {
    for (const control of this.querySelectorAll('input, .st-play, .st-step')) control.disabled = !on;
  }

  update() {
    const p = this.params;
    this.plan = parsePlan(
      this.api.partitionPlan(
        this.level, p.rows, p.inner, p.cols, p.threads,
        p.tileRows ?? 1, p.tileCols ?? 1, p.tileDepth ?? 1,
      ),
    );
    this.dataset.plan = JSON.stringify(this.plan);
    this.planText.textContent = JSON.stringify(this.plan, null, 1);
    this.total = stepCount(this.plan);
    this.step = Math.min(this.step, this.total);
    this.scrub.max = String(this.total);
    this.draw();
  }

  setStep(step) {
    this.step = Math.min(Math.max(step, 0), this.total);
    this.dataset.step = String(this.step);
    this.scrub.value = String(this.step);
    for (const cell of this.figure.querySelectorAll('rect[data-row]')) {
      cell.dataset.done = String(this.isDone(cell));
    }
    this.status.textContent = caption(this.level, this.plan, this.step, this.total);
    if (this.step >= this.total) this.pause();
  }

  isDone(cell) {
    const row = Number(cell.dataset.row);
    if (this.plan.kind === 'rows') return rowDone(this.plan, row, this.step);
    return Number(cell.dataset.claim) < this.step;
  }

  play() {
    if (this.step >= this.total) this.setStep(0);
    this.playButton.textContent = 'Pause';
    this.timer = setInterval(() => this.setStep(this.step + 1), 600);
  }

  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playButton) this.playButton.textContent = 'Play';
  }

  draw() {
    const { rows, cols, inner } = this.params;
    const width = GUTTER + cols * CELL + 2;
    const height = rows * CELL + 2;
    const canvas = svg('svg', {
      viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', class: 'st-grid',
      'aria-label': `The ${rows} by ${cols} output matrix C, coloured by which ${this.plan.kind === 'rows' ? 'thread' : 'tile'} computes each cell`,
    });
    const claim = this.plan.kind === 'tiles' ? tileOfCell(this.plan, rows, cols) : null;
    const owners = this.plan.kind === 'rows' ? rowOwners(this.plan, rows) : null;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const owner = owners ? owners[r] : claim[r * cols + c];
        const attrs = {
          x: GUTTER + c * CELL + 1, y: r * CELL + 1, width: CELL - 1, height: CELL - 1,
          class: `owner-${ownerColour(owner)}`, 'data-row': r, 'data-col': c, 'data-owner': owner,
        };
        if (claim) attrs['data-claim'] = owner;
        canvas.append(svg('rect', attrs));
      }
    }
    if (this.plan.kind === 'rows') this.labelBlocks(canvas, rows, cols);
    else this.labelTiles(canvas);
    this.figure.replaceChildren(canvas);
    if (this.level === 2) this.figure.append(this.drawB(inner, cols));
    this.setStep(this.step);
  }

  labelBlocks(canvas, rows, cols) {
    this.plan.blocks.forEach(([start, end], block) => {
      canvas.append(svg('text', { x: 2, y: start * CELL + CELL * 0.7, class: 'st-label' }, `T${block}`));
      canvas.append(svg('line', {
        x1: GUTTER, x2: GUTTER + cols * CELL, y1: start * CELL + 0.5, y2: start * CELL + 0.5, class: 'st-edge',
      }));
      if (this.level === 3) this.microGrid(canvas, start, end, cols);
    });
  }

  // Level 3: the register-blocked micro-tile inside each block, MR rows by NR columns.
  microGrid(canvas, start, end, cols) {
    const [mr, nr] = this.env.micro_tile;
    for (const at of microLines(end - start, mr)) {
      const y = (start + at) * CELL + 0.5;
      canvas.append(svg('line', { x1: GUTTER, x2: GUTTER + cols * CELL, y1: y, y2: y, class: 'st-micro' }));
    }
    for (const at of microLines(cols, nr)) {
      const x = GUTTER + at * CELL + 0.5;
      canvas.append(svg('line', { x1: x, x2: x, y1: start * CELL, y2: end * CELL, class: 'st-micro' }));
    }
  }

  labelTiles(canvas) {
    this.plan.tiles.forEach((tile, claim) => {
      canvas.append(svg('text', {
        x: GUTTER + tile.cols[0] * CELL + 3, y: tile.rows[0] * CELL + CELL * 0.7, class: 'st-label',
      }, String(claim)));
      canvas.append(svg('rect', {
        x: GUTTER + tile.cols[0] * CELL + 0.5, y: tile.rows[0] * CELL + 0.5,
        width: (tile.cols[1] - tile.cols[0]) * CELL, height: (tile.rows[1] - tile.rows[0]) * CELL, class: 'st-tile',
      }));
    });
  }

  // Level 2: the matrix B with the tile_k by tile_j cache blocks the kernel walks.
  drawB(inner, cols) {
    const blocks = cacheBlocks(inner, cols, this.params.tileK, this.params.tileJ);
    const width = cols * CELL + 2;
    const height = inner * CELL + 2;
    const canvas = svg('svg', {
      viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', class: 'st-grid st-b',
      'aria-label': `The ${inner} by ${cols} matrix B in ${blocks.length} cache blocks`,
    });
    blocks.forEach((block, index) => {
      canvas.append(svg('rect', {
        x: block.cols[0] * CELL + 1, y: block.rows[0] * CELL + 1,
        width: (block.cols[1] - block.cols[0]) * CELL - 1, height: (block.rows[1] - block.rows[0]) * CELL - 1,
        class: `owner-${ownerColour(index)} st-block`, 'data-block': index,
      }));
      canvas.append(svg('text', { x: block.cols[0] * CELL + 4, y: block.rows[0] * CELL + CELL * 0.7, class: 'st-label' }, String(index)));
    });
    const wrap = html('div', { class: 'st-b-wrap' });
    wrap.append(canvas);
    return wrap;
  }
}

if (!customElements.get('step-through')) customElements.define('step-through', StepThrough);
