# Finance Manager — istruzioni per Claude

App self-hosted di contabilità famigliare (React 19 + NestJS + PostgreSQL + Docker). UI e commenti in italiano.

## Grafo di conoscenza (OBBLIGATORIO)

In `docs/knowledge-graph/` c'è un vault Obsidian che descrive il progetto (architettura, backend, frontend, database, deploy, aree funzionali), con note collegate via wikilink `[[...]]`.

1. **Ad ogni richiesta**: consulta PRIMA il grafo partendo da `docs/knowledge-graph/Finance Manager.md` (la nota-hub) e segui i wikilink pertinenti alla richiesta, prima di esplorare il codice alla cieca.
2. **Dopo ogni modifica al progetto**: aggiorna il grafo —
   - aggiorna le note toccate dalla modifica (o creane di nuove, linkandole dalla hub o dalle note correlate);
   - aggiungi una riga in `docs/knowledge-graph/Registro Modifiche.md` (data, cosa, file principali).
3. Le note vanno tenute **sintetiche e fattuali** (percorsi file reali, niente dump di codice), in italiano, con wikilink tra note correlate.

## Riferimenti rapidi

- Convenzioni e pattern: `docs/knowledge-graph/Convenzioni di Sviluppo.md`
- Build/rilascio/rollback Docker: `docs/knowledge-graph/Deploy e Versioning.md`
- Vincoli iOS/PWA (app usata da iPhone in standalone): `docs/knowledge-graph/PWA e Mobile.md`
- Manuale utente: `docs/MANUALE.md`
