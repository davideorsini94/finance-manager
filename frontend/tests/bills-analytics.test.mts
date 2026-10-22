// Test delle analisi delle bollette. Node 24 esegue TypeScript da solo:
//   npm test   (= node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysPerMonth,
  monthlySeries,
  yearlyTotals,
  unitPrices,
  providerHistory,
  overlappingBills,
  possibleDuplicates,
  utilitySummary,
  yearOverYear,
  type Bill,
  type BillLine,
} from '../src/features/bills/analytics.ts';

let n = 0;
function bill(p: Partial<Bill> & { lines: Partial<BillLine>[] }): Bill {
  n += 1;
  return {
    id: p.id ?? `b${n}`,
    provider: p.provider ?? 'Enel',
    billNumber: p.billNumber ?? null,
    issueDate: null,
    dueDate: null,
    periodStart: p.periodStart ?? null,
    periodEnd: p.periodEnd ?? null,
    totalCents: p.totalCents ?? null,
    status: p.status ?? 'confirmed',
    lines: p.lines.map((l) => ({
      utility: l.utility ?? 'electricity',
      consumption: l.consumption ?? null,
      costCents: l.costCents ?? null,
      periodStart: l.periodStart ?? null,
      periodEnd: l.periodEnd ?? null,
      supplyCode: null,
      estimated: l.estimated ?? false,
    })),
  };
}

test('daysPerMonth divide un periodo sui mesi, estremi inclusi', () => {
  assert.deepEqual(Object.fromEntries(daysPerMonth('2026-01-15', '2026-03-14')), {
    '2026-01': 17,
    '2026-02': 28,
    '2026-03': 14,
  });
  assert.deepEqual(Object.fromEntries(daysPerMonth('2024-02-01', '2024-02-29')), { '2024-02': 29 });
  assert.deepEqual(Object.fromEntries(daysPerMonth('2025-12-20', '2026-01-10')), { '2025-12': 12, '2026-01': 10 });
  assert.deepEqual(Object.fromEntries(daysPerMonth('2026-05-05', '2026-05-05')), { '2026-05': 1 });
});

test('monthlySeries ripartisce consumo e costo in proporzione ai giorni', () => {
  const s = monthlySeries(
    [bill({ periodStart: '2026-01-01', periodEnd: '2026-02-28', lines: [{ consumption: 590, costCents: 11800 }] })],
    'electricity',
  );
  assert.equal(s.length, 2);
  assert.equal(s[0].month, '2026-01');
  assert.ok(Math.abs((s[0].consumption ?? 0) - 310) < 1e-9); // 31/59
  assert.ok(Math.abs((s[1].consumption ?? 0) - 280) < 1e-9); // 28/59
  assert.equal(s[0].costCents! + s[1].costCents!, 11800);
});

test('i mesi senza bollette restano null, non zero', () => {
  const s = monthlySeries(
    [
      bill({ periodStart: '2026-01-01', periodEnd: '2026-01-31', lines: [{ consumption: 100 }] }),
      bill({ periodStart: '2026-04-01', periodEnd: '2026-04-30', lines: [{ consumption: 80 }] }),
    ],
    'electricity',
  );
  assert.deepEqual(s.map((p) => p.month), ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.equal(s[1].consumption, null);
  assert.equal(s[1].coveredDays, 0);
});

test('contano solo le bollette confermate e solo il servizio richiesto', () => {
  const bills = [
    bill({ periodStart: '2026-01-01', periodEnd: '2026-01-31', status: 'review', lines: [{ consumption: 999 }] }),
    bill({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      lines: [
        { utility: 'electricity', consumption: 100 },
        { utility: 'gas', consumption: 40 },
      ],
    }),
  ];
  assert.equal(monthlySeries(bills, 'electricity')[0].consumption, 100);
  assert.equal(monthlySeries(bills, 'gas')[0].consumption, 40);
  assert.deepEqual(monthlySeries(bills, 'water'), []);
});

test('il periodo della riga vince su quello della bolletta (dual fuel con letture diverse)', () => {
  const b = bill({
    periodStart: '2026-01-01',
    periodEnd: '2026-02-28',
    lines: [
      { utility: 'electricity', consumption: 59 },
      { utility: 'gas', consumption: 31, periodStart: '2025-12-01', periodEnd: '2025-12-31' },
    ],
  });
  assert.deepEqual(monthlySeries([b], 'gas').map((p) => p.month), ['2025-12']);
  assert.deepEqual(monthlySeries([b], 'electricity').map((p) => p.month), ['2026-01', '2026-02']);
});

test('una bolletta senza periodo non entra nei grafici', () => {
  assert.deepEqual(monthlySeries([bill({ lines: [{ consumption: 10 }] })], 'electricity'), []);
});

test('yearlyTotals somma per anno e calcola il prezzo medio', () => {
  const y = yearlyTotals(
    [
      bill({ periodStart: '2025-12-01', periodEnd: '2026-01-31', lines: [{ consumption: 62, costCents: 6200 }] }),
    ],
    'electricity',
  );
  assert.deepEqual(y.map((t) => t.year), [2025, 2026]);
  assert.ok(Math.abs(y[0].consumption! - 31) < 1e-9);
  assert.ok(Math.abs(y[1].unitPriceCents! - 100) < 1e-6);
});

test('unitPrices: costo / consumo per bolletta, esclude consumi nulli', () => {
  const p = unitPrices(
    [
      bill({ periodStart: '2026-03-01', periodEnd: '2026-04-30', lines: [{ consumption: 200, costCents: 5000 }] }),
      bill({ periodStart: '2026-01-01', periodEnd: '2026-02-28', lines: [{ consumption: 100, costCents: 3000 }] }),
      bill({ periodStart: '2026-05-01', periodEnd: '2026-06-30', lines: [{ consumption: 0, costCents: 900 }] }),
    ],
    'electricity',
  );
  assert.deepEqual(p.map((x) => x.unitPriceCents), [30, 25]);
});

test('providerHistory raggruppa le bollette consecutive dello stesso fornitore', () => {
  const h = providerHistory(
    [
      bill({ provider: 'Edison', periodStart: '2025-01-01', periodEnd: '2025-02-28', lines: [{}] }),
      bill({ provider: 'EDISON ', periodStart: '2025-03-01', periodEnd: '2025-04-30', lines: [{}] }),
      bill({ provider: 'Enel Energia', periodStart: '2025-05-01', periodEnd: '2025-06-30', lines: [{}] }),
    ],
    'electricity',
  );
  assert.equal(h.length, 2);
  assert.deepEqual([h[0].from, h[0].to, h[0].bills], ['2025-01-01', '2025-04-30', 2]);
  assert.equal(h[1].provider, 'Enel Energia');
});

test('overlappingBills trova i periodi sovrapposti dello stesso servizio', () => {
  const pairs = overlappingBills(
    [
      bill({ id: 'a', periodStart: '2026-01-01', periodEnd: '2026-02-28', lines: [{}] }),
      bill({ id: 'b', periodStart: '2026-02-15', periodEnd: '2026-03-31', lines: [{}] }),
      bill({ id: 'c', periodStart: '2026-04-01', periodEnd: '2026-05-31', lines: [{}] }),
    ],
    'electricity',
  );
  assert.deepEqual(pairs, [['a', 'b']]);
});

test('possibleDuplicates: stesso numero e fornitore, o stesso periodo e totale', () => {
  const d = possibleDuplicates([
    bill({ id: 'x1', billNumber: 'F-1', provider: 'Acea', lines: [] }),
    bill({ id: 'x2', billNumber: 'f1', provider: 'ACEA', lines: [] }),
    bill({ id: 'y1', periodStart: '2026-01-01', periodEnd: '2026-01-31', totalCents: 4000, lines: [] }),
    bill({ id: 'y2', periodStart: '2026-01-01', periodEnd: '2026-01-31', totalCents: 4000, lines: [] }),
    bill({ id: 'z', periodStart: '2026-01-01', periodEnd: '2026-01-31', totalCents: 4100, lines: [] }),
  ]);
  assert.deepEqual([...d].sort(), ['x1', 'x2', 'y1', 'y2']);
});

function monthlyBills(fromYear: number, months: number, kwh: number, cents: number): Bill[] {
  const out: Bill[] = [];
  for (let i = 0; i < months; i++) {
    const y = fromYear + Math.floor(i / 12);
    const m = (i % 12) + 1;
    const mm = String(m).padStart(2, '0');
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push(bill({ periodStart: `${y}-${mm}-01`, periodEnd: `${y}-${mm}-${last}`, lines: [{ consumption: kwh, costCents: cents }] }));
  }
  return out;
}

test('utilitySummary confronta gli ultimi 12 mesi con i 12 prima', () => {
  const bills = [...monthlyBills(2024, 12, 100, 2000), ...monthlyBills(2025, 12, 110, 2500)];
  const s = utilitySummary(bills, 'electricity');
  assert.equal(s.lastMonth, '2025-12');
  assert.equal(s.last12CostCents, 30000);
  assert.ok(Math.abs(s.last12Consumption! - 1320) < 1e-6);
  assert.ok(Math.abs(s.costDeltaPct! - 25) < 1e-9);
  assert.ok(Math.abs(s.consumptionDeltaPct! - 10) < 1e-9);
  assert.equal(s.spark.length, 12);
  assert.equal(s.billCount, 24);
});

test('utilitySummary non calcola variazioni se lo storico precedente è incompleto', () => {
  const bills = [...monthlyBills(2024, 6, 100, 2000).slice(3), ...monthlyBills(2025, 12, 110, 2500)];
  const s = utilitySummary(bills, 'electricity');
  assert.equal(s.costDeltaPct, null);
  assert.equal(s.consumptionDeltaPct, null);
  assert.equal(s.last12CostCents, 30000);
});

test('utilitySummary su un servizio senza bollette', () => {
  const s = utilitySummary([], 'water');
  assert.equal(s.lastMonth, null);
  assert.equal(s.last12CostCents, null);
  assert.deepEqual(s.spark, []);
});

test('yearOverYear mette a confronto l’ultimo anno con il precedente', () => {
  const bills = [...monthlyBills(2024, 12, 100, 2000), ...monthlyBills(2025, 3, 120, 2600)];
  const r = yearOverYear(bills, 'electricity', 'consumption');
  assert.equal(r.year, 2025);
  assert.equal(r.points.length, 12);
  assert.ok(Math.abs(r.points[0].current! - 120) < 1e-9);
  assert.ok(Math.abs(r.points[0].previous! - 100) < 1e-9);
  assert.equal(r.points[5].current, null);
  const c = yearOverYear(bills, 'electricity', 'cost');
  assert.equal(c.points[0].current, 26);
});

test('la variazione non è falsata se l’ultima bolletta finisce a metà mese', () => {
  // Bimestrali a consumo costante (1 kWh/giorno), l'ultima chiusa il 14 marzo.
  const bills: Bill[] = [];
  let start = '2024-01-01';
  const addDays = (iso: string, n: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
  while (start < '2026-03-01') {
    let end = addDays(start, 59);
    if (end > '2026-03-14') end = '2026-03-14';
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    bills.push(bill({ periodStart: start, periodEnd: end, lines: [{ consumption: days, costCents: days * 100 }] }));
    start = addDays(end, 1);
  }
  const s = utilitySummary(bills, 'electricity');
  assert.equal(s.lastMonth, '2026-02');
  assert.ok(Math.abs(s.consumptionDeltaPct!) < 0.5, `delta ${s.consumptionDeltaPct}`);
  assert.ok(Math.abs(s.dailyConsumption! - 1) < 1e-9);
});

test('il prezzo medio ignora le righe con il solo costo', () => {
  const bills = [
    ...monthlyBills(2025, 6, 1000, 30000),
    bill({ periodStart: '2025-07-01', periodEnd: '2025-12-31', lines: [{ costCents: 180000 }] }),
  ];
  const y = yearlyTotals(bills, 'electricity');
  assert.ok(Math.abs(y[0].unitPriceCents! - 30) < 1e-6, `prezzo ${y[0].unitPriceCents}`);
  assert.ok(Math.abs(utilitySummary(bills, 'electricity').unitPriceCents! - 30) < 1e-6);
});

test('combinedLast12 usa una finestra comune a tutti i servizi', async () => {
  const { combinedLast12 } = await import('../src/features/bills/analytics.ts');
  const bills = [
    ...monthlyBills(2025, 12, 100, 1000),
    bill({ periodStart: '2024-01-01', periodEnd: '2024-03-31', lines: [{ utility: 'water', consumption: 20, costCents: 5000 }] }),
  ];
  const r = combinedLast12(bills)!;
  assert.deepEqual([r.from, r.to], ['2025-01', '2025-12']);
  assert.equal(r.costCents, 12000);
});

test('parseDecimal legge i numeri come li scrive un italiano', async () => {
  const { parseDecimal, toCents } = await import('../src/features/bills/numbers.ts');
  const cases: Array<[string, number | null]> = [
    ['1.234', 1234],
    ['12.500', 12500],
    ['1.234.567', 1234567],
    ['1.234,56', 1234.56],
    ['1234,5', 1234.5],
    ['45.20', 45.2],
    ['1.5', 1.5],
    ['0.123', 0.123],
    ['-35,00', -35],
    ['€ 12,30', 12.3],
    ['', null],
  ];
  for (const [input, expected] of cases) assert.equal(parseDecimal(input), expected, input);
  assert.ok(Number.isNaN(parseDecimal('abc')));
  assert.ok(Number.isNaN(parseDecimal('1.2.3')));
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(-12.345), -1234);
});
