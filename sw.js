/* 我的日历 service worker — static shell only, cache-first, relative URLs.
   User photos live in IndexedDB and are never fetched or cached here. */
const CACHE = "cal2027-diy-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./data/calendar-data.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
