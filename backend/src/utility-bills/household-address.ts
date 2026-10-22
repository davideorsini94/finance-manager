/**
 * Indirizzi di fornitura e abitazioni. Funzioni pure, coperte da
 * `household-address.spec.ts`.
 *
 * Lo stesso indirizzo arriva scritto in modi diversi da fornitori diversi (e
 * a volte dallo stesso): "VIA NILDE IOTTI 11", "Via Nilde Iotti 11 42015
 * Correggio RE", "VIA IOTTI N. 11 - 42015 Correggio RE". Un confronto tra
 * stringhe creerebbe tre abitazioni. Si confrontano invece i pezzi: civico
 * (con esponente), CAP o città, tipo di via, parole del nome della via.
 */

export interface ParsedAddress {
  /** Parole significative del nome della via, minuscole e senza accenti ("nilde", "iotti", "4", "novembre"). */
  street: string[];
  /** Tipo di via normalizzato ("via", "piazza", …), se riconosciuto. */
  kind: string | null;
  /** Civico normalizzato con l'esponente: "11", "14a", "10bis", "km12". */
  number: string | null;
  cap: string | null;
  /** Parole della città ("correggio", "reggio emilia"), senza provincia né "int./scala". */
  city: string | null;
}

const STREET_KINDS: Array<[RegExp, string]> = [
  [/^(v\.?le|viale)$/, 'viale'],
  [/^(v\.?|via)$/, 'via'],
  [/^(p\.?za|p\.?zza|piazza|p\.?le|piazzale|piazzetta)$/, 'piazza'],
  [/^(c\.?so|corso)$/, 'corso'],
  [/^(str\.?|strada)$/, 'strada'],
  [/^(vic\.?|vicolo)$/, 'vicolo'],
  [/^(l\.?go|largo)$/, 'largo'],
  [/^(loc\.?|localita|frazione|fraz\.?)$/, 'localita'],
  [/^(contrada|c\.?da)$/, 'contrada'],
  [/^(borgo|lungomare|lungotevere|calle|traversa|salita)$/, 'via'],
];

/** Parole che non distinguono una via o una città dall'altra. */
const STOPWORDS = new Set([
  'di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'da', 'de', 'e', 'nel', 'nell', 'nella',
  'n', 'nr', 'num', 'civ', 'civico', 'snc', 'sn',
]);

const MONTHS = new Set([
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
]);

/** Parole dopo il civico che indicano una parte dell'edificio, non la città ("int. 3", "scala B"). */
const BUILDING_PARTS = new Set(['int', 'interno', 'scala', 'sc', 'piano', 'p', 'lotto', 'pal', 'palazzina', 'edificio', 'ed', 'app', 'appartamento']);

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  if (!raw) return null;
  let s = stripAccents(raw).toLowerCase();
  // CAP: 5 cifre isolate. Va tolto prima di cercare il civico.
  const capMatch = s.match(/(?:^|\D)(\d{5})(?:\D|$)/);
  const cap = capMatch ? capMatch[1] : null;
  if (capMatch) s = s.replace(capMatch[1], ' ');
  s = s
    .replace(/['’`]/g, ' ') // "nell'Emilia" → "nell emilia"
    .replace(/\([a-z]{2}\)/g, ' ') // provincia tra parentesi
    .replace(/(\d+)\s*\/\s*([a-z]{1,6})\b/g, '$1$2') // "14/a" → "14a"
    .replace(/(\d+)\s+(bis|ter|quater)\b/g, '$1$2') // "10 bis" → "10bis"
    .replace(/(\d+)\s*[°º]/g, '$1ord ') // "1°" (ordinale nel nome della via)
    .replace(/\bn\s*[.°º]\s*/g, ' n ')
    .replace(/[,;:\\-]+/g, ' ');

  const tokens = s
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.]/g, '').replace(/\.+$/, ''))
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let kind: string | null = null;
  let i = 0;
  for (const [re, k] of STREET_KINDS) {
    if (re.test(tokens[0])) {
      kind = k;
      i = 1;
      break;
    }
  }
  const street: string[] = [];
  let number: string | null = null;
  let kmPrefix = false;
  for (; i < tokens.length; i++) {
    const t = tokens[i].replace(/\./g, '');
    const next = tokens[i + 1]?.replace(/\./g, '');
    if (t === 'km') {
      kmPrefix = true;
      continue;
    }
    if (/^\d+ord$/.test(t)) {
      street.push(t.replace('ord', '')); // "1° Maggio": il numero fa parte del nome
      continue;
    }
    if (/^\d+[a-z]*$/.test(t)) {
      // "Via 4 Novembre 12", "Strada Statale 9 km 12": numeri del nome della via.
      if (next && (MONTHS.has(next) || next === 'km') && !kmPrefix) {
        street.push(t);
        continue;
      }
      number = (kmPrefix ? 'km' : '') + t;
      i += 1;
      break;
    }
    if (!STOPWORDS.has(t) && t.length > 1) street.push(t);
  }
  // Dopo il civico: la città, saltando le parti dell'edificio e il loro valore.
  const city: string[] = [];
  for (; i < tokens.length; i++) {
    const t = tokens[i].replace(/\./g, '');
    if (BUILDING_PARTS.has(t)) {
      i += 1; // salta anche "3" di "int. 3"
      continue;
    }
    if (/^\d/.test(t) || t.length <= 2 || STOPWORDS.has(t)) continue;
    city.push(t);
  }
  if (street.length === 0) return null;
  return { street, kind, number, cap, city: city.length ? city.join(' ') : null };
}

const wordsSubset = (a: string[], b: string[]) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((w) => long.includes(w));
};

/**
 * Stesso indirizzo?
 * - civico identico (con esponente: 14A ≠ 14B, 10bis ≠ 10), tipo di via
 *   uguale se indicato su entrambi, parole della via dell'uno contenute
 *   nell'altro ("iotti" ⊂ "nilde iotti");
 * - **e** stessa località: CAP uguale se c'è su entrambi, altrimenti città
 *   equivalente se c'è su entrambi.
 * Se nessuno dei due permette di confrontare la località (uno ha solo il CAP,
 * l'altro solo la città, o uno non ha niente) il risultato è `lenient`:
 * `false` di default, perché "Via Iotti 11" esiste in più comuni.
 */
export function addressesMatch(
  a: ParsedAddress | null,
  b: ParsedAddress | null,
  opts: { lenient?: boolean } = {},
): boolean {
  if (!a || !b) return false;
  // Senza civico non si unisce niente: "via Roma" è in quasi ogni comune.
  if (!a.number || !b.number || a.number !== b.number) return false;
  if (a.kind && b.kind && a.kind !== b.kind) return false;
  if (!wordsSubset(a.street, b.street)) return false;
  if (a.cap && b.cap) return a.cap === b.cap;
  if (a.city && b.city) return wordsSubset(a.city.split(' '), b.city.split(' '));
  return opts.lenient === true;
}

const title = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());

/** Nome leggibile per una nuova abitazione: "Via Nilde Iotti 11, Correggio". */
export function householdName(raw: string): string {
  const p = parseAddress(raw);
  if (!p) return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  const street = [p.kind, ...p.street].filter(Boolean).join(' ');
  const city = p.city ? `, ${p.city.split(' ').slice(0, 3).join(' ')}` : '';
  return title(`${street}${p.number ? ` ${p.number.toUpperCase()}` : ''}${city}`).slice(0, 120);
}

// Fine parola con lookahead e non `\b`: in JS `\b` non riconosce le lettere
// accentate, e "Località Boschetto 4" non veniva mai trovata.
const STREET_START =
  /(?:^|[^a-zà-ù])(via|viale|v\.le|piazza|p\.zza|p\.za|piazzale|corso|c\.so|strada|vicolo|largo|localit[aà]|frazione|contrada|borgo|lungomare)(?=[\s.,]|$)/i;

/** Riga che parla dell'abitazione servita. */
const SUPPLY_LABEL = /fornitura|ubicazione|punto di prelievo|sito in|immobile|indirizzo/i;
/** Riga del cliente (di solito coincide con la casa). */
const CUSTOMER_LABEL = /fatturazione|intestatario|recapito|cliente/i;
/** Riga della sede del fornitore. */
const COMPANY_LABEL =
  /sede|s\.p\.a|s\.r\.l|\bspa\b|\bsrl\b|p\.?\s?iva|capitale sociale|registro imprese|c\.f\.|codice fiscale|reclami|servizio clienti|numero verde/i;

/**
 * Cerca l'indirizzo di fornitura nel testo del PDF, senza LLM.
 *
 * Si usa quando il modello non lo restituisce e per le bollette caricate
 * prima che esistessero le abitazioni. Ogni riga con un tipo di via e un
 * civico è una candidata. Un indirizzo vale per l'etichetta migliore che ha
 * (fornitura > cliente > nessuna; la sede del fornitore pesa in negativo) più
 * le sue ripetizioni, ma queste contano al massimo 2: un piè di pagina con la
 * sede ripetuto su ogni pagina non deve battere l'indirizzo del cliente.
 */
export function findSupplyAddress(text: string): string | null {
  const lines = text
    .split('\n')
    // Il testo estratto dal PDF a volte attacca etichetta e valore
    // ("IndirizzoVIA IOTTI"): si separa una parola minuscola da un tipo di via
    // che inizia con la maiuscola.
    .map((l) => l.replace(/([a-zàèéìòù])(?=(?:Via|VIA|Viale|VIALE|Piazza|PIAZZA|Corso|CORSO|Strada|STRADA|Largo|LARGO|Vicolo|VICOLO)\b)/g, '$1 '))
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  type Candidate = { raw: string; parsed: ParsedAddress; label: number };
  const candidates: Candidate[] = [];
  for (const line of lines) {
    const m = line.match(STREET_START);
    if (!m || m.index === undefined) continue;
    const start = m.index + m[0].length - m[1].length;
    const raw = line.slice(start).slice(0, 160);
    const parsed = parseAddress(raw);
    if (!parsed?.number) continue;
    let label = 0;
    // L'ordine conta: "Indirizzo di fatturazione" contiene anche "indirizzo".
    if (COMPANY_LABEL.test(line)) label = -8;
    else if (CUSTOMER_LABEL.test(line)) label = 4;
    else if (SUPPLY_LABEL.test(line)) label = 10;
    candidates.push({ raw, parsed, label });
  }
  if (candidates.length === 0) return null;
  const groups: Array<{ best: Candidate; label: number; count: number }> = [];
  const richer = (p: ParsedAddress) => (p.cap ? 2 : 0) + (p.city ? 1 : 0) + p.street.length;
  for (const c of candidates) {
    const g = groups.find((x) => addressesMatch(x.best.parsed, c.parsed, { lenient: true }));
    if (g) {
      g.label = Math.max(g.label, c.label);
      g.count += 1;
      // Come rappresentante tengo la forma più completa (con CAP e città).
      if (richer(c.parsed) > richer(g.best.parsed)) g.best = c;
    } else {
      groups.push({ best: c, label: c.label, count: 1 });
    }
  }
  const score = (g: { label: number; count: number }) => g.label + Math.min(g.count, 2);
  groups.sort((a, b) => score(b) - score(a));
  return score(groups[0]) > 0 ? cleanAddress(groups[0].best.raw) : null;
}

/** POD (luce) e PDR (gas): codici del contatore, affidabili per riconoscere una casa. */
export function isMeterCode(code: string): boolean {
  return /^IT\d{3}E[0-9A-Z]{6,}$/.test(code) || /^\d{14}$/.test(code);
}

/** Ripulisce un indirizzo per salvarlo: spazi, separatori in coda, lunghezza. */
export function cleanAddress(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:-]+$/, '')
    .trim()
    .slice(0, 300);
}
