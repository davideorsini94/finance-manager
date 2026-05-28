/* Service Worker — Finance Manager
 *
 * Strategie di cache:
 *  - app shell (HTML/JS/CSS/font/img) → stale-while-revalidate
 *  - API GET di alcune risorse → network-first con fallback offline
 *  - tutto il resto (mutation PATCH/POST/DELETE, stream binari come gli
 *    allegati, SSE, auth, ecc.) passa attraverso senza interception SW.
 *
 * NB: la VERSION viene bumpata ad ogni release perché:
 *   1. invalida le cache shell/api stale (vecchio bundle JS)
 *   2. trigger di update sul browser → notifica al client che può fare
 *      `postMessage({type:'SKIP_WAITING'})` e ricaricare.
 */

const VERSION = 'v1.0.3';
const SHELL_CACHE = `fm-shell-${VERSION}`;
const API_CACHE = `fm-api-${VERSION}`;
const SHELL_URLS = ['/', '/index.html', '/manifest.json', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_URLS);
      // NON skipWaiting automatico: aspettiamo il messaggio dal client
      // così l'utente non perde lo stato di una pagina aperta.
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo same-origin
  if (url.origin !== self.location.origin) return;

  // API: cachiamo solo specifici GET; tutto il resto (mutation, stream
  // binari, SSE, auth, ecc.) passa attraverso senza interception del SW.
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && isCacheableApi(url.pathname)) {
      event.respondWith(networkFirst(req, API_CACHE));
    }
    // Per tutto il resto: niente respondWith → la richiesta va in rete
    // normalmente, gestita dal browser. Vale anche per:
    //  - PATCH/POST/DELETE (mutazioni — preferiamo fallire con un toast
    //    piuttosto che accodare richieste con cloni di Request potenzialmente
    //    buggati che davano "failed to fetch")
    //  - GET /api/attachments/:id/content (stream binario, non cachare)
    //  - GET /api/notifications/stream (SSE)
    return;
  }

  // Static assets
  if (
    req.destination === 'script' ||
    req.destination === 'style' ||
    req.destination === 'image' ||
    req.destination === 'font'
  ) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // Navigation: app shell + offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstShell(req));
  }
});

function isCacheableApi(path) {
  return (
    path.startsWith('/api/transactions') ||
    path.startsWith('/api/accounts') ||
    path.startsWith('/api/categories') ||
    path.startsWith('/api/budgets') ||
    path.startsWith('/api/goals') ||
    path.startsWith('/api/notifications/unread-count')
  );
}

async function networkFirst(req, cacheName) {
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ offline: true, items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-From-Cache': 'fallback' },
    });
  }
}

async function networkFirstShell(req) {
  try {
    return await fetch(req);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match('/index.html')) ?? (await cache.match('/offline.html')) ?? Response.error()
    );
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

// ---------- Messaging dal client ----------

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
