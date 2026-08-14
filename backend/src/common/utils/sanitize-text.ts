/**
 * Sanificazione di testo proveniente da fonti NON fidate.
 *
 * Ogni testo che entra nell'app da fuori (causali bancarie, nomi
 * ordinante/beneficiario, descrizioni dei file CSV/OFX importati) è scritto da
 * terzi: chiunque può inviare un bonifico da 0,01€ con una causale ostile. Quel
 * testo finisce poi in posti dove può fare danni: il prompt dell'LLM
 * (`CategoryAiService`, `LlmChatService`) e la chat, che rende Markdown lato
 * client. Va quindi sanificato **all'ingestione**, non al momento dell'uso.
 *
 * Cosa fa:
 *  - sostituisce i caratteri di controllo (U+0000–U+001F, U+007F — quindi anche
 *    CR/LF e TAB) con uno spazio: niente iniezione di righe finte nei prompt;
 *  - neutralizza la sintassi Markdown attiva: backtick → apostrofo, e spezza le
 *    sequenze `![` e `](` inserendo uno spazio, così immagini e link non si
 *    formano (esfiltrazione di dati via URL remota);
 *  - collassa gli spazi ripetuti, fa trim e taglia a `maxLen` caratteri.
 *
 * Funzione pura: `null`/`undefined` in ingresso → `null` in uscita.
 */
export function sanitizeExternalText(
  input: string | null | undefined,
  maxLen = 200,
): string | null {
  if (input === null || input === undefined) return null;

  let out = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/`/g, "'")
    .replace(/!\[/g, '! [')
    .replace(/]\(/g, '] (')
    .replace(/\s+/g, ' ')
    .trim();

  if (out.length > maxLen) out = out.slice(0, maxLen).trim();
  return out;
}
