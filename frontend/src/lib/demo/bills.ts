import type { UtilityBill } from '@/features/bills/billsApi';

/**
 * Bollette finte per la modalità demo, sempre "recenti" rispetto a oggi:
 * - luce + gas nella stessa bolletta (dual fuel), bimestrale, due anni, con
 *   cambio di fornitore a metà (Edison → Enel) e prezzo che scende
 * - acqua trimestrale (Acea Ato 2), due anni
 * - l'ultima dual fuel è "da verificare", come se l'avesse appena letta l'LLM
 * Numeri deterministici: stagionalità + un po' di rumore con seme fisso.
 */

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Stagionalità (gennaio = 1): il gas pesa d'inverno, la luce un po' d'estate. */
const GAS_SEASON = [1.0, 0.95, 0.75, 0.45, 0.2, 0.1, 0.08, 0.08, 0.12, 0.35, 0.7, 0.95];
const ELEC_SEASON = [1.05, 1.0, 0.92, 0.85, 0.88, 1.05, 1.2, 1.15, 0.95, 0.9, 0.98, 1.08];

function build(): UtilityBill[] {
  const rand = rng(20260422);
  const now = new Date();
  const out: UtilityBill[] = [];
  const created = now.toISOString();

  // Ultimo bimestre (gen-feb, mar-apr, …) concluso prima del mese corrente.
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1; // 1..12
  // Inizio del bimestre in corso (mesi dispari), poi quello prima: concluso.
  m = (m % 2 === 1 ? m : m - 1) - 2;
  if (m <= 0) {
    m += 12;
    y -= 1;
  }
  // Partiamo 13 bimestri indietro: 12 confermati + 1 da verificare.
  const starts: Array<[number, number]> = [];
  for (let i = 0; i < 13; i++) {
    starts.unshift([y, m]);
    m -= 2;
    if (m <= 0) {
      m += 12;
      y -= 1;
    }
  }
  starts.forEach(([sy, sm], i) => {
    const em = sm + 1;
    const enel = i >= 6;
    const elecKwh = Math.round(290 * ((ELEC_SEASON[sm - 1] + ELEC_SEASON[em - 1]) / 2) * (0.92 + rand() * 0.16));
    const gasSmc = Math.round(310 * ((GAS_SEASON[sm - 1] + GAS_SEASON[em - 1]) / 2) * (0.9 + rand() * 0.2) + 6);
    const elecPrice = enel ? 0.268 + rand() * 0.012 : 0.318 + rand() * 0.02;
    const gasPrice = enel ? 1.08 + rand() * 0.05 : 1.24 + rand() * 0.07;
    // Quota fissa del bimestre: pesa di più quando i consumi sono bassi.
    const elecCents = Math.round((elecKwh * elecPrice + 22) * 100);
    const gasCents = Math.round((gasSmc * gasPrice + 18) * 100);
    const last = i === starts.length - 1;
    const periodEnd = iso(sy, em, lastDay(sy, em));
    out.push({
      id: `demo-bill-dual-${i}`,
      provider: enel ? 'Enel Energia' : 'Edison Energia',
      billNumber: `${enel ? 'EN' : 'ED'}${sy}${String(400000 + i * 137)}`,
      issueDate: iso(em === 12 ? sy + 1 : sy, em === 12 ? 1 : em + 1, 8),
      dueDate: iso(em === 12 ? sy + 1 : sy, em === 12 ? 1 : em + 1, 28),
      periodStart: iso(sy, sm, 1),
      periodEnd,
      totalCents: elecCents + gasCents,
      notes: null,
      status: last ? 'review' : 'confirmed',
      hasFile: true,
      fileName: `bolletta-${enel ? 'enel' : 'edison'}-${periodEnd.slice(0, 7)}.pdf`,
      extractionError: null,
      extractionModel: 'opencode:deepseek-v4-pro',
      createdAt: created,
      updatedAt: created,
      lines: [
        { utility: 'electricity', consumption: elecKwh, costCents: elecCents, periodStart: null, periodEnd: null, supplyCode: 'IT001E18273645', estimated: false },
        { utility: 'gas', consumption: gasSmc, costCents: gasCents, periodStart: null, periodEnd: null, supplyCode: '00881234567890', estimated: i % 4 === 1 },
      ],
    });
  });

  // Acqua: ultimi 8 trimestri conclusi.
  let qy = now.getUTCFullYear();
  let qm = Math.floor(now.getUTCMonth() / 3) * 3 + 1 - 3; // inizio del trimestre precedente
  if (qm <= 0) {
    qm += 12;
    qy -= 1;
  }
  const quarters: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    quarters.unshift([qy, qm]);
    qm -= 3;
    if (qm <= 0) {
      qm += 12;
      qy -= 1;
    }
  }
  quarters.forEach(([sy, sm], i) => {
    const em = sm + 2;
    const summer = sm === 7 ? 1.25 : sm === 4 ? 1.08 : 1;
    const m3 = Math.round(26 * summer * (0.9 + rand() * 0.2) * 10) / 10;
    const price = 2.05 + i * 0.03 + rand() * 0.04;
    const cents = Math.round((m3 * price + 14) * 100);
    out.push({
      id: `demo-bill-water-${i}`,
      provider: 'Acea Ato 2',
      billNumber: `AC${sy}${String(70000 + i * 31)}`,
      issueDate: iso(em === 12 ? sy + 1 : sy, em === 12 ? 1 : em + 1, 12),
      dueDate: iso(em === 12 ? sy + 1 : sy, em === 12 ? 2 : em + 2, 5),
      periodStart: iso(sy, sm, 1),
      periodEnd: iso(sy, em, lastDay(sy, em)),
      totalCents: cents,
      notes: null,
      status: 'confirmed',
      hasFile: true,
      fileName: `acea-${sy}-T${Math.ceil(sm / 3)}.pdf`,
      extractionError: null,
      extractionModel: 'opencode:deepseek-v4-pro',
      createdAt: created,
      updatedAt: created,
      lines: [
        { utility: 'water', consumption: m3, costCents: cents, periodStart: null, periodEnd: null, supplyCode: '30049182', estimated: i === 5 },
      ],
    });
  });

  // Una lettura non riuscita, per mostrare "Riprova" e "Compila".
  out.push({
    id: 'demo-bill-failed',
    provider: null,
    billNumber: null,
    issueDate: null,
    dueDate: null,
    periodStart: null,
    periodEnd: null,
    totalCents: null,
    notes: null,
    status: 'failed',
    hasFile: true,
    fileName: 'bolletta-acqua-scansione.pdf',
    extractionError: 'Il PDF non contiene testo leggibile (forse è una scansione): inserisci i dati a mano',
    extractionModel: null,
    createdAt: created,
    updatedAt: created,
    lines: [],
  });

  return out.sort((a, b) => (b.periodEnd ?? '9999').localeCompare(a.periodEnd ?? '9999'));
}

export const DEMO_UTILITY_BILLS: UtilityBill[] = build();
