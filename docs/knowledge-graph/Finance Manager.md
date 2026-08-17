---
tags: [hub]
---

# Finance Manager

Webapp **self-hosted, multi-utente, mobile-first** per la contabilità famigliare: conti, movimenti, giroconti, carte di credito, ricorrenze, budget, obiettivi di risparmio, report, import CSV/OFX e chat con LLM locale.

Questa è la nota-hub del grafo di conoscenza: da qui si raggiunge tutto il resto.

## Mappa del grafo

- [[Architettura]] — stack e componenti ad alto livello
- [[Frontend]] — React SPA (pagine, feature, store, UI)
- [[Backend]] — API NestJS (moduli, servizi, cron)
- [[Database]] — schema Prisma/PostgreSQL
- [[API]] — mappa degli endpoint REST
- [[Autenticazione e Sicurezza]] — JWT, ACL, hardening
- [[Infrastruttura Docker]] — compose, nginx, volumi
- [[Tailscale e Accesso]] — come l'app è esposta su HTTPS
- [[PWA e Mobile]] — service worker, safe-area, fix iOS
- [[Deploy e Versioning]] — build, tag, rollback
- [[Convenzioni di Sviluppo]] — pattern e regole del progetto
- [[Registro Modifiche]] — log delle modifiche fatte nel tempo

### Aree funzionali principali

- [[Pagina Dashboard]] — home: KPI, filtri e torta per categoria (entrate/uscite)
- [[Pagina Movimenti]] — la pagina più usata (filtri, card conti, quick-add)
- [[Condivisione Conti]] — membri, inviti, ruoli
- [[Chat LLM]] — Ollama + tool calling
- [[Import CSV-OFX]] — wizard di importazione con suggerimenti AI
- [[Sync Bancario]] — collegamento conti↔banche via Enable Banking, feature completa: consenso/mapping conti, motore di sync (dedup, quota, notifiche), categorizzazione LLM + rilevamento giroconti + pagina di revisione, rinnovo consenso e riconciliazione saldi → piano originale in [[Sync Bancario (Piano)]]

## Fatti chiave

- URL di produzione: `https://jarvis.tail5c15a9.ts.net` (vedi [[Tailscale e Accesso]])
- Lingua UI: italiano (con i18n IT/EN)
- Root del progetto: `/home/jarvis/workspace/finance-manager` (server di produzione); clone di sviluppo su Mac: `/Users/davideorsini/workspace/finance-manager`
- Documentazione utente: `docs/MANUALE.md`; brief design: `docs/UI-SPECS.md`
