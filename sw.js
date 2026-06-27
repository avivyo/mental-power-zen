// RightPace — Service Worker v2.0
// Network-first for HTML/JS/CSS — ensures every deploy reaches the browser immediately
// Cache-first only for static assets (images, fonts)

const CACHE_NAME  = 'rightpace-v2.0';
const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

// ─── INSTALL: pre-cache only static assets ───────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// ─── ACTIVATE: destroy ALL old caches ────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Skip non-http(s) requests (chrome-extension, data:, blob:, etc.)
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // Supabase API — always network, never cache
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Google Fonts & jsDelivr CDN — cache-first (rarely change)
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // App shell (index.html, app.js, index.css) — NETWORK FIRST
  // This ensures every Vercel deploy reaches the browser immediately
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline fallback — serve from cache if network fails
        return caches.match(event.request)
          .then(cached => cached || caches.match('/index.html'));
      })
  );
});

// ─── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data  = event.data?.json() ?? {};
  const title = data.title ?? 'RightPace';
  const body  = data.body  ?? 'עדכון חדש';
  const icon  = data.icon  ?? '/icon-192.png';

  event.waitUntil(
    self.registration.showNotification(title, {
      body, icon,
      badge: '/icon-192.png',
      tag:   data.tag ?? 'rightpace-notification',
      dir:   'rtl',
      data:  { url: data.url ?? '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url ?? '/'));
});
