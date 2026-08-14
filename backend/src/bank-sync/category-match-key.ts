/**
 * Chiave di "memoria delle categorie": riduce un movimento bancario a una
 * stringa stabile che identifica **il tipo di movimento** (chi è la controparte
 * / che cosa è la spesa), non la singola occorrenza.
 *
 * Serve a `CategoryMemory`: quando l'utente assegna una categoria a mano in
 * revisione, si memorizza `matchKey → categoria`; al sync successivo le righe
 * con la stessa chiave ricevono subito quella categoria, senza chiamare l'LLM.
 *
 * Funzione **pura** (nessuna dipendenza da Prisma o Nest), tenuta qui accanto a
 * `transaction-parse.ts` per lo stesso motivo: è la parte facile da sbagliare e
 * deve restare testabile in isolamento.
 */

/** Stessa lunghezza della colonna `category_memories.match_key`. */
const MATCH_KEY_MAX_LEN = 80;

/** Quanti token significativi conserviamo: oltre, si torna a identificare la singola riga. */
const MATCH_KEY_MAX_TOKENS = 5;

/** Sotto i 3 caratteri un token non distingue niente ("di", "s", "c"). */
const MIN_TOKEN_LEN = 3;

/**
 * Diciture bancarie ricorrenti: compaiono su migliaia di righe diverse, quindi
 * come chiave non distinguono nulla. Scritte già normalizzate (minuscolo, senza
 * punteggiatura) perché vengono rimosse **dopo** la normalizzazione.
 * Le sequenze più lunghe vanno prima: la rimozione è in ordine di elenco.
 */
const NOISE_PHRASES = [
  'rata bon period',
  'beu intern bank',
  'add e c carta',
  'pagamento adue',
  'pagamento pos',
  'prel bancomat',
  'addebito bon',
  'pag internet',
  'cod disp',
  'accr beu',
  'notprovided',
  'mandato',
  'nome',
  'comm',
  'supp',
  'cash',
];

/**
 * Parole di servizio che sopravvivono al filtro sulla lunghezza ma non
 * caratterizzano il movimento (preposizioni, etichette di riferimento, valuta).
 */
const STOPWORDS = new Set([
  'del',
  'dello',
  'della',
  'delle',
  'dei',
  'degli',
  'dal',
  'dalla',
  'per',
  'con',
  'ref',
  'rif',
  'data',
  'ore',
  'eur',
  'euro',
  'the',
  'and',
]);

/**
 * Chiave di memoria per una riga bancaria, o `null` se non ne resta niente di
 * significativo (in quel caso non si impara e non si applica nulla: meglio
 * nessun suggerimento che uno costruito sul rumore).
 *
 * Preferisce la **controparte** (già estratta dal provider: è il nome del
 * beneficiario/ordinante) e ripiega sulla causale depurata quando manca o si
 * riduce a rumore.
 */
export function buildCategoryMatchKey(
  counterparty: string | null | undefined,
  description: string | null | undefined,
): string | null {
  return keyFromText(counterparty) ?? keyFromText(description);
}

function keyFromText(value: string | null | undefined): string | null {
  const normalized = stripNoise(normalize(value));
  if (!normalized) return null;

  const tokens: string[] = [];
  for (const token of normalized.split(' ')) {
    if (!isSignificant(token)) continue;
    tokens.push(token);
    if (tokens.length === MATCH_KEY_MAX_TOKENS) break;
  }
  if (tokens.length === 0) return null;

  return tokens.join(' ').slice(0, MATCH_KEY_MAX_LEN).trim() || null;
}

/**
 * Minuscolo, accenti via, tutto ciò che non è lettera o cifra diventa spazio,
 * spazi collassati: la stessa causale scritta con o senza punteggiatura deve
 * produrre la stessa chiave.
 */
function normalize(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Rimuove le diciture bancarie ricorrenti, ovunque compaiano nella stringa. */
function stripNoise(value: string): string {
  let out = ` ${value} `;
  for (const phrase of NOISE_PHRASES) {
    out = out.split(` ${phrase} `).join(' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Scarta ciò che cambia da un movimento all'altro: numeri, date, codici
 * alfanumerici misti (`MND0000505474`, `6626081135150407`), token troppo corti
 * e parole di servizio.
 */
function isSignificant(token: string): boolean {
  if (token.length < MIN_TOKEN_LEN) return false;
  if (STOPWORDS.has(token)) return false;
  const hasDigit = /\d/.test(token);
  const hasLetter = /[a-z]/.test(token);
  // Solo cifre → numero/data/importo; lettere + cifre → codice identificativo.
  if (hasDigit && !hasLetter) return false;
  if (hasDigit && hasLetter) return false;
  return true;
}
