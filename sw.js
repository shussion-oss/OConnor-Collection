// Offline support: cache the app shell so it opens without internet.
const CACHE = 'dugout-v6';
const FILES = ['./', 'index.html', 'styles.css', 'config.js', 'db.js', 'online.js', 'sync.js', 'charts.js', 'listing.js', 'app.js', 'extras.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
);
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Network first, so updates show up right away; fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && new URL(e.request.url).origin === location.origin) caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
