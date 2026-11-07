import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerCounts, registerFigure } from './register-figure.mjs';

test('mr = nr = 4 with 2 lanes: 28 memory operations per k-step at level 2, 6 at level 3', () => {
  const c = registerCounts({ mr: 4, nr: 4, lanes: 2 });
  assert.deepEqual(c.level2, { a: 4, b: 8, cLoad: 8, cStore: 8, total: 28 });
  assert.deepEqual(c.level3, { a: 4, b: 2, cLoad: 0, cStore: 0, total: 6 });
  assert.equal(c.multiplies, 8);
  assert.equal(c.adds, 8);
  assert.equal(c.ratio, 28 / 6);
});

test('four lanes (AVX) give mr * (1 + 3 * 1) = 16 against 4 + 1 = 5', () => {
  const c = registerCounts({ mr: 4, nr: 4, lanes: 4 });
  assert.equal(c.level2.total, 16);
  assert.equal(c.level3.total, 5);
});

test('the figure shows two stacked bars, a legend, the arithmetic and the ratio', () => {
  const html = registerFigure();
  assert.match(html, /<figure class="register-figure">/);
  assert.match(html, /28/);
  assert.match(html, /4\.7×/);
  assert.match(html, /8 multiplies and 8 adds/);
  assert.match(html, /not a measurement|counts requests/);
  assert.equal((html.match(/class="rg-bar"/g) ?? []).length, 2);
  assert.equal((html.match(/rg-seg rg-[abcs]/g) ?? []).length, 4 + 2);
  assert.equal((html.match(/class="rg-key /g) ?? []).length, 4);
  assert.equal((html.match(/role="img" aria-label="[^"]*28 memory operations[^"]*6 memory operations/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script/);
});

test('invalid inputs are rejected', () => {
  assert.throws(() => registerFigure({ mr: 0 }), /positive integer/);
  assert.throws(() => registerFigure({ nr: 4, lanes: 3 }), /divisible|divide/);
  assert.throws(() => registerFigure({ lanes: 1.5 }), /positive integer/);
});
