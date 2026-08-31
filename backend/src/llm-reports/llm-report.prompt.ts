import type { CategoryNode, PeriodTotals } from '../reports/reports.service';
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
 * Prompt del report. Il modello riceve SOLO aggregati e nomi di categoria — mai
 * gli id interni, che non gli servono e che finirebbero nel testo mostrato.
 */
export function buildReportPrompt(s: ReportSnapshot): string {
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

  return `Sei l'assistente finanziario di un'app di contabilità famigliare. Scrivi un report chiaro e concreto sul periodo indicato, rivolgendoti direttamente all'utente ("hai speso…").

DATI DEL PERIODO — ${s.label} (${s.accountsLabel})
Totali: ${formatTotals(s.totals)}
Periodo precedente (${s.previousLabel}): ${formatTotals(s.previousTotals)}

${seriesLabel}:
${series || '  (nessun dato)'}

Uscite per categoria:
${formatTree(s.expenseTree)}

Entrate per categoria:
${formatTree(s.incomeTree)}

Movimenti di uscita più grandi:
${top || '  (nessun movimento)'}

ISTRUZIONI
- Rispondi in italiano, in **markdown**, con esattamente queste sezioni di secondo livello: "## Sintesi", "## Andamento", "## Dove sono finiti i soldi", "## Cosa mi ha colpito", "## Consigli".
- Usa solo i dati qui sopra: non inventare cifre, categorie o movimenti che non compaiono. Se un dato non c'è, dillo.
- Cita gli importi in euro come sono scritti sopra.
- Confronta col periodo precedente quando è significativo (variazioni sotto il 5% non meritano una riga).
- "Consigli": al massimo 3, concreti e legati a numeri di questo periodo. Niente consigli generici da manuale.
- Massimo 450 parole in tutto. Niente titolo di primo livello, nessun link, nessuna immagine, nessun blocco di codice.`;
}
