/**
 * Indirizzi di fornitura e abitazioni. Funzioni pure, coperte da
 * `household-address.spec.ts`.
 *
 * Lo stesso indirizzo arriva scritto in modi diversi da fornitori diversi (e
 * a volte dallo stesso): "VIA NILDE IOTTI 11", "Via Nilde Iotti 11 42015
 * Correggio RE", "VIA IOTTI N. 11 - 42015 Correggio RE". Un confronto tra
 * stringhe creerebbe tre abitazioni. Si confrontano invece i pezzi:
 * numero civico uguale, CAP uguale se entrambi lo hanno, e le parole del nome
 * della via di uno contenute in quelle dell'altro ("iotti" ⊂ "nilde iotti").
 */

export interface ParsedAddress {
  /** Parole significative del nome della via, minuscole e senza accenti ("nilde", "iotti"). */
  street: string[];
  /** Tipo di via normalizzato ("via", "piazza", …), se riconosciuto. */
  kind: string | null;
  /** Numero civico normalizzato ("11", "14a"), se presente. */
  number: string | null;
  cap: string | null;
  city: string | null;
}

const STREET_KINDS: Array<[RegExp, string]> = [
  [/^(v\.?le|viale)$/, 'viale'],
  [/^(v\.?|via)$/, 'via'],
  [/^(p\.?za|p\.?zza|piazza|p\.?le|piazzale)$/, 'piazza'],
  [/^(c\.?so|corso)$/, 'corso'],
  [/^(str\.?|strada)$/, 'strada'],
  [/^(vic\.?|vicolo)$/, 'vicolo'],
  [/^(l\.?go|largo)$/, 'largo'],
  [/^(loc\.?|localita|località|frazione|fraz\.?)$/, 'localita'],
  [/^(contrada|c\.?da)$/, 'contrada'],
  [/^(borgo|lungomare|lungotevere|calle|traversa|salita|piazzetta|via\s?privata)$/, 'via'],
];

/** Parole che non distinguono una via dall'altra. */
const STOPWORDS = new Set(['di', 'del', 'della', 'dei', 'degli', 'delle', 'da', 'de', 'e', 'n', 'nr', 'num', 'civ', 'civico', 'snc', 'sn']);

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  if (!raw) return null;
  let s = stripAccents(raw).toLowerCase();
  // CAP: 5 cifre isolate. Va tolto prima di cercare il civico.
  const capMatch = s.match(/(?:^|\D)(\d{5})(?:\D|$)/);
  const cap = capMatch ? capMatch[1] : null;
  if (capMatch) s = s.replace(capMatch[1], ' ');
  // Provincia tra parentesi o in coda ("(RE)", " RE").
  s = s.replace(/\([a-z]{2}\)/g, ' ');

  const tokens = s
    .replace(/[,;:/\\-]+/g, ' ')
    .replace(/\bn\s*[.°º]\s*/g, ' n ')
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.]/g, ''))
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
  for (; i < tokens.length; i++) {
    const t = tokens[i].replace(/\.$/, '');
    if (/^\d+[a-z]?$/.test(t)) {
      number = t;
      i += 1;
      break;
    }
    // "11/a" è stato spezzato in "11" e "a": il civico è comunque il numero.
    if (!STOPWORDS.has(t) && t.length > 1) street.push(t.replace(/\./g, ''));
  }
  // Quello che resta dopo il civico è la città (senza la sigla di provincia).
  const rest = tokens
    .slice(i)
    .map((t) => t.replace(/\./g, ''))
    .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
  const city = rest.length ? rest.join(' ') : null;
  if (street.length === 0) return null;
  return { street, kind, number, cap, city };
}

/** Stesso indirizzo? Vedi il commento in testa al file. */
export function addressesMatch(a: ParsedAddress | null, b: ParsedAddress | null): boolean {
  if (!a || !b) return false;
  // Senza civico non si unisce niente: "via Roma" è in quasi ogni comune.
  if (!a.number || !b.number || a.number !== b.number) return false;
  if (a.cap && b.cap && a.cap !== b.cap) return false;
  if (a.kind && b.kind && a.kind !== b.kind) return false;
  if (!a.cap || !b.cap) {
    // Senza CAP su un lato, la città (se c'è su entrambi) deve coincidere.
    if (a.city && b.city && a.city !== b.city) return false;
  }
  const [short, long] = a.street.length <= b.street.length ? [a.street, b.street] : [b.street, a.street];
  return short.every((w) => long.includes(w));
}

const title = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());

/** Nome leggibile per una nuova abitazione: "Via Nilde Iotti 11, Correggio". */
export function householdName(raw: string): string {
  const p = parseAddress(raw);
  if (!p) return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  const street = [p.kind, ...p.street].filter(Boolean).join(' ');
  const city = p.city ? `, ${p.city.split(' ').filter((w) => w.length > 2).slice(0, 3).join(' ')}` : '';
  return title(`${street}${p.number ? ` ${p.number.toUpperCase()}` : ''}${city}`).slice(0, 120);
}

const STREET_START =
  /\b(via|viale|v\.le|piazza|p\.zza|p\.za|piazzale|corso|c\.so|strada|vicolo|largo|localit[aà]|frazione|contrada|borgo|lungomare)\b/i;

/**
 * Cerca l'indirizzo di fornitura nel testo del PDF, senza LLM.
 *
 * Si usa quando il modello non lo restituisce e per assegnare le bollette
 * caricate prima che esistessero le abitazioni. Ogni riga con un tipo di via
 * e un civico è una candidata; vince quella con l'etichetta "indirizzo di
 * fornitura" e, a parità, l'indirizzo che si ripete più volte: quello del
 * cliente compare in testata, nel riepilogo e nel dettaglio, la sede del
 * fornitore di solito una volta sola. Le righe dell'indirizzo di fatturazione
 * o della sede contano meno.
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
  type Candidate = { raw: string; parsed: ParsedAddress; score: number };
  const candidates: Candidate[] = [];
  for (const line of lines) {
    const m = line.match(STREET_START);
    if (!m || m.index === undefined) continue;
    const raw = line.slice(m.index).slice(0, 160);
    const parsed = parseAddress(raw);
    if (!parsed?.number) continue;
    let score = 1;
    if (/fornitura|ubicazione|punto di prelievo|sito in|immobile/i.test(line)) score += 10;
    if (/fatturazione|recapito|sede legale|sede operativa|s\.p\.a|s\.r\.l|spa\b|srl\b|p\.?\s?iva/i.test(line)) score -= 5;
    candidates.push({ raw, parsed, score });
  }
  if (candidates.length === 0) return null;
  // Raggruppo le candidate dello stesso indirizzo e sommo i punteggi.
  const groups: Array<{ best: Candidate; score: number }> = [];
  for (const c of candidates) {
    const g = groups.find((x) => addressesMatch(x.best.parsed, c.parsed));
    if (g) {
      g.score += c.score;
      // Come rappresentante tengo la forma più completa (con CAP e città).
      const richer = (p: ParsedAddress) => (p.cap ? 2 : 0) + (p.city ? 1 : 0) + p.street.length;
      if (richer(c.parsed) > richer(g.best.parsed)) g.best = c;
    } else {
      groups.push({ best: c, score: c.score });
    }
  }
  groups.sort((a, b) => b.score - a.score);
  return groups[0].score > 0 ? cleanAddress(groups[0].best.raw) : null;
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
