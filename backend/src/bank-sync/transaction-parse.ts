/**
 * Helper puri per la normalizzazione dei movimenti bancari.
 *
 * Stanno fuori dai service perché sono la parte più delicata (e più facile da
 * sbagliare) del sync: conversione degli importi **senza float** e calcolo
 * dell'hash di deduplica. Nessuna dipendenza da Prisma o da Nest.
 */

import { createHash } from 'node:crypto';

/** Stato Berlin Group dei movimenti che accettiamo: contabilizzati. */
export const BOOKED_STATUS = 'BOOK';

/**
 * Converte una stringa decimale in centesimi **senza mai passare da un float**:
 * `parseFloat("0.29")` è già inesatto e sommato su migliaia di righe sposta i
 * saldi. Si lavora sulle cifre: split su `.` (o `,` — qualche banca la usa),
 * segno esplicito, parte decimale portata a esattamente 2 cifre.
 *
 * Ritorna `null` se la stringa non è un decimale riconoscibile.
 * Le eventuali cifre oltre la seconda vengono **troncate** (mai arrotondate):
 * scartare la riga sarebbe peggio che perdere un millesimo di centesimo.
 */
export function parseDecimalToCents(raw: string | null | undefined): bigint | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/[\s '_]/g, '');
  if (!compact) return null;

  const match = /^([+-]?)(\d*)(?:[.,](\d*))?$/.exec(compact);
  if (!match) return null;

  const [, sign, intPartRaw, fracPartRaw] = match;
  const intPart = intPartRaw ?? '';
  const fracPart = fracPartRaw ?? '';
  // "" , "." , "-" non sono importi: almeno una cifra deve esserci.
  if (!intPart && !fracPart) return null;

  const cents = `${fracPart}00`.slice(0, 2);
  const digits = `${intPart || '0'}${cents}`;
  const value = BigInt(digits);
  return sign === '-' ? -value : value;
}

/**
 * Importo firmato in centesimi secondo la convenzione dell'app (uscite
 * negative, entrate positive).
 *
 * Il segno viene dal `credit_debit_indicator` (`CRDT` = accredito,
 * `DBIT` = addebito), che nello spec è la fonte autorevole: la stringa
 * dell'importo è quasi sempre positiva. Se l'indicatore manca si ripiega sul
 * segno della stringa.
 */
export function signedAmountCents(
  amount: string | null | undefined,
  creditDebitIndicator: string | null | undefined,
): bigint | null {
  const parsed = parseDecimalToCents(amount);
  if (parsed === null) return null;

  const magnitude = parsed < 0n ? -parsed : parsed;
  const indicator = creditDebitIndicator?.trim().toUpperCase();
  if (indicator === 'CRDT') return magnitude;
  if (indicator === 'DBIT') return -magnitude;
  return parsed;
}

/**
 * Normalizzazione per i confronti fuzzy e per l'hash: stessa regola di
 * `ImportsService` (minuscolo, non-alfanumerici → spazio), così una riga
 * bancaria e una riga importata da CSV si confrontano allo stesso modo.
 */
export function normalizeForCompare(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Due descrizioni "si somigliano" con la stessa euristica dell'import CSV:
 * una contiene il prefisso dell'altra. Se una delle due è vuota si considera
 * match (la banca spesso non manda causale sui pagamenti carta).
 */
export function descriptionsLooselyMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return true;
  return na.includes(nb.slice(0, 20)) || nb.includes(na.slice(0, 20));
}

/**
 * Chiave di deduplica della riga.
 *
 * Se la banca manda `entry_reference` è già un identificativo stabile: si usa
 * quello (prefissato, per non collidere con gli hash calcolati). Altrimenti si
 * combina data effettiva + importo + descrizione normalizzata + **occorrenza
 * progressiva**: due bonifici gemelli lo stesso giorno con la stessa causale
 * sono movimenti distinti e devono restare distinti.
 */
export function computeDedupHash(input: {
  entryReference: string | null;
  /** YYYY-MM-DD */
  effectiveDate: string;
  amountCents: bigint;
  description: string | null;
  /** 0 per la prima riga identica del fetch, 1 per la seconda, … */
  occurrence: number;
}): string {
  if (input.entryReference) return sha256Hex(`er:${input.entryReference}`);
  return sha256Hex(
    [
      input.effectiveDate,
      input.amountCents.toString(),
      normalizeForCompare(input.description),
      String(input.occurrence),
    ].join('|'),
  );
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** `YYYY-MM-DD` → `Date` a mezzanotte UTC (le colonne sono `@db.Date`). */
export function parseIsoDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Date` → `YYYY-MM-DD` in UTC (formato atteso da `date_from`). */
export function toIsoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
