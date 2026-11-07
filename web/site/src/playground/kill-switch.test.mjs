import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// The production root coi-serviceworker.js (see kill-switch-sw.js): run it in a fake service
// worker global and drive its lifecycle events by hand.
const source = readFileSync(new URL('./kill-switch-sw.js', import.meta.url), 'utf8');

function fakeServiceWorker() {
  const listeners = {};
  const log = [];
  const clients = [
    { url: 'https://example.org/hardware-aware-matmul/results/', navigate(url) { log.push(['navigate', url]); return Promise.resolve(this); } },
    { url: 'https://example.org/hardware-aware-matmul/playground/', navigate(url) { log.push(['navigate', url]); return Promise.reject(new Error('gone')); } },
  ];
  const self = {
    addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
    skipWaiting() { log.push(['skipWaiting']); return Promise.resolve(); },
    registration: { unregister() { log.push(['unregister']); return Promise.resolve(true); } },
    clients: {
      // The options object comes from the script's own realm: compare it as JSON.
      matchAll(options) { log.push(['matchAll', JSON.stringify(options)]); return Promise.resolve(clients); },
      claim() { log.push(['claim']); return Promise.resolve(); },
    },
  };
  vm.runInNewContext(source, { self });
  // Fires `type` and waits for whatever the listeners passed to waitUntil.
  async function fire(type) {
    const pending = [];
    for (const listener of listeners[type] ?? []) listener({ waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  }
  return { listeners, log, fire };
}

test('the kill-switch adds no headers: it does not handle fetches', () => {
  const { listeners } = fakeServiceWorker();
  assert.equal(listeners.fetch, undefined);
  assert.doesNotMatch(source, /Cross-Origin-|new Headers|addEventListener\(\s*['"]fetch/);
});

test('it takes over at once, unregisters itself and reloads each page the old worker controlled', async () => {
  const { log, fire } = fakeServiceWorker();
  await fire('install');
  assert.deepEqual(log, [['skipWaiting']]);
  log.length = 0;
  await fire('activate');
  assert.deepEqual(log[0], ['unregister']);
  assert.deepEqual(log[1], ['matchAll', JSON.stringify({ type: 'window' })]);
  assert.deepEqual(log.slice(2), [
    ['navigate', 'https://example.org/hardware-aware-matmul/results/'],
    ['navigate', 'https://example.org/hardware-aware-matmul/playground/'],
  ], 'one reload per page, and a page that is gone does not fail the activation');
});
