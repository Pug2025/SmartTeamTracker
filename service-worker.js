// -----------------------------
// SmartTeamTracker – Service Worker
// Version: v4.0.0
// -----------------------------

const CACHE_VERSION = 'smart-team-tracker-v4.0.0';
const CACHE_NAME = `smart-team-tracker-cache-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico'
  // Add icon files here if/when you have them:
  // '/icon-192.png',
  // '/icon-512.png',
  // '/apple-touch-icon.png'
];

// Install: pre-cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('smart-team-tracker-cache-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first app shell, then network
self.addEventListener('fetch', event => {
  const { request } = event;

  // Only handle GET
  if (request.method !== 'GET') return;

  // Navigation requests → always fall back to index.html (SPA routing safe)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // If online nav works, still cache index.html for offline
          cacheIndexHtml();
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then(cached => cached || Response.error())
        )
    );
    return;
  }

  // Static assets: cache-first, then network
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request)
        .then(response => {
          // Only cache successful, basic/opaque responses
          if (
            !response ||
            response.status !== 200 ||
            (response.type !== 'basic' && response.type !== 'opaque')
          ) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });

          return response;
        })
        .catch(() => {
          // For non-nav requests, just fail quietly if offline
          return cached || Response.error();
        });
    })
  );
});

// Helper: ensure index.html is cached
function cacheIndexHtml() {
  caches.open(CACHE_NAME).then(cache => {
    cache.match('/index.html').then(hit => {
      if (!hit) cache.add('/index.html');
    });
  });
}
