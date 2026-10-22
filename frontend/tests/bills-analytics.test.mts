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
      energyCostCents: l.energyCostCents ?? null,
      energyUnitPrice: l.energyUnitPrice ?? null,
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
      bill({ id: 'a', periodStart: '2026-01-01', periodEnd: '2026-02-28', lines: [{ consumption: 100 }] }),
      bill({ id: 'b', periodStart: '2026-02-15', periodEnd: '2026-03-31', lines: [{ consumption: 80 }] }),
      bill({ id: 'c', periodStart: '2026-04-01', periodEnd: '2026-05-31', lines: [{ consumption: 0 }] }),
      // Acconto stornato dal conguaglio "c": consumo tolto, non è un doppione.
      bill({ id: 'd', periodStart: '2026-04-01', periodEnd: '2026-04-30', lines: [{ consumption: null }] }),
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

test('yearlySummary: totali per anno, variazione solo tra anni completi', async () => {
  const { yearlySummary, monthlyTotalsOfYear, billYears } = await import('../src/features/bills/analytics.ts');
  const water = (y: number, q: number, cents: number) => {
    const sm = (q - 1) * 3 + 1;
    const em = sm + 2;
    const last = new Date(Date.UTC(y, em, 0)).getUTCDate();
    return bill({
      periodStart: `${y}-${String(sm).padStart(2, '0')}-01`,
      periodEnd: `${y}-${String(em).padStart(2, '0')}-${last}`,
      lines: [{ utility: 'water', consumption: 20, costCents: cents }],
    });
  };
  const bills = [
    ...monthlyBills(2024, 12, 100, 1000),
    ...monthlyBills(2025, 12, 100, 1200),
    ...monthlyBills(2026, 3, 100, 1300),
    ...[1, 2, 3, 4].map((q) => water(2024, q, 3000)),
    ...[1, 2, 3, 4].map((q) => water(2025, q, 3000)),
    water(2026, 1, 3300),
  ];
  const y = yearlySummary(bills);
  assert.deepEqual(y.map((x) => x.year), [2024, 2025, 2026]);
  assert.equal(y[0].totalCents, 12000 + 12000);
  assert.equal(y[1].costCents.electricity, 14400);
  assert.ok(Math.abs(y[1].totalCents - 26400) <= 2);
  assert.equal(y[1].costCents.gas, null);
  // Il centesimo arrotondato mese per mese sposta la variazione di qualche millesimo.
  assert.ok(Math.abs(y[1].deltaPct! - 10) < 0.01, `delta ${y[1].deltaPct}`);
  assert.equal(y[2].complete, false);
  assert.equal(y[2].deltaPct, null);
  const m = monthlyTotalsOfYear(bills, 2026);
  // Gennaio: luce del mese + 31/90 della bolletta trimestrale dell’acqua.
  assert.equal(m[0], 1300 + Math.round((3300 * 31) / 90));
  assert.equal(m[5], null);
  assert.deepEqual(billYears(bills), [2026, 2025, 2024]);
});

test('combinedLast12 con meno di un anno di storico parte dal primo mese coperto', async () => {
  const { combinedLast12 } = await import('../src/features/bills/analytics.ts');
  const bills = monthlyBills(2026, 9, 100, 1000).slice(2); // marzo → settembre 2026
  const r = combinedLast12(bills)!;
  assert.deepEqual([r.from, r.to, r.months], ['2026-03', '2026-09', 7]);
  assert.equal(r.costCents, 7000);
});

test('energyPrices: prezzo scritto in bolletta, altrimenti spesa / consumo; mai per l’acqua', async () => {
  const { energyPrices, averageEnergyPrice } = await import('../src/features/bills/analytics.ts');
  const bills = [
    bill({ periodStart: '2026-05-01', periodEnd: '2026-05-31', lines: [{ consumption: 175.62, costCents: 3908, energyUnitPrice: 0.177488 }] }),
    bill({ periodStart: '2026-06-01', periodEnd: '2026-06-30', lines: [{ consumption: 200, costCents: 5000, energyCostCents: 4000 }] }),
    bill({ periodStart: '2026-07-01', periodEnd: '2026-07-31', lines: [{ consumption: 100, costCents: 3000 }] }),
    bill({ periodStart: '2026-07-01', periodEnd: '2026-07-31', lines: [{ utility: 'water', consumption: 10, costCents: 3000, energyCostCents: 100 }] }),
  ];
  const p = energyPrices(bills, 'electricity');
  assert.equal(p.length, 2);
  assert.ok(Math.abs(p[0].unitPriceCents - 17.7488) < 1e-9);
  assert.equal(p[1].unitPriceCents, 20);
  assert.deepEqual(energyPrices(bills, 'water'), []);
  const avg = averageEnergyPrice(p)!;
  assert.ok(Math.abs(avg - (17.7488 * 175.62 + 20 * 200) / 375.62) < 1e-9);
});

test('yearlySummary: un anno con due mesi scoperti non è completo', async () => {
  const { yearlySummary } = await import('../src/features/bills/analytics.ts');
  const bills = [
    ...monthlyBills(2024, 12, 100, 1000),
    bill({ periodStart: '2025-01-01', periodEnd: '2025-03-01', lines: [{ consumption: 100, costCents: 2000 }] }),
    bill({ periodStart: '2025-04-30', periodEnd: '2025-12-31', lines: [{ consumption: 100, costCents: 8000 }] }),
  ];
  const y = yearlySummary(bills);
  assert.equal(y[1].complete, false);
  assert.equal(y[1].deltaPct, null);
});

test('yearlySummary: un servizio cessato non blocca il confronto degli anni dopo', async () => {
  const { yearlySummary } = await import('../src/features/bills/analytics.ts');
  const gas2023 = monthlyBills(2023, 12, 50, 3000).map((b) => ({ ...b, lines: b.lines.map((l) => ({ ...l, utility: 'gas' as const })) }));
  const bills = [...gas2023, ...monthlyBills(2023, 36, 100, 1000)];
  const y = yearlySummary(bills);
  assert.deepEqual(y.map((x) => [x.year, x.complete]), [[2023, true], [2024, true], [2025, true]]);
  // 2024 confrontato col 2023 solo sulla luce (il gas c'era solo nel 2023).
  assert.ok(Math.abs(y[1].deltaPct!) < 0.01, `delta ${y[1].deltaPct}`);
});

test('combinedLast12: la finestra finisce all’ultimo mese completo di tutti i servizi', async () => {
  const { combinedLast12 } = await import('../src/features/bills/analytics.ts');
  const gas = monthlyBills(2025, 9, 50, 500).map((b) => ({ ...b, lines: b.lines.map((l) => ({ ...l, utility: 'gas' as const })) }));
  const r = combinedLast12([...monthlyBills(2025, 12, 100, 1000), ...gas])!;
  assert.equal(r.to, '2025-09');
});

test('averageEnergyPrice non fa pesare 1 kWh le bollette senza consumo', async () => {
  const { averageEnergyPrice } = await import('../src/features/bills/analytics.ts');
  const avg = averageEnergyPrice([
    { billId: 'a', date: '2026-01-31', provider: null, unitPriceCents: 10, consumption: null },
    { billId: 'b', date: '2026-02-28', provider: null, unitPriceCents: 20, consumption: 300 },
  ]);
  assert.equal(avg, 20);
  assert.equal(
    averageEnergyPrice([{ billId: 'a', date: '2026-01-31', provider: null, unitPriceCents: 10, consumption: null }]),
    10,
  );
});

test('parseUnitPrice: il punto di un prezzo è sempre decimale', async () => {
  const { parseUnitPrice } = await import('../src/features/bills/numbers.ts');
  assert.equal(parseUnitPrice('1.250'), 1.25);
  assert.equal(parseUnitPrice('0,177488'), 0.177488);
  assert.equal(parseUnitPrice('0.177488 €/kWh'), 0.177488);
  assert.equal(parseUnitPrice(''), null);
  assert.ok(Number.isNaN(parseUnitPrice('1.2.3')!));
});
