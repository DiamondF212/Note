const CACHE = 'note-v10';
const ASSETS = ['./', './index.html', './app.css', './app.js', './analysis.js', './audio.js', './drag_drop.js', './tools.js', './docs.js', './pdf_view.js', './pdf_pages.js', './db.js', './crypto.js', './export.js', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

// Precache tollerante: se un file manca, l'installazione non fallisce.
self.addEventListener('install', (event) => event.waitUntil(
  caches.open(CACHE).then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null)))).then(() => self.skipWaiting())
));
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())
));

// Rete prima, cache come ripiego: gli aggiornamenti arrivano subito e l'app resta usabile offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((cached) => cached || caches.match('./index.html')))
  );
});
