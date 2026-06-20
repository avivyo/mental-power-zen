// RightPace — Service Worker v1.2
// Caches app shell for offline support + background sync

const CACHE_NAME  = 'rightpace-v1.2';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/index.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js@4',
];

// ─── INSTALL: pre-cache app shell ───────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
});

// ─── ACTIVATE: clean old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH: network-first for API, cache-first for shell ────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API calls — always network
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell — cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

// ─── PUSH NOTIFICATIONS ─────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  const title   = data.title   ?? 'Mental Power Zen';
  const body    = data.body    ?? 'עדכון חדש';
  const icon    = data.icon    ?? '/icon-192.png';
  const badge   = '/icon-192.png';
  const tag     = data.tag     ?? 'mpz-notification';

  event.waitUntil(
    self.registration.showNotification(title, {
      body, icon, badge, tag,
      dir: 'rtl',
      data: { url: data.url ?? '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url ?? '/')
  );
});
