/*
 * Utarg – service worker: działanie bez internetu.
 * Strategia: najpierw sieć (zawsze świeża wersja, gdy jest internet), a gdy sieci brak – kopia z pamięci podręcznej.
 * Zapytania do GitHuba (inna domena) nie są przechwytywane.
 * Przy wydawaniu nowej wersji zmień VERSION.
 */
var VERSION = 'utarg-1.0.1';
var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/theme-init.js',
  'js/core.js',
  'js/store.js',
  'js/sync.js',
  'js/app.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];
var NETWORK_TIMEOUT = 5000;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) { return cache.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(request) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      caches.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit && !settled) { settled = true; resolve(hit); }
      });
    }, NETWORK_TIMEOUT);

    fetch(request, { cache: 'no-cache' }).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (cache) { cache.put(request, copy); });
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(function () {
      clearTimeout(timer);
      caches.match(request, { ignoreSearch: true }).then(function (hit) {
        if (settled) return;
        settled = true;
        if (hit) resolve(hit);
        else if (request.mode === 'navigate') caches.match('index.html').then(function (idx) { resolve(idx || Response.error()); });
        else resolve(Response.error());
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});
