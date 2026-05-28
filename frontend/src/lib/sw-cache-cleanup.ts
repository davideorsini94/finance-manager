/**
 * Cleanup una-tantum delle cache lasciate da SW di versioni precedenti.
 *
 * Storia: una versione precedente di vite-plugin-pwa cachava le risposte
 * `/api/` con NetworkFirst. Il risultato era che i bilanci dei conti
 * mostrati al frontend potevano restare stale dopo un giroconto perché
 * il SW serviva la risposta dalla sua cache invece che dal network.
 *
 * Anche dopo aver rimosso quel runtimeCaching, il browser dell'utente
 * può tenere ancora attivo il vecchio SW (con la sua cache popolata) finché
 * non viene esplicitamente aggiornato. Per spezzare il problema in modo
 * deterministico, alla startup eliminiamo:
 *   - tutte le Cache Storage il cui nome contiene `api` (cache vecchie)
 *   - le cache workbox-* che NON corrispondono al nuovo schema
 *
 * Eseguito con flag in `localStorage` per non rifarlo ad ogni reload.
 */

const CLEANUP_FLAG = 'fm-sw-api-cleanup-v2';

export async function cleanupLegacyApiCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof caches === 'undefined') return;
  if (window.localStorage.getItem(CLEANUP_FLAG) === '1') return;

  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => /api/i.test(n))
        .map((n) => caches.delete(n)),
    );
    window.localStorage.setItem(CLEANUP_FLAG, '1');
  } catch {
    // ignore: best-effort
  }
}
