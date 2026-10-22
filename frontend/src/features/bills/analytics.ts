/**
 * Analisi delle bollette: funzioni pure, senza import, così le esegue sia
 * l'app sia `node --test` (vedi `frontend/tests/bills-analytics.test.mts`).
 *
 * Il problema di fondo: le bollette coprono periodi irregolari (bimestri,
 * trimestri, conguagli) che non coincidono con i mesi. Per confrontare mesi e
 * anni ogni bolletta viene **ripartita sui mesi in proporzione ai giorni**:
 * 60 kWh su un periodo dal 15 gennaio al 14 marzo diventano 17 + 28 + 14
 * giorni di consumo. Un mese senza nessuna bolletta resta vuoto (`null`), non
 * zero: zero direbbe "non ho consumato", vuoto dice "non lo so".
 *
 * Contano solo le bollette **confermate** dall'utente.
 */

export type UtilityKind = 'electricity' | 'gas' | 'water';
export type BillStatus = 'extracting' | 'review' | 'failed' | 'confirmed';

export interface BillLine {
  utility: UtilityKind;
  consumption: number | null;
  costCents: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  supplyCode: string | null;
  estimated: boolean;
}

export interface Bill {
  id: string;
  provider: string | null;
  billNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalCents: number | null;
  status: BillStatus;
  lines: BillLine[];
}

export const UTILITIES: UtilityKind[] = ['electricity', 'gas', 'water'];

const DAY_MS = 86_400_000;

/** Giorni dal 1970 di una data `YYYY-MM-DD` (UTC, niente fusi orari). */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function isoFromDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Mese successivo di `YYYY-MM`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Periodo effettivo di una riga: il suo se indicato, altrimenti quello della bolletta. */
export function linePeriod(bill: Bill, line: BillLine): { start: string; end: string } | null {
  const start = line.periodStart ?? bill.periodStart;
  const end = line.periodEnd ?? bill.periodEnd;
  if (!start || !end || start > end) return null;
  return { start, end };
}

/**
 * Giorni di un periodo (estremi inclusi) che cadono in ciascun mese.
 * 2026-01-15 → 2026-03-14 dà { '2026-01': 17, '2026-02': 28, '2026-03': 14 }.
 */
export function daysPerMonth(start: string, end: string): Map<string, number> {
  const out = new Map<string, number>();
  let cursor = dayNumber(start);
  const last = dayNumber(end);
  while (cursor <= last) {
    const iso = isoFromDay(cursor);
    const month = monthKey(iso);
    const monthEnd = dayNumber(`${month}-${String(daysInMonth(month)).padStart(2, '0')}`);
    const segmentEnd = Math.min(monthEnd, last);
    out.set(month, (out.get(month) ?? 0) + segmentEnd - cursor + 1);
    cursor = segmentEnd + 1;
  }
  return out;
}

export interface MonthPoint {
  month: string;
  /** `null` se nessuna bolletta del servizio copre il mese. */
  consumption: number | null;
  costCents: number | null;
  /** Giorni del mese coperti da almeno una bolletta (somma, può superare il mese se sovrapposte). */
  coveredDays: number;
  /** Giorni coperti da righe con il consumo / con il costo (per le medie giornaliere). */
  consumptionDays: number;
  costDays: number;
  /**
   * Costo e consumo delle sole righe che li hanno ENTRAMBI: servono al prezzo
   * unitario. Dividere tutto il costo per tutto il consumo gonfierebbe il
   * prezzo quando una bolletta ha solo il costo.
   */
  pricedCostCents: number;
  pricedConsumption: number;
  daysInMonth: number;
}

const confirmedLines = (bills: Bill[], utility: UtilityKind) =>
  bills
    .filter((b) => b.status === 'confirmed')
    .flatMap((b) => b.lines.filter((l) => l.utility === utility).map((l) => ({ bill: b, line: l })));

/**
 * Serie mensile di un servizio, dal primo all'ultimo mese coperto, senza buchi
 * nell'asse: i mesi non coperti ci sono, con valori `null`.
 */
export function monthlySeries(bills: Bill[], utility: UtilityKind): MonthPoint[] {
  type Acc = {
    consumption: number | null;
    costCents: number | null;
    covered: number;
    consumptionDays: number;
    costDays: number;
    pricedCost: number;
    pricedConsumption: number;
  };
  const acc = new Map<string, Acc>();
  for (const { bill, line } of confirmedLines(bills, utility)) {
    const period = linePeriod(bill, line);
    if (!period) continue;
    const perMonth = daysPerMonth(period.start, period.end);
    const total = dayNumber(period.end) - dayNumber(period.start) + 1;
    for (const [month, days] of perMonth) {
      const cur: Acc = acc.get(month) ?? {
        consumption: null,
        costCents: null,
        covered: 0,
        consumptionDays: 0,
        costDays: 0,
        pricedCost: 0,
        pricedConsumption: 0,
      };
      const share = days / total;
      if (line.consumption !== null) {
        cur.consumption = (cur.consumption ?? 0) + line.consumption * share;
        cur.consumptionDays += days;
      }
      if (line.costCents !== null) {
        cur.costCents = (cur.costCents ?? 0) + line.costCents * share;
        cur.costDays += days;
      }
      if (line.consumption !== null && line.costCents !== null) {
        cur.pricedConsumption += line.consumption * share;
        cur.pricedCost += line.costCents * share;
      }
      cur.covered += days;
      acc.set(month, cur);
    }
  }
  if (acc.size === 0) return [];
  const months = [...acc.keys()].sort();
  const out: MonthPoint[] = [];
  for (let m = months[0]; m <= months[months.length - 1]; m = nextMonth(m)) {
    const v = acc.get(m);
    out.push({
      month: m,
      consumption: v?.consumption ?? null,
      costCents: v?.costCents == null ? null : Math.round(v.costCents),
      coveredDays: v?.covered ?? 0,
      consumptionDays: v?.consumptionDays ?? 0,
      costDays: v?.costDays ?? 0,
      pricedCostCents: v?.pricedCost ?? 0,
      pricedConsumption: v?.pricedConsumption ?? 0,
      daysInMonth: daysInMonth(m),
    });
  }
  return out;
}

export interface YearTotal {
  year: number;
  consumption: number | null;
  costCents: number | null;
  /** Prezzo medio per unità in centesimi (costo / consumo), se entrambi noti. */
  unitPriceCents: number | null;
  /** Mesi dell'anno con almeno un giorno coperto. */
  monthsCovered: number;
}

export function yearlyTotals(bills: Bill[], utility: UtilityKind): YearTotal[] {
  const byYear = new Map<number, YearTotal & { pricedCost: number; pricedConsumption: number }>();
  for (const p of monthlySeries(bills, utility)) {
    const year = Number(p.month.slice(0, 4));
    const t = byYear.get(year) ?? {
      year,
      consumption: null,
      costCents: null,
      unitPriceCents: null,
      monthsCovered: 0,
      pricedCost: 0,
      pricedConsumption: 0,
    };
    if (p.consumption !== null) t.consumption = (t.consumption ?? 0) + p.consumption;
    if (p.costCents !== null) t.costCents = (t.costCents ?? 0) + p.costCents;
    t.pricedCost += p.pricedCostCents;
    t.pricedConsumption += p.pricedConsumption;
    if (p.coveredDays > 0) t.monthsCovered += 1;
    byYear.set(year, t);
  }
  return [...byYear.values()]
    .map(({ pricedCost, pricedConsumption, ...t }) => ({
      ...t,
      unitPriceCents: pricedConsumption > 0 ? pricedCost / pricedConsumption : null,
    }))
    .sort((a, b) => a.year - b.year);
}

export interface UnitPricePoint {
  billId: string;
  /** Fine del periodo: la data su cui si colloca il punto. */
  date: string;
  provider: string | null;
  /** Centesimi per unità (€/kWh × 100). */
  unitPriceCents: number;
  estimated: boolean;
}

/** Prezzo unitario di ogni bolletta (costo / consumo), in ordine di tempo. */
export function unitPrices(bills: Bill[], utility: UtilityKind): UnitPricePoint[] {
  return confirmedLines(bills, utility)
    .flatMap(({ bill, line }) => {
      const period = linePeriod(bill, line);
      if (!period || !line.consumption || line.consumption <= 0 || line.costCents === null) return [];
      return [
        {
          billId: bill.id,
          date: period.end,
          provider: bill.provider,
          unitPriceCents: line.costCents / line.consumption,
          estimated: line.estimated,
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface ProviderSpan {
  provider: string;
  from: string;
  to: string;
  bills: number;
}

/** Fornitori in ordine di tempo, raggruppando le bollette consecutive dello stesso. */
export function providerHistory(bills: Bill[], utility: UtilityKind): ProviderSpan[] {
  const items = confirmedLines(bills, utility)
    .map(({ bill, line }) => ({ bill, period: linePeriod(bill, line) }))
    .filter((x): x is { bill: Bill; period: { start: string; end: string } } => !!x.period)
    .sort((a, b) => a.period.start.localeCompare(b.period.start));
  const spans: ProviderSpan[] = [];
  for (const { bill, period } of items) {
    const name = bill.provider?.trim() || 'Fornitore non indicato';
    const last = spans[spans.length - 1];
    if (last && normalizeName(last.provider) === normalizeName(name)) {
      if (period.end > last.to) last.to = period.end;
      last.bills += 1;
    } else {
      spans.push({ provider: name, from: period.start, to: period.end, bills: 1 });
    }
  }
  return spans;
}

const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Coppie di bollette dello stesso servizio con periodi sovrapposti: tipico di
 * un conguaglio o di una bolletta caricata due volte. Nei grafici i loro
 * consumi si sommano, quindi la UI lo segnala.
 */
export function overlappingBills(bills: Bill[], utility: UtilityKind): Array<[string, string]> {
  const items = confirmedLines(bills, utility)
    .map(({ bill, line }) => ({ id: bill.id, period: linePeriod(bill, line) }))
    .filter((x): x is { id: string; period: { start: string; end: string } } => !!x.period)
    .sort((a, b) => a.period.start.localeCompare(b.period.start));
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length && items[j].period.start <= items[i].period.end; j++) {
      pairs.push([items[i].id, items[j].id]);
    }
  }
  return pairs;
}

/**
 * Possibili doppioni tra tutte le bollette (anche non confermate): stesso
 * fornitore e numero, oppure stesso periodo e stesso totale.
 */
export function possibleDuplicates(bills: Bill[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < bills.length; i++) {
    for (let j = i + 1; j < bills.length; j++) {
      const a = bills[i];
      const b = bills[j];
      const sameNumber =
        !!a.billNumber &&
        !!b.billNumber &&
        normalizeName(a.billNumber) === normalizeName(b.billNumber) &&
        normalizeName(a.provider ?? '') === normalizeName(b.provider ?? '');
      const samePeriodAndTotal =
        !!a.periodStart &&
        a.periodStart === b.periodStart &&
        a.periodEnd === b.periodEnd &&
        a.totalCents !== null &&
        a.totalCents === b.totalCents;
      if (sameNumber || samePeriodAndTotal) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

export interface UtilitySummary {
  utility: UtilityKind;
  /**
   * Finestra dei "12 mesi": finisce all'ultimo mese COMPLETAMENTE coperto
   * (non a oggi, e non a un mese coperto a metà, che falserebbe il confronto).
   */
  windowFrom: string | null;
  lastMonth: string | null;
  last12CostCents: number | null;
  last12Consumption: number | null;
  /** Variazione rispetto ai 12 mesi prima, solo se entrambe le finestre sono quasi complete. */
  costDeltaPct: number | null;
  consumptionDeltaPct: number | null;
  /** Prezzo medio per unità negli ultimi 12 mesi, in centesimi. */
  unitPriceCents: number | null;
  /** Costo e consumo medi al giorno nella finestra (solo giorni coperti da quel dato). */
  dailyCostCents: number | null;
  dailyConsumption: number | null;
  currentProvider: string | null;
  billCount: number;
  /** Mesi della finestra (per la sparkline), vecchio → recente. */
  spark: Array<number | null>;
}

/** Una finestra conta per il confronto se è coperta almeno all'85%. */
const COMPARABLE_COVERAGE = 0.85;

/** Indice dell'ultimo mese coperto per intero; se nessuno lo è, l'ultimo mese. */
function lastCompleteIndex(series: MonthPoint[]): number {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].coveredDays >= series[i].daysInMonth) return i;
  }
  return series.length - 1;
}

export function utilitySummary(bills: Bill[], utility: UtilityKind): UtilitySummary {
  const series = monthlySeries(bills, utility);
  const billCount = new Set(confirmedLines(bills, utility).map((x) => x.bill.id)).size;
  const history = providerHistory(bills, utility);
  const empty: UtilitySummary = {
    utility,
    windowFrom: null,
    lastMonth: null,
    last12CostCents: null,
    last12Consumption: null,
    costDeltaPct: null,
    consumptionDeltaPct: null,
    unitPriceCents: null,
    dailyCostCents: null,
    dailyConsumption: null,
    currentProvider: history[history.length - 1]?.provider ?? null,
    billCount,
    spark: [],
  };
  if (series.length === 0) return empty;

  const window = (endIndex: number) => series.slice(Math.max(0, endIndex - 11), endIndex + 1);
  const sum = (pts: MonthPoint[], key: 'consumption' | 'costCents') =>
    pts.some((p) => p[key] !== null) ? pts.reduce((s, p) => s + (p[key] ?? 0), 0) : null;
  const total = (pts: MonthPoint[], key: 'consumptionDays' | 'costDays' | 'pricedCostCents' | 'pricedConsumption') =>
    pts.reduce((s, p) => s + p[key], 0);
  const coverage = (pts: MonthPoint[]) =>
    pts.length < 12
      ? 0
      : pts.reduce((s, p) => s + Math.min(p.coveredDays, p.daysInMonth), 0) / pts.reduce((s, p) => s + p.daysInMonth, 0);
  const pct = (cur: number | null, prev: number | null) =>
    cur === null || prev === null || prev === 0 ? null : ((cur - prev) / prev) * 100;

  const endIndex = lastCompleteIndex(series);
  const last12 = window(endIndex);
  const prev12 = endIndex >= 12 ? window(endIndex - 12) : [];
  const comparable = coverage(last12) >= COMPARABLE_COVERAGE && coverage(prev12) >= COMPARABLE_COVERAGE;

  const cost = sum(last12, 'costCents');
  const consumption = sum(last12, 'consumption');
  const costDays = total(last12, 'costDays');
  const consumptionDays = total(last12, 'consumptionDays');
  const pricedConsumption = total(last12, 'pricedConsumption');

  return {
    ...empty,
    windowFrom: last12[0].month,
    lastMonth: series[endIndex].month,
    last12CostCents: cost === null ? null : Math.round(cost),
    last12Consumption: consumption,
    costDeltaPct: comparable ? pct(cost, sum(prev12, 'costCents')) : null,
    consumptionDeltaPct: comparable ? pct(consumption, sum(prev12, 'consumption')) : null,
    unitPriceCents: pricedConsumption > 0 ? total(last12, 'pricedCostCents') / pricedConsumption : null,
    dailyCostCents: cost !== null && costDays > 0 ? cost / costDays : null,
    dailyConsumption: consumption !== null && consumptionDays > 0 ? consumption / consumptionDays : null,
    spark: last12.map((p) => (p.costCents === null ? null : p.costCents / 100)),
  };
}

/**
 * Spesa complessiva degli ultimi 12 mesi su una finestra COMUNE a tutti i
 * servizi (che finisce all'ultimo mese completo tra tutti): sommare finestre
 * diverse per servizio mescolerebbe anni diversi.
 */
export function combinedLast12(bills: Bill[]): { from: string; to: string; costCents: number } | null {
  const all = UTILITIES.map((u) => monthlySeries(bills, u)).filter((s) => s.length > 0);
  if (all.length === 0) return null;
  const ends = all.map((s) => s[lastCompleteIndex(s)].month).sort();
  const to = ends[ends.length - 1];
  let from = to;
  for (let i = 0; i < 11; i++) from = prevMonth(from);
  let cost = 0;
  for (const s of all) for (const p of s) if (p.month >= from && p.month <= to && p.costCents !== null) cost += p.costCents;
  return { from, to, costCents: Math.round(cost) };
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export interface YoYPoint {
  /** 1..12 */
  month: number;
  current: number | null;
  previous: number | null;
}

/**
 * Anno su anno: l'anno dell'ultimo mese coperto contro quello prima, mese per
 * mese, per consumo o costo (in euro).
 */
export function yearOverYear(
  bills: Bill[],
  utility: UtilityKind,
  metric: 'consumption' | 'cost',
): { year: number | null; points: YoYPoint[] } {
  const series = monthlySeries(bills, utility);
  if (series.length === 0) return { year: null, points: [] };
  const year = Number(series[series.length - 1].month.slice(0, 4));
  const value = (p: MonthPoint | undefined) =>
    !p ? null : metric === 'consumption' ? p.consumption : p.costCents === null ? null : p.costCents / 100;
  const byMonth = new Map(series.map((p) => [p.month, p]));
  const points: YoYPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    points.push({
      month: m,
      current: value(byMonth.get(`${year}-${mm}`)),
      previous: value(byMonth.get(`${year - 1}-${mm}`)),
    });
  }
  return { year, points };
}
