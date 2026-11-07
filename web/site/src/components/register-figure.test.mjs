import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerCounts, registerFigure } from './register-figure.mjs';

test('mr = nr = 4, tileJ = 64, 2 lanes: 388 memory operations per k-step at level 2, 96 at level 3', () => {
  const c = registerCounts({ mr: 4, nr: 4, lanes: 2, tileJ: 64 });
  assert.deepEqual(c.level2, { a: 4, b: 128, cLoad: 128, cStore: 128, total: 388 });
  assert.deepEqual(c.level3, { a: 64, b: 32, cLoad: 0, cStore: 0, total: 96 });
  assert.equal(c.multiplies, 128);
  assert.equal(c.adds, 128);
  assert.equal(c.ratio, 388 / 96);
});

test('tileJ defaults to 64', () => {
  assert.deepEqual(registerCounts(), registerCounts({ tileJ: 64 }));
});

test('four lanes (AVX) give 4 + 3 * 64 = 196 against 64 + 16 = 80', () => {
  const c = registerCounts({ mr: 4, nr: 4, lanes: 4, tileJ: 64 });
  assert.equal(c.level2.total, 196);
  assert.equal(c.level3.total, 80);
});

test('the figure shows two stacked bars, a legend, the arithmetic and the ratio', () => {
  const html = registerFigure();
  assert.match(html, /<figure class="register-figure">/);
  assert.match(html, /388/);
  assert.match(html, /4\.0×/);
  assert.match(html, /128 multiplies and 128 adds/);
  assert.match(html, /not a measurement|counts requests/);
  assert.equal((html.match(/class="rg-bar"/g) ?? []).length, 2);
  assert.equal((html.match(/rg-seg rg-[abcs]/g) ?? []).length, 4 + 2);
  assert.equal((html.match(/class="rg-key /g) ?? []).length, 4);
  assert.equal((html.match(/role="img" aria-label="[^"]*388 memory operations[^"]*96 memory operations/g) ?? []).length, 1);
  assert.match(html, /aria-label="[^"]*C is loaded once and stored once per cache block/);
  assert.match(html, /4 × 64 strip/);
  assert.doesNotMatch(html, /<script/);
});

test('invalid inputs are rejected', () => {
  assert.throws(() => registerFigure({ mr: 0 }), /positive integer/);
  assert.throws(() => registerFigure({ nr: 4, lanes: 3 }), /divisible|divide/);
  assert.throws(() => registerFigure({ lanes: 1.5 }), /positive integer/);
  assert.throws(() => registerFigure({ tileJ: 0 }), /positive integer/);
  assert.throws(() => registerFigure({ tileJ: 30 }), /divisible|divide/);
});
