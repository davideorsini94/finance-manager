/**
 * Helper client-side per registrare il SW, gestire stato online/offline,
 * e cache "ultimi 30gg" tramite IndexedDB.
 */

const DB_NAME = 'fm-cache';
const DB_VERSION = 1;
const TX_STORE = 'transactions';

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          // Nuova versione disponibile — qui potresti mostrare un toast "ricarica per aggiornare"
          window.dispatchEvent(new CustomEvent('sw-update-available'));
        }
      });
    });
  } catch (e) { console.error('SW register failed', e); }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(TX_STORE)) {
        const store = db.createObjectStore(TX_STORE, { keyPath: 'id' });
        store.createIndex('date', 'transactionDate');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/**
 * Persiste in IDB le ultime 30gg di transazioni. Chiamare al login + refresh dati.
 * In offline il client legge da qui in fallback.
 */
export async function persistRecentTransactions(transactions: Array<{ id: string; transactionDate: string }>) {
  const db = await openDb();
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(TX_STORE, 'readwrite');
    const store = tx.objectStore(TX_STORE);
    // Pulizia
    const idx = store.index('date');
    idx.openCursor().onsuccess = (e) => {
      const cur = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cur) {
        if (new Date(cur.value.transactionDate).getTime() < cutoff) cur.delete();
        cur.continue();
      }
    };
    // Insert/update
    transactions.forEach((t) => {
      if (new Date(t.transactionDate).getTime() >= cutoff) store.put(t);
    });
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function readRecentTransactions(): Promise<unknown[]> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(TX_STORE, 'readonly');
    const req = tx.objectStore(TX_STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

// React hook minimale
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function useSyncStatus() {
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.data?.type === 'sync-complete') setSynced(true);
    };
    navigator.serviceWorker?.addEventListener('message', h);
    return () => navigator.serviceWorker?.removeEventListener('message', h);
  }, []);
  return synced;
}
