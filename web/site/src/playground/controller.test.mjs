import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createController } from './controller.mjs';

// A worker the test drives by hand.
function fakeWorkers() {
  const made = [];
  const makeWorker = () => {
    const worker = {
      posted: [],
      terminated: false,
      onmessage: null,
      onerror: null,
      postMessage(message) { this.posted.push(message); },
      terminate() { this.terminated = true; },
      emit(data) { this.onmessage?.({ data }); },
    };
    made.push(worker);
    return worker;
  };
  return { made, makeWorker };
}

const request = { n: 64, levels: [0, 3], threads: 1, repeats: 1, block: [32, 64], tile: [128, 128, 128] };

test('a run streams ready, one result per level, then done', async () => {
  const { made, makeWorker } = fakeWorkers();
  const seen = [];
  const controller = createController({ makeWorker, build: 'lite', onMessage: (m) => seen.push(m.type) });
  const run = controller.start(request, { timeout: 5000 });
  assert.equal(controller.running, true);
  const [worker] = made;
  assert.deepEqual(worker.posted, [{ type: 'run', id: 1, build: 'lite', request }]);
  worker.emit({ type: 'ready', id: 1, build: 'lite', pool: 1, env: { isa: 'X' } });
  worker.emit({ type: 'result', id: 1, level: 0, times_ms: [10], hash: 'h' });
  worker.emit({ type: 'result', id: 1, level: 3, times_ms: [2], hash: 'h' });
  worker.emit({ type: 'done', id: 1, request });
  const outcome = await run;
  assert.equal(outcome.status, 'done');
  assert.deepEqual(outcome.results.map((r) => r.level), [0, 3]);
  assert.equal(outcome.ready.pool, 1);
  assert.deepEqual(seen, ['ready', 'result', 'result', 'done']);
  assert.equal(controller.running, false);
  assert.equal(worker.terminated, false, 'a finished run keeps its worker (and its thread pool)');
});

test('the next run reuses the worker of a finished run', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'threads' });
  const first = controller.start(request, { timeout: 5000 });
  made[0].emit({ type: 'done', id: 1, request });
  await first;
  const second = controller.start(request, { timeout: 5000 });
  assert.equal(made.length, 1);
  assert.equal(made[0].posted[1].id, 2);
  made[0].emit({ type: 'done', id: 2, request });
  assert.equal((await second).status, 'done');
});

test('cancel terminates the worker and the next run gets a fresh one', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'lite' });
  const run = controller.start(request, { timeout: 5000 });
  made[0].emit({ type: 'result', id: 1, level: 0, times_ms: [5], hash: 'h' });
  controller.cancel();
  const outcome = await run;
  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.results.length, 1, 'results that arrived before the cancel are kept');
  assert.equal(made[0].terminated, true);
  assert.equal(controller.hasWorker, false);
  const again = controller.start(request, { timeout: 5000 });
  assert.equal(made.length, 2);
  made[1].emit({ type: 'done', id: 2, request });
  assert.equal((await again).status, 'done');
});

test('a run that takes too long times out and terminates the worker', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'threads' });
  const outcome = await controller.start(request, { timeout: 30 });
  assert.equal(outcome.status, 'timeout');
  assert.equal(outcome.timeout, 30);
  assert.equal(made[0].terminated, true);
  assert.equal(controller.running, false);
});

test('an error message or a worker failure ends the run and discards the worker', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'lite' });
  const first = controller.start(request, { timeout: 5000 });
  made[0].emit({ type: 'error', id: 1, message: 'boom' });
  const failed = await first;
  assert.deepEqual([failed.status, failed.message], ['error', 'boom']);
  assert.equal(made[0].terminated, true);
  const second = controller.start(request, { timeout: 5000 });
  made[1].onerror({ message: 'could not load' });
  const crashed = await second;
  assert.deepEqual([crashed.status, crashed.message], ['error', 'could not load']);
});

test('messages from an old run are ignored', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'lite' });
  const run = controller.start(request, { timeout: 5000 });
  made[0].emit({ type: 'result', id: 99, level: 4, times_ms: [1], hash: 'stale' });
  made[0].emit({ type: 'done', id: 99, request });
  assert.equal(controller.running, true);
  made[0].emit({ type: 'done', id: 1, request });
  const outcome = await run;
  assert.equal(outcome.results.length, 0);
});

test('starting while a run is in progress is an error', async () => {
  const { made, makeWorker } = fakeWorkers();
  const controller = createController({ makeWorker, build: 'lite' });
  const run = controller.start(request, { timeout: 5000 });
  assert.throws(() => controller.start(request, { timeout: 5000 }), /already in progress/);
  made[0].emit({ type: 'done', id: 1, request });
  await run;
});

test('a worker that cannot be made or started ends the run with an error', async () => {
  const throwing = { postMessage() { throw new Error('cannot post'); }, terminate() { this.terminated = true; }, terminated: false };
  const controller = createController({ makeWorker: () => throwing, build: 'lite' });
  const outcome = await controller.start(request, { timeout: 5000 });
  assert.equal(outcome.status, 'error');
  assert.match(outcome.message, /cannot post/);
  assert.equal(controller.running, false);
  assert.equal(throwing.terminated, true);
  assert.equal(controller.hasWorker, false);

  const failing = createController({ makeWorker: () => { throw new Error('no worker'); }, build: 'lite' });
  const second = await failing.start(request, { timeout: 5000 });
  assert.equal(second.status, 'error');
  assert.equal(failing.running, false);
});
