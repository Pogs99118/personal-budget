const CACHE = "budget-v5";
const FILES = ["./index.html", "./styles.css", "./logic.js", "./app.js", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(FILES);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(function (cache) { return cache.put(event.request, copy); }).catch(function () {});
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        return cached || caches.match("./index.html");
      });
    })
  );
});
