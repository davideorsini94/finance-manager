import type { CategoryNode, PeriodTotals } from '../reports/reports.service';
import type {
  AccountOverview,
  RecurringItem,
  ToVerifyItem,
  TransferItem,
} from '../reports/report-context.service';
import type { LlmReportScope } from './llm-report.keys';

/** Un movimento "grosso" del periodo, materiale per la sezione anomalie. */
export interface TopExpense {
  date: string;
  description: string | null;
  amountCents: string;
  categoryName: string | null;
}

/**
 * Tutto ciò che il modello vede del periodo. Solo aggregati più una manciata di
 * movimenti: passare tutte le transazioni costerebbe token e allargherebbe
 * inutilmente la superficie privacy.
 */
export interface ReportSnapshot {
  scope: LlmReportScope;
  label: string;
  previousLabel: string;
  accountsLabel: string;
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  series: { label: string; incomeCents: string; expenseCents: string }[];
  expenseTree: CategoryNode[];
  incomeTree: CategoryNode[];
  topExpenses: TopExpense[];
  previousExpenseTree: CategoryNode[];
  accounts: AccountOverview[];
  transfers: TransferItem[];
  toVerify: { items: ToVerifyItem[]; total: number };
  recurring: RecurringItem[];
}

/** Quante categorie di primo livello passare per verso. Oltre è rumore. */
const MAX_CATEGORIES = 12;
/** Quante sottocategorie per categoria padre. */
const MAX_CHILDREN = 5;

/**
 * Centesimi (stringa, perché a DB sono BigInt) → euro. In valore assoluto: il
 * segno lo dà già il contesto ("uscite"), e un "-1800.00 €" sotto la voce
 * uscite confonde il modello quanto l'utente.
 */
export function formatEuro(cents: string): string {
  const value = BigInt(cents);
  const abs = value < 0n ? -value : value;
  const units = abs / 100n;
  const decimals = abs % 100n;
  return `${units}.${String(decimals).padStart(2, '0')} €`;
}

/** Come `formatEuro` ma col segno: per i saldi, che possono essere negativi. */
function formatSignedEuro(cents: string): string {
  return `${BigInt(cents) < 0n ? '-' : ''}${formatEuro(cents)}`;
}

const FREQUENCY_LABEL: Record<string, string> = {
  daily: 'giornaliera',
  weekly: 'settimanale',
  biweekly: 'ogni 2 settimane',
  monthly: 'mensile',
  quarterly: 'trimestrale',
  yearly: 'annuale',
};

function formatAccounts(accounts: AccountOverview[]): string {
  if (accounts.length === 0) return '  (nessun conto)';
  return accounts
    .map((a) => {
      const shared = a.holders > 1 ? `, cointestato con ${a.holders} intestatari` : '';
      return (
        `  - ${a.name} (${a.type}${shared}): saldo iniziale ${formatSignedEuro(a.openingBalanceCents)}, ` +
        `entrate ${formatEuro(a.incomeCents)}, uscite ${formatEuro(a.expenseCents)}, ` +
        `giroconti in entrata ${formatEuro(a.transfersInCents)}, in uscita ${formatEuro(a.transfersOutCents)}, ` +
        `saldo finale ${formatSignedEuro(a.closingBalanceCents)}, ${a.txCount} movimenti ` +
        `(saldo attuale ${formatSignedEuro(a.currentBalanceCents)})`
      );
    })
    .join('\n');
}

function formatTransfers(items: TransferItem[]): string {
  if (items.length === 0) return '  (nessun giroconto tra conti)';
  return items
    .map(
      (t) =>
        `  - ${t.date} · ${t.fromAccount} → ${t.toAccount} · ${formatEuro(t.amountCents)}` +
        `${t.unmatched ? ' (categoria Giroconto, altra gamba non abbinata)' : ''}`,
    )
    .join('\n');
}

function formatToVerify(v: { items: ToVerifyItem[]; total: number }): string {
  if (v.total === 0) return '  (nessun movimento senza categoria)';
  const lines = v.items.map(
    (t) =>
      `  - ${t.date} · ${t.accountName} · ${t.description?.trim() || '(senza descrizione)'} · ${formatSignedEuro(t.amountCents)}`,
  );
  if (v.total > v.items.length) lines.push(`  (… e altri ${v.total - v.items.length})`);
  return lines.join('\n');
}

function formatRecurring(items: RecurringItem[]): string {
  if (items.length === 0) return '  (nessuna regola ricorrente attiva)';
  return items
    .map((r) => {
      const where =
        r.type === 'transfer' && r.toAccountName
          ? `${r.accountName} → ${r.toAccountName}`
          : r.accountName;
      const cat = r.categoryName ? ` · ${r.categoryName}` : '';
      return `  - ${r.description?.trim() || '(senza descrizione)'} · ${formatEuro(r.amountCents)} · ${FREQUENCY_LABEL[r.frequency] ?? r.frequency} · ${where}${cat}`;
    })
    .join('\n');
}

function formatTotals(totals: PeriodTotals): string {
  return [
    `entrate ${formatEuro(totals.incomeCents)}`,
    `uscite ${formatEuro(totals.expenseCents)}`,
    `saldo ${BigInt(totals.netCents) < 0n ? '-' : '+'}${formatEuro(totals.netCents)}`,
    `${totals.txCount} movimenti`,
  ].join(', ');
}

function formatTree(nodes: CategoryNode[]): string {
  if (nodes.length === 0) return '(nessun dato)';
  return nodes
    .slice(0, MAX_CATEGORIES)
    .map((node) => {
      const children = node.children
        .slice(0, MAX_CHILDREN)
        .map(
          (child) => `    - ${child.categoryName}: ${formatEuro(child.amountCents)} (${child.count})`,
        )
        .join('\n');
      const head = `  - ${node.categoryName}: ${formatEuro(node.amountCents)} (${node.count} mov.)`;
      return children ? `${head}\n${children}` : head;
    })
    .join('\n');
}

/**
 * Apertura predefinita: dice al modello chi è e che taglio dare al report.
 * È la parte che l'admin può sostituire dalle impostazioni.
 */
const DEFAULT_BASE_PROMPT = `Sei l'assistente finanziario di un'app di contabilità famigliare. Scrivi un report chiaro e concreto sul periodo indicato, rivolgendoti direttamente all'utente ("hai speso…").
Organizzalo in sezioni di secondo livello: "## Sintesi", "## Andamento", "## Dove sono finiti i soldi", "## Cosa mi ha colpito", "## Consigli". In "Consigli" stai su un massimo di 3 punti, concreti e legati a numeri di questo periodo — niente consigli generici da manuale. Confronta col periodo precedente quando è significativo (variazioni sotto il 5% non meritano una riga). Massimo 450 parole in tutto.`;

/**
 * Prompt del report. Il modello riceve SOLO aggregati e nomi di categoria — mai
 * gli id interni, che non gli servono e che finirebbero nel testo mostrato.
 *
 * `customBase` (impostazioni → Modello AI) sostituisce l'**apertura**: è lì che
 * si decide taglio, tono e struttura dell'analisi. I dati del periodo e le
 * regole finali restano sempre, perché sono ciò che rende il testo vero
 * (niente cifre inventate) e mostrabile (markdown senza link né immagini): un
 * prompt che le potesse spegnere renderebbe il report inaffidabile.
 */
export function buildReportPrompt(s: ReportSnapshot, customBase?: string): string {
  const seriesLabel = s.scope === 'annual' ? 'Andamento per mese' : 'Andamento per giorno';
  const series = s.series
    .map(
      (p) =>
        `  - ${p.label}: entrate ${formatEuro(p.incomeCents)}, uscite ${formatEuro(p.expenseCents)}`,
    )
    .join('\n');
  const top = s.topExpenses
    .map(
      (t) =>
        `  - ${t.date} · ${t.description?.trim() || '(senza descrizione)'} · ${formatEuro(t.amountCents)}` +
        `${t.categoryName ? ` · ${t.categoryName}` : ''}`,
    )
    .join('\n');

  const base = customBase?.trim() || DEFAULT_BASE_PROMPT;

  return `${base}

DATI DEL PERIODO — ${s.label} (${s.accountsLabel})
Totali: ${formatTotals(s.totals)}
Periodo precedente (${s.previousLabel}): ${formatTotals(s.previousTotals)}

${seriesLabel}:
${series || '  (nessun dato)'}

Conti (saldo finale = saldo attuale meno i movimenti successivi al periodo; saldo iniziale = finale meno i movimenti del periodo):
${formatAccounts(s.accounts)}

Uscite per categoria:
${formatTree(s.expenseTree)}

Uscite per categoria nel periodo precedente (${s.previousLabel}):
${formatTree(s.previousExpenseTree)}

Entrate per categoria:
${formatTree(s.incomeTree)}

Movimenti di uscita più grandi:
${top || '  (nessun movimento)'}

Giroconti tra i conti (non sono entrate né uscite e sono già esclusi da totali, categorie, andamento e movimenti più grandi; nei conti sono i giroconti in entrata/uscita):
${formatTransfers(s.transfers)}

Movimenti senza categoria (da verificare, ${s.toVerify.total} in totale):
${formatToVerify(s.toVerify)}

Regole ricorrenti attive:
${formatRecurring(s.recurring)}

REGOLE
- Rispondi in italiano, in **markdown**.
- Usa solo i dati qui sopra: non inventare cifre, categorie o movimenti che non compaiono. Se un dato non c'è, dillo.
- Cita gli importi in euro come sono scritti sopra.
- I giroconti non sono entrate né uscite: non sommarli mai a entrate, uscite o categorie.
- Niente titolo di primo livello, nessun link, nessuna immagine, nessun blocco di codice.`;
}
