// Service worker VTC Perso (généré au build : la liste des fichiers et la version sont injectées).
// Stratégie : coquille applicative pré-cachée (fonctionne hors connexion), aucune mise en cache
// des appels Supabase/Gemini, mise à jour contrôlée par l'utilisateur (les données IndexedDB ne sont pas touchées).
const VERSION = '__VERSION__';
const CACHE = 'vtcperso-shell-' + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('vtcperso-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, Google : jamais servis depuis le cache
  if (req.mode === 'navigate') {
    // Navigation : coquille en cache (lancement hors connexion), réseau si absente.
    event.respondWith(caches.match('./index.html', { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
