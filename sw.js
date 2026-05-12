/* Service Worker simples para PWA.
   Usa network-first para evitar servir config.js/app.js antigos depois de novo deploy. */
const CACHE_NAME = 'financeiro-distrital-v18';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/config.js',
  '/app.js',
  '/manifest.json',
  '/icon-152.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS).catch(() => null))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca interceptar chamadas ao Apps Script/API.
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => null);
        return res;
      })
      .catch(() => caches.match(req).then(cached => cached || caches.match('/index.html')))
  );
});
