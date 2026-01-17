const CACHE_NAME = 'creator-engine-v2';
const urlsToCache = [
  './',
  './index.html',
  './dashboard.html',
  './howtouse.html',
  './manifest.json',
  './favicon.png',
  './logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  // Network first for Dashboard logic, cache fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
