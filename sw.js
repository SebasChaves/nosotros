// Guarda la app en caché para que funcione sin internet.
// Sube el número de versión cada vez que cambies archivos.
const CACHE = 'nosotros-v50';
const FILES = ['./', './index.html', './styles.css', './app.js', './core.js', './data.js', './home.js', './decide.js',
  './love.js', './moments.js', './lists.js', './money.js', './places.js', './trips.js', './us.js', './quiz.js',
  './summary.js', './settings.js', './calendar.js', './shows.js', './tmdb-config.js', './games.js', './games-data.js', './booking.js', './search.js', './tour.js', './testing.js', './tracking.js', './admin.js', './recipes.js', './recipes-data.js', './daily.js', './map.js', './music.js', './badges.js', './lock.js', './location.js', './reminders.js', './snaps.js', './push.js', './push-config.js', './pet.js', './pet-art.js', './pet-games.js', './guess.js', './week.js', './cravings.js', './menu.js', './arrows.js', './firebase-config.js', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png', './icon-badge.png'];
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
  if (e.request.method !== 'GET' || !mine || url.pathname.endsWith('/version.json')) return;
  // Los archivos de la app se piden "sin caché" del navegador (con revalidación) para que una versión nueva llegue al instante.
  const own = url.origin === self.location.origin;
  e.respondWith(
    fetch(own ? new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' }) : e.request)
      .then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })) // ?snap, ?emu…
  );
});

/* ---------- Notificaciones (push.js / notificaciones/worker.js) ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  // Urgentes (antojo 🔥): la etiqueta empieza con «urgente-». En Android se quedan en pantalla hasta tocarlas y vibran más.
  const loud = String(d.tag || '').startsWith('urgente-');
  e.waitUntil(self.registration.showNotification(d.title || 'Futari', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-badge.png', tag: d.tag || undefined, renotify: !!d.tag,
    ...(loud ? { requireInteraction: true, vibrate: [400, 120, 400, 120, 800], silent: false } : {}),
    data: { url: d.url || './' } }));
});
// Al tocar el aviso: si Futari ya está abierta, la trae al frente y le dice qué abrir; si no, la abre ahí.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ futariOpen: url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
