/**
 * Compat shim per i componenti redesign-patches che usano `authFetch`
 * mentre il resto del progetto usa `ky` via `@/lib/api/client`.
 *
 * Gestisce 401 → refresh come la `api` ky instance: la implementazione
 * usa direttamente `fetch` con `credentials: include`.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      return r.ok;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function withBase(input: string): string {
  if (input.startsWith('http')) return input;
  if (input.startsWith('/api/')) return BASE + input.slice(4);
  if (input.startsWith('/')) return BASE + input;
  return `${BASE}/${input}`;
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = withBase(input);
  const merged: RequestInit = { credentials: 'include', ...init };
  const res = await fetch(url, merged);
  if (res.status !== 401) return res;
  if (url.includes('/auth/login') || url.includes('/auth/refresh')) return res;
  const ok = await refresh();
  if (!ok) return res;
  return fetch(url, merged);
}
