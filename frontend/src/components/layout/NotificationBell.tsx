import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  AlertTriangle,
  Repeat,
  CreditCard,
  Target,
  TrendingUp,
  UserPlus,
  FileSpreadsheet,
  Info,
  Settings as SettingsIcon,
  ClipboardList,
  Landmark,
  type LucideIcon,
} from 'lucide-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useNotificationsCtx } from '@/features/notifications/NotificationsProvider';
import type { Notification, NotificationType } from '@/features/notifications/useNotifications';
import { cn } from '@/lib/utils/cn';

const ICONS: Record<NotificationType, LucideIcon> = {
  budget_threshold: AlertTriangle,
  recurring_executed: Repeat,
  cc_payment_due: CreditCard,
  goal_reached: Target,
  large_transaction: TrendingUp,
  account_shared: UserPlus,
  import_ready: FileSpreadsheet,
  bank_sync_review: ClipboardList,
  bank_sync_consent: Landmark,
  system: Info,
};

/**
 * Destinazione al tap della notifica. Solo i tipi che hanno una pagina
 * dedicata: gli altri restano semplicemente "segna come letta".
 */
const TYPE_HREF: Partial<Record<NotificationType, '/bank-review' | '/settings'>> = {
  bank_sync_review: '/bank-review',
  bank_sync_consent: '/settings',
};

const TYPE_HUE: Record<NotificationType, string> = {
  budget_threshold: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
  recurring_executed: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40',
  cc_payment_due: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40',
  goal_reached: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
  large_transaction: 'text-violet-600 bg-violet-50 dark:bg-violet-950/40',
  account_shared: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40',
  import_ready: 'text-teal-600 bg-teal-50 dark:bg-teal-950/40',
  bank_sync_review: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40',
  bank_sync_consent: 'text-orange-600 bg-orange-50 dark:bg-orange-950/40',
  system: 'text-slate-600 bg-slate-100 dark:bg-slate-800',
};

export function NotificationBell() {
  const { items, unread, markRead, markAllRead, remove } = useNotificationsCtx();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-md',
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        aria-label="Notifiche"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            // Su mobile il pannello si aggancia al VIEWPORT, non alla campanella:
            // con `absolute right-0` il bordo destro segue il bottone (che non è
            // a filo schermo, dopo c'è l'aiuto) mentre `max-w` misura il
            // viewport — su 390px il pannello finiva a left:-28px, fuori a
            // sinistra. Da `sm` in su lo spazio abbonda e resta ancorato.
            'fixed inset-x-2 top-14 z-40 w-auto',
            'sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[380px] sm:max-w-[calc(100vw-2rem)]',
            'rounded-lg border bg-popover text-popover-foreground shadow-lg',
          )}
          role="dialog"
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">Notifiche</span>
              {unread > 0 && (
                <span className="text-xs text-muted-foreground">{unread} non lette</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => markAllRead()}
                disabled={unread === 0}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
                title="Segna tutte come lette"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Tutte lette
              </button>
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
                title="Preferenze notifiche"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="text-sm font-medium">Nessuna notifica</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Ti avviseremo quando succede qualcosa di importante.
                </div>
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    onRead={() => !n.readAt && markRead([n.id])}
                    onActivate={() => {
                      if (!n.readAt) void markRead([n.id]);
                      const to = TYPE_HREF[n.type];
                      if (!to) return;
                      // Chiudo il pannello prima di navigare: su mobile resterebbe
                      // aperto sopra la pagina di destinazione.
                      setOpen(false);
                      void navigate({ to });
                    }}
                    onDelete={() => remove(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  n,
  onRead,
  onActivate,
  onDelete,
}: {
  n: Notification;
  /** Segna come letta senza navigare (bottone "segna letta"). */
  onRead: () => void;
  /** Tap sulla riga: segna come letta e, se il tipo ha una pagina, ci porta. */
  onActivate: () => void;
  onDelete: () => void;
}) {
  const Icon = ICONS[n.type] ?? Info;
  const hue = TYPE_HUE[n.type] ?? TYPE_HUE.system;
  const navigable = !!TYPE_HREF[n.type];

  return (
    <li
      className={cn(
        'group relative flex gap-3 px-4 py-3 hover:bg-accent/50',
        !n.readAt && 'bg-blue-50/40 dark:bg-blue-950/20',
        navigable && 'cursor-pointer',
      )}
      onClick={onActivate}
    >
      <div className={cn('flex h-9 w-9 flex-none items-center justify-center rounded-full', hue)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium leading-tight">{n.title}</div>
          {!n.readAt && (
            <span
              aria-hidden
              className="mt-1.5 h-2 w-2 flex-none rounded-full bg-blue-500"
            />
          )}
        </div>
        {n.body && (
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {n.body}
          </div>
        )}
        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
          <time dateTime={n.createdAt}>{formatRelative(n.createdAt)}</time>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="invisible inline-flex items-center gap-1 hover:text-rose-600 group-hover:visible"
          >
            <Trash2 className="h-3 w-3" /> elimina
          </button>
          {!n.readAt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRead();
              }}
              className="invisible inline-flex items-center gap-1 hover:text-blue-600 group-hover:visible"
            >
              <Check className="h-3 w-3" /> segna letta
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}g fa`;
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}
