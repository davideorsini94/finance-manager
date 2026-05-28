import type { NotificationData } from '../../notifications/notifications.types';

/**
 * Render HTML coerente con le email d'invito esistenti (stesso stile inline).
 * Lasciato semplice: niente engine di template, una funzione pura.
 */
export function renderNotificationEmail(input: {
  title: string;
  body: string;
  data?: NotificationData | null;
}): string {
  const { title, body, data } = input;
  const ctaHref = extractHref(data ?? null);
  const cta = ctaHref
    ? `<p><a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Apri Finance Manager</a></p>`
    : '';

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;color:#0f172a">
      <div style="background:#3b82f6;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
        <div style="font-size:12px;opacity:0.85;letter-spacing:0.04em;text-transform:uppercase">Finance Manager</div>
        <div style="font-size:18px;font-weight:600;margin-top:4px">${escapeHtml(title)}</div>
      </div>
      <div style="background:#f8fafc;padding:20px 22px;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none">
        ${body ? `<p style="margin:0 0 14px 0;line-height:1.5">${escapeHtml(body)}</p>` : ''}
        ${cta}
        <p style="margin:20px 0 0 0;color:#64748b;font-size:11px">
          Stai ricevendo questa email perché hai abilitato le notifiche email per questo evento.
          Puoi disattivarle dalle impostazioni dell'app.
        </p>
      </div>
    </div>
  `;
}

function extractHref(data: NotificationData | null): string | null {
  if (!data) return null;
  const base = process.env.APP_PUBLIC_URL ?? '';
  switch (data.kind) {
    case 'budget_threshold':
      return base ? `${base}/budget` : null;
    case 'recurring_executed':
      return base ? `${base}/transactions` : null;
    case 'cc_payment_due':
      return base ? `${base}/accounts` : null;
    case 'goal_reached':
      return base ? `${base}/goals` : null;
    case 'large_transaction':
      return base ? `${base}/transactions` : null;
    case 'account_shared':
      return base ? `${base}/accounts` : null;
    case 'import_ready':
      return base ? `${base}/import` : null;
    case 'system':
      return data.href ?? null;
    default:
      return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
