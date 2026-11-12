// Guarda la app en caché para que funcione sin internet.
// Sube el número de versión cada vez que cambies archivos.
const CACHE = 'nosotros-v6';
const FILES = ['./', './index.html', './styles.css', './app.js', './core.js', './data.js', './home.js', './decide.js',
  './love.js', './moments.js', './lists.js', './money.js', './places.js', './trips.js', './us.js', './quiz.js',
  './summary.js', './settings.js', './calendar.js', './shows.js', './tmdb-config.js', './firebase-config.js', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];
// Además de la app: la librería de Firebase, la tipografía y los pósters de películas.
const HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'image.tmdb.org'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Primero intenta la red (para recibir actualizaciones); si no hay, usa la caché.
// Las conexiones con la base de datos pasan directo (Firebase maneja su propio modo sin internet).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const mine = url.origin === self.location.origin || HOSTS.includes(url.hostname);
  if (e.request.method !== 'GET' || !mine) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
