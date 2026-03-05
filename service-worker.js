// -----------------------------
// Team Tracker - Service Worker
// Version: v6.2.1
// -----------------------------

const ASSET_VERSION = "6.2.1";
const CACHE_VERSION = `team-tracker-cache-v${ASSET_VERSION}`;
const CACHE_NAME = CACHE_VERSION;

const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  `/css/styles.css?v=${ASSET_VERSION}`,
  `/css/auth.css?v=${ASSET_VERSION}`,
  `/js/app.js?v=${ASSET_VERSION}`,
  `/js/auth.js?v=${ASSET_VERSION}`,
  `/js/spectator.js?v=${ASSET_VERSION}`,
  `/js/teams.js?v=${ASSET_VERSION}`,
  `/manifest.json?v=${ASSET_VERSION}`,
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
              if (res.ok) await cache.put(url, res.clone());
            } catch (e) {
              console.warn("[SW] Skipped caching:", url, e);
            }
          })
        );
      })
      .catch((err) => {
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

  // Never cache API calls — pass through to network
  if (url.pathname.startsWith("/api/")) {
    return; // let the browser handle it (app-level offline queue catches errors)
  }

  // Network-first for navigations (HTML pages)
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
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

  // Network-first for versioned shell assets to avoid mixed old/new app bundles.
  if (
    url.origin === self.location.origin &&
    (
      request.destination === "script" ||
      request.destination === "style" ||
      request.destination === "worker" ||
      request.destination === "manifest" ||
      url.pathname === "/manifest.json" ||
      url.pathname.startsWith("/js/") ||
      url.pathname.startsWith("/css/")
    )
  ) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for remaining static assets
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
