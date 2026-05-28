/**
 * CSV parser minimalista — niente dipendenze esterne. Gestisce:
 *  - delimiter custom (`,` `;` `\t`)
 *  - quote `"` con escape `""`
 *  - newline CRLF/LF
 *  - header opzionale
 *
 * Per CSV "complicati" (multilinea con CR/LF dentro virgolette su PC vecchi)
 * sostituibile con `papaparse` mantenendo la stessa firma.
 */
export interface ParseCsvOptions {
  delimiter?: string;
  hasHeader?: boolean;
}

export interface ParsedCsv {
  header: string[] | null;
  rows: string[][];
}

export function parseCsv(input: string, opts: ParseCsvOptions = {}): ParsedCsv {
  const delim = opts.delimiter ?? autoDetectDelimiter(input);
  const lines = splitCsvLines(input);
  const allRows = lines.map((l) => splitCsvLine(l, delim)).filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''));
  if (allRows.length === 0) return { header: null, rows: [] };
  const header = opts.hasHeader === false ? null : allRows[0];
  const rows = opts.hasHeader === false ? allRows : allRows.slice(1);
  return { header, rows };
}

function autoDetectDelimiter(text: string): string {
  const sample = text.slice(0, 4000);
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 } as Record<string, number>;
  for (const ch of sample) if (ch in counts) counts[ch]++;
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) || ',';
}

function splitCsvLines(text: string): string[] {
  // mantiene CRLF dentro virgolette
  const out: string[] = [];
  let buf = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // doppia virgoletta = escape
      if (inQ && text[i + 1] === '"') {
        buf += '""';
        i++;
        continue;
      }
      inQ = !inQ;
      buf += c;
    } else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      out.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.length) out.push(buf);
  return out;
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          inQ = false;
        }
      } else buf += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === delim) {
        out.push(buf);
        buf = '';
      } else buf += c;
    }
  }
  out.push(buf);
  return out.map((s) => s.trim());
}

// ---------- Parsers di campo ----------

/** Parse data accettando IT (DD/MM/YYYY) e ISO (YYYY-MM-DD). */
export function parseDate(input: string, format?: string): Date | null {
  if (!input) return null;
  const s = input.trim();
  // ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  // IT con separatori vari
  const it = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
  if (it) {
    let y = +it[3];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return new Date(Date.UTC(y, +it[2] - 1, +it[1]));
  }
  return null;
}

/** Parse importo decimale italiano o anglo. Restituisce centesimi BigInt. */
export function parseAmountCents(input: string, decimalSep: string = ','): bigint | null {
  if (!input) return null;
  let s = input.trim();
  // Rimuovi simboli € $ £ e spazi
  s = s.replace(/[€$£\s]/g, '');
  // Rimuovi separatori migliaia (l'opposto di decimalSep)
  const thousandSep = decimalSep === ',' ? '.' : ',';
  s = s.split(thousandSep).join('');
  // Normalizza il separatore decimale
  s = s.replace(decimalSep, '.');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * 100));
}
