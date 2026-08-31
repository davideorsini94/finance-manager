import { createHash } from 'node:crypto';

/** Le due modalità della pagina Report che hanno un report LLM. */
export type LlmReportScope = 'annual' | 'monthly';

/**
 * Un job `generating` più vecchio di questa finestra è considerato morto: è il
 * caso del backend riavviato a metà generazione, che altrimenti lascerebbe
 * quella cella bloccata per sempre. La finestra è molto più larga del tetto di
 * una singola chiamata LLM (240s) per non riclaimare mai un job vivo ma lento.
 */
export const STALE_LOCK_MS = 15 * 60_000;

const MONTH_NAMES = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];

/** `2026` per l'annuale, `2026-07` per il mensile. */
export function buildPeriodKey(scope: LlmReportScope, year: number, month?: number): string {
  if (scope === 'annual') return String(year);
  if (!month) throw new Error('Il report mensile richiede il mese.');
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Chiave della selezione conti. L'elenco è ordinato e deduplicato prima
 * dell'hash: spuntare gli stessi conti in ordine diverso deve riusare lo stesso
 * report, non generarne un altro. `all` (nessun filtro) resta un valore
 * letterale, distinto dall'hash di una selezione che per caso li contiene tutti.
 */
export function buildAccountsKey(accountIds?: string[]): string {
  if (!accountIds || accountIds.length === 0) return 'all';
  const normalized = [...new Set(accountIds)].sort().join(',');
  return createHash('sha1').update(normalized).digest('hex');
}

/** Intervallo UTC inclusivo del periodo, stessa aritmetica di `ReportsController`. */
export function periodRange(
  scope: LlmReportScope,
  year: number,
  month?: number,
): { from: Date; to: Date } {
  if (scope === 'annual') {
    return { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31)) };
  }
  if (!month) throw new Error('Il report mensile richiede il mese.');
  // Il giorno 0 del mese successivo è l'ultimo del mese corrente: gestisce
  // anche i bisestili senza tabelle di giorni.
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)) };
}

/** Periodo precedente (anno-1 / mese-1), usato dal prompt per il confronto. */
export function previousPeriodRange(
  scope: LlmReportScope,
  year: number,
  month?: number,
): { from: Date; to: Date } {
  if (scope === 'annual') return periodRange('annual', year - 1);
  if (!month) throw new Error('Il report mensile richiede il mese.');
  return month === 1
    ? periodRange('monthly', year - 1, 12)
    : periodRange('monthly', year, month - 1);
}

/** Etichetta leggibile del periodo, per prompt e UI. */
export function periodLabel(scope: LlmReportScope, year: number, month?: number): string {
  if (scope === 'annual') return `anno ${year}`;
  if (!month) throw new Error('Il report mensile richiede il mese.');
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Impronta dei dati del periodo al momento della generazione: serve a dire
 * "questo report non è più aggiornato" senza rileggere tutte le transazioni.
 * Limite noto: una modifica che lascia totali e conteggio identici (per esempio
 * il cambio di categoria di un movimento) non viene rilevata.
 */
export function buildFingerprint(totals: {
  incomeCents: string;
  expenseCents: string;
  txCount: number;
}): string {
  return `${totals.txCount}:${totals.incomeCents}:${totals.expenseCents}`;
}

/** Un lock è scaduto se il job che lo ha preso è più vecchio di `STALE_LOCK_MS`. */
export function isStaleLock(startedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - startedAt.getTime() > STALE_LOCK_MS;
}
