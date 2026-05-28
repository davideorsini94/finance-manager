import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';

export type NotificationType =
  | 'budget_threshold'
  | 'recurring_executed'
  | 'cc_payment_due'
  | 'goal_reached'
  | 'large_transaction'
  | 'account_shared'
  | 'import_ready'
  | 'system';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface ListResult {
  items: Notification[];
  total: number;
  unread: number;
}

export function useNotifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const refetch = useCallback(
    async (opts?: { unreadOnly?: boolean; limit?: number }) => {
      setLoading(true);
      try {
        const search = new URLSearchParams();
        if (opts?.unreadOnly) search.set('unreadOnly', 'true');
        search.set('limit', String(opts?.limit ?? 30));
        const json = await api.get(`notifications?${search}`).json<ListResult>();
        setItems(json.items);
        setTotal(json.total);
        setUnread(json.unread);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setItems((prev) =>
      prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - ids.length));
    await api.patch('notifications/read', { json: { ids } });
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await api.patch('notifications/read-all');
  }, []);

  const remove = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await api.delete(`notifications/${id}`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let backoff = 1000;
    const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';
    const connect = () => {
      if (cancelled) return;
      const es = new EventSource(`${baseUrl}/notifications/stream`, { withCredentials: true });
      sseRef.current = es;
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as
            | { event: 'created'; notification: Notification }
            | { event: 'read'; ids: string[] }
            | { event: 'unread_count'; count: number };
          if (msg.event === 'created') {
            setItems((prev) => [msg.notification, ...prev].slice(0, 50));
          } else if (msg.event === 'unread_count') {
            setUnread(msg.count);
          } else if (msg.event === 'read') {
            const ids = new Set(msg.ids);
            setItems((prev) =>
              prev.map((n) =>
                ids.has(n.id) || msg.ids.length === 0
                  ? { ...n, readAt: n.readAt ?? new Date().toISOString() }
                  : n,
              ),
            );
          }
        } catch {
          /* ignore */
        }
      };
      es.onopen = () => { backoff = 1000; };
      es.onerror = () => {
        es.close();
        sseRef.current = null;
        if (!cancelled) {
          setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 30000);
        }
      };
    };
    void refetch();
    connect();
    return () => {
      cancelled = true;
      sseRef.current?.close();
    };
  }, [refetch]);

  return { items, unread, total, loading, refetch, markRead, markAllRead, remove };
}
