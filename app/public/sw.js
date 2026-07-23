// Minimal service worker: enough to make Timeblock installable as an app and to
// show a cached shell when offline. It intentionally does NOT cache hashed JS/CSS
// (so deploys never serve stale assets) — the app needs the network for Supabase
// anyway. Only navigations fall back to the cached shell when offline.
const CACHE = "timeblock-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith(fetch(request).catch(() => caches.match("/")));
});
