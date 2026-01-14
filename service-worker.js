// -----------------------------
// Team Tracker - Service Worker
// Version: v5.1.1
// -----------------------------

const CACHE_VERSION = "team-tracker-cache-v5.1.1";
const CACHE_NAME = CACHE_VERSION;

const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/service-worker.js",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png"
];

// Install - pre-cache core shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
  await Promise.all(
    ASSETS_TO_CACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) await cache.put(url, res);
      } catch (e) {
        console.warn("[SW] Skipped caching:", url, e);
      }
    })
  );
})

      .catch((err) => {
        // swallow errors so install does not blow up on one bad asset
        console.error("[SW] Install cache error:", err);
      })
  );
  self.skipWaiting();
});

// Activate - clear old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("team-tracker-cache-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Do not try to cache non-GET or API POST calls
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache API calls (keeps behavior clean, avoids weird stale JSON)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Network-first for navigations (HTML pages)
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/index.html"))
        )
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Only cache successful same-origin responses
          if (
            response &&
            response.status === 200 &&
            response.type === "basic" &&
            url.origin === self.location.origin
          ) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached); // fallback to cache if network fails
    })
  );
});
