import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, leaveRootWorker } from './isolation.mjs';

test('an isolated page uses the threaded build', () => {
  assert.deepEqual(decide({ isolated: true, attempts: 0, serviceWorkers: true }), { action: 'threads' });
  assert.deepEqual(decide({ isolated: true, attempts: 1, serviceWorkers: false }), { action: 'threads' });
});

test('a first visit without isolation registers the service worker once', () => {
  assert.deepEqual(decide({ isolated: false, attempts: 0, serviceWorkers: true }), { action: 'register' });
});

test('after one attempt that did not isolate the page, fall back to the lite build', () => {
  const result = decide({ isolated: false, attempts: 1, serviceWorkers: true });
  assert.equal(result.action, 'lite');
  assert.match(result.reason, /still not cross-origin isolated/);
});

test('a browser without service workers goes straight to the lite build', () => {
  const result = decide({ isolated: false, attempts: 0, serviceWorkers: false });
  assert.equal(result.action, 'lite');
  assert.match(result.reason, /no service workers/);
});

test('a page controlled by the old root service worker reloads once, to drop it', () => {
  // Its workers would match no registration (the root one is being removed), so they would get
  // no isolation headers and the threaded start would fail: reload, uncontrolled, instead.
  assert.equal(leaveRootWorker({ controlledByRoot: true, reloaded: false }), 'reload');
  // Never twice in a tab: if the reload did not help, carry on (the lite fallback still works).
  assert.equal(leaveRootWorker({ controlledByRoot: true, reloaded: true }), 'continue');
  assert.equal(leaveRootWorker({ controlledByRoot: false, reloaded: false }), 'continue');
  assert.equal(leaveRootWorker({ controlledByRoot: false, reloaded: true }), 'continue');
});
