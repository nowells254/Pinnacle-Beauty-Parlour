const CACHE = 'pinnacle-shell-v10';
// Network-first for HTML/JS/CSS so deploys show up without Incognito
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) return;
  // Always try network first for app files
  e.respondWith(
    fetch(e.request).then(r => r).catch(() => caches.match(e.request))
  );
});
