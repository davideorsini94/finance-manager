import { NotificationChannel, NotificationType } from '@prisma/client';

export const NOTIFICATION_TYPES: NotificationType[] = [
  NotificationType.budget_threshold,
  NotificationType.recurring_executed,
  NotificationType.cc_payment_due,
  NotificationType.goal_reached,
  NotificationType.large_transaction,
  NotificationType.account_shared,
  NotificationType.import_ready,
  NotificationType.bank_sync_review,
  NotificationType.bank_sync_consent,
  NotificationType.system,
];

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  NotificationChannel.in_app,
  NotificationChannel.email,
];

/**
 * Default per ciascun (tipo × canale). Modificabile dall'utente da
 * Settings → Notifiche.
 */
export const DEFAULT_PREFS: Record<NotificationType, Record<NotificationChannel, boolean>> = {
  [NotificationType.budget_threshold]:    { in_app: true,  email: true  },
  [NotificationType.recurring_executed]:  { in_app: true,  email: false },
  [NotificationType.cc_payment_due]:      { in_app: true,  email: true  },
  [NotificationType.goal_reached]:        { in_app: true,  email: true  },
  [NotificationType.large_transaction]:   { in_app: true,  email: false },
  [NotificationType.account_shared]:      { in_app: true,  email: true  },
  [NotificationType.import_ready]:        { in_app: true,  email: false },
  // Sync bancario: eventi frequenti e "operativi", vanno in app ma non per
  // email (la coda di revisione si guarda quando si apre l'app).
  [NotificationType.bank_sync_review]:    { in_app: true,  email: false },
  [NotificationType.bank_sync_consent]:   { in_app: true,  email: false },
  [NotificationType.system]:              { in_app: true,  email: false },
};

/** Payload "data" tipizzato per tipo di evento (storato in Json) */
export type NotificationData =
  | { kind: 'budget_threshold'; budgetId: string; categoryId: string; categoryName: string; spentCents: string; limitCents: string; pct: number; month: string }
  | { kind: 'recurring_executed'; ruleId: string; transactionId: string; amountCents: string; description: string | null }
  | { kind: 'cc_payment_due'; chargeTransactionId: string; cardAccountId: string; cardName: string; amountCents: string; dueDate: string }
  | { kind: 'goal_reached'; goalId: string; goalName: string; targetCents: string }
  | { kind: 'large_transaction'; transactionId: string; amountCents: string; thresholdCents: string }
  | { kind: 'account_shared'; accountId: string; accountName: string; invitedBy: string; role: string }
  | { kind: 'import_ready'; batchId: string; rowCount: number }
  /** Nuovi movimenti bancari in coda di revisione (`count` = quelli di questo sync, `date` = YYYY-MM-DD). */
  | { kind: 'bank_sync_review'; count: number; date: string }
  /** Consenso PSD2 in scadenza (`expired: false`) o già scaduto (`expired: true`). */
  | { kind: 'bank_sync_consent'; connectionId: string; institutionName: string; expiresAt: string; expired: boolean }
  | { kind: 'system'; level?: 'info' | 'warning'; href?: string };

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: NotificationData | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationDto[];
  total: number;
  unread: number;
}

export type NotificationStreamEvent =
  | { event: 'created'; notification: NotificationDto }
  | { event: 'read'; ids: string[] }
  | { event: 'unread_count'; count: number };
