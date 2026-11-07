import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseBatch, timeSample } from './batching.mjs';

// A fake operation costing `cost` ms and a clock that shows the elapsed time rounded down to a
// multiple of `resolution` ms, like a browser's coarsened performance.now().
function fake(cost, resolution) {
  let time = 0;
  return {
    run: () => { time += cost; },
    now: () => Math.floor(time / resolution) * resolution,
    runs: () => Math.round(time / cost),
  };
}

test('a slow operation is timed one run at a time', () => {
  const { run, now } = fake(100, 1);
  assert.equal(chooseBatch(run, now), 1);
});

test('a fast operation on a 1 ms clock is batched until a sample lasts about the target', () => {
  const { run, now } = fake(0.05, 1);
  const batch = chooseBatch(run, now);
  assert.ok(batch >= 600 && batch <= 4096, `batch ${batch}`);
});

test('the batch is capped', () => {
  const { run, now } = fake(0.0001, 1);
  assert.equal(chooseBatch(run, now, { maxBatch: 64 }), 64);
});

test('a batched sample recovers the true per-run time despite the coarse clock', () => {
  const { run, now } = fake(0.05, 1);
  const batch = chooseBatch(run, now);
  const sample = timeSample(run, now, batch);
  assert.ok(Math.abs(sample - 0.05) < 0.002, `sample ${sample}`);
});

test('timing one run on a coarse clock reads zero: the problem batching solves', () => {
  const { run, now } = fake(0.05, 1);
  assert.equal(timeSample(run, now, 1), 0);
});

test('the calibration runs only as many times as it needs to', () => {
  const clock = fake(10, 1);
  chooseBatch(clock.run, clock.now, { targetMs: 30 });
  assert.ok(clock.runs() <= 7, `ran ${clock.runs()} times`);
});
