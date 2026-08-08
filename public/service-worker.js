/* Intentionally does no caching — its only job is to satisfy the browser's
   "has a registered service worker" installability requirement so the
   native Install-app prompt appears. Every fetch falls straight through to
   the network exactly as if no service worker were present at all, which
   matters here since this app's data (attendance, chat, notifications) must
   never be served stale from a cache. */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // No-op: not calling event.respondWith() lets the browser handle the
  // request normally (plain network passthrough).
});
