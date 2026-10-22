// Funzioni pure sui numeri scritti nel form delle bollette: niente import,
// così le prova anche `node --test` (frontend/tests/).

/**
 * Numero scritto da una persona all'italiana: "1.234,56", "1234,5", "45",
 * "45.20". Il punto da solo seguito da gruppi di tre cifre ("1.234",
 * "12.500") è il separatore delle migliaia, come scriverebbe chiunque in
 * Italia; "1.5" o "45.20" restano decimali.
 * Stringa vuota → `null`; testo non numerico → `NaN` (lo schema lo rifiuta).
 */
export function parseDecimal(raw: string): number | null {
  const s = raw.replace(/[\s€]/g, '');
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return Number.NaN;
  let normalized: string;
  if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '');
  else normalized = s;
  if ((normalized.match(/\./g) ?? []).length > 1) return Number.NaN;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Euro → centesimi senza l'errore binario di `1.005 * 100 = 100.4999…`. */
export function toCents(euro: number): number {
  return Math.round(Number((euro * 100).toFixed(6)));
}

/**
 * Prezzo unitario (€/kWh, €/Smc): qui il punto è sempre il separatore
 * decimale, perché un prezzo non arriva mai alle migliaia ("1.250" €/Smc è
 * 1,25 e non 1250, come leggerebbe `parseDecimal`).
 */
export function parseUnitPrice(raw: string): number | null {
  const s = raw.replace(/[\s€]/g, '').replace(/\/(kwh|smc|m3|m³)$/i, '');
  if (!s) return null;
  if (!/^\d*[.,]?\d+$/.test(s)) return Number.NaN;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
}
