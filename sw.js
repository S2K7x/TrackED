// Service worker: makes the second launch near-instant and the app usable offline.
//
// - CDN assets (MediaPipe WASM + models, three.js, fonts, Draco): cache-first.
//   Their URLs are versioned, so a cached copy never goes stale. The one
//   "latest" model URL is served from cache and refreshed in the background.
// - The app's own files: network-first, so updates show up immediately, with
//   the cache as an offline fallback.
const VERSION = "tracked-v2";
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|storage\.googleapis\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|www\.gstatic\.com)\//;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;
  if (CDN.test(url)) {
    e.respondWith(url.includes("/latest/") ? staleWhileRevalidate(e) : cacheFirst(req));
  } else if (new URL(url).origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  }
});

async function put(req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const cache = await caches.open(VERSION);
    await cache.put(req, res.clone());
  }
  return res;
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  return hit || put(req, await fetch(req));
}

function staleWhileRevalidate(e) {
  const update = fetch(e.request).then((res) => put(e.request, res)).catch(() => null);
  e.waitUntil(update);
  return caches.match(e.request).then((hit) => hit || update);
}

async function networkFirst(req) {
  try {
    // "no-cache" = always ask the server (a cheap 304 when unchanged). Without it, the
    // browser's HTTP cache can answer with an old copy and an update never shows up.
    // A navigation request can't be re-built with options; navigations are revalidated anyway.
    return await put(req, await (req.mode === "navigate" ? fetch(req) : fetch(req, { cache: "no-cache" })));
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    throw err;
  }
}
