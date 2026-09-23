// Service worker: aplikace funguje offline (cache-first pro vlastní soubory).
// Při každém nasazení změny ZVÝŠIT číslo ve CACHE_NAME, jinak si telefon ponechá staré soubory.
const CACHE_NAME = "slovnicek-v2";

// Všechny cesty relativní k sw.js, aby aplikace fungovala i pod podadresou (GitHub Pages).
const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/config.js",
  "./js/storage.js",
  "./js/translate.js",
  "./js/ui.js",
  "./js/home.js",
  "./js/library.js",
  "./js/flashcards.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache: "reload" obchází HTTP cache, ať se do naší cache nedostanou zastaralé soubory
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Cizí domény (MyMemory) nikdy neintercepujeme ani necachujeme.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        if (request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});
