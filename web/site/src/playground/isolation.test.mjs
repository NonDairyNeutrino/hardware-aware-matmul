import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from './isolation.mjs';

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
