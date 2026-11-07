// The production build's root coi-serviceworker.js: a service worker that removes itself.
//
// Earlier versions registered coi-serviceworker at the site root, so it controlled every page
// of the paper. It is now served from playground/ only (its scope is the playground). A browser
// that still has the old root registration checks its script for updates on each navigation;
// this file is that update. It has no fetch handler, so it adds nothing to any response. Once
// it is active it unregisters itself and reloads each page the old worker controlled, once, so
// those pages are no longer controlled. Keep it until the old registrations have had time to
// update (a few months after the move), then delete it with its check in check-dist.mjs.
// npm's prebuild copies it to public/coi-serviceworker.js unless GATE=1 (the gates keep the
// real copy there, for the G3 page and the playground's migration scenario).
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    await Promise.all(pages.map((page) => page.navigate(page.url).catch(() => {})));
  })());
});
