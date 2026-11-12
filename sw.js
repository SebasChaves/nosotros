// Guarda la app en caché para que funcione sin internet.
// Sube el número de versión cada vez que cambies archivos.
const CACHE = 'nosotros-v2';
const FILES = ['./', './index.html', './manifest.json', './firebase-config.js', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Solo se cachean los archivos de la app y la librería de Firebase.
// Las conexiones con la base de datos pasan directo (Firebase maneja su propio modo sin internet).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const mine = url.origin === self.location.origin || url.hostname === 'www.gstatic.com';
  if (e.request.method !== 'GET' || !mine) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
