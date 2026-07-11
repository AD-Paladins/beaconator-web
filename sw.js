const CACHE = 'devdash-v15';
const SHELL = ['./index.html', './style.css', './main.js', './config.js', './github.js', './jira.js', './ui.js', './ui-utils.js', './ui-crypto.js', './metrics.js', './notifications.js', './i18n.js', './locales/en.json', './locales/es.json', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache API calls (GitHub / Jira) — always hit network
  if (url.origin.includes('github.com') || url.origin.includes('atlassian')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
