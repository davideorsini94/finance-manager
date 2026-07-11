# Architettura

Stack a 6 servizi orchestrati con Docker Compose (vedi [[Infrastruttura Docker]]), esposti da nginx e raggiungibili via [[Tailscale e Accesso]].

```
Browser/PWA ──HTTPS (Tailscale Funnel)──▶ nginx :80
                                            ├── /api/* ──▶ backend (NestJS :3000)
                                            └── /*     ──▶ frontend (React SPA)
backend ──▶ postgres 16 (dati) · minio (allegati) · ollama (LLM qwen2.5:7b)
```

## Componenti

| Componente | Tecnologia | Nota |
|---|---|---|
| [[Frontend]] | React 19 + Vite + TS + Tailwind + shadcn/ui | SPA + [[PWA e Mobile]] |
| [[Backend]] | NestJS + Prisma | API REST + SSE |
| [[Database]] | PostgreSQL 16 | via Prisma ORM |
| Storage allegati | MinIO (S3-compatible) | presigned URL |
| LLM | Ollama `qwen2.5:7b-instruct-q4_K_M` | per [[Chat LLM]] e [[Import CSV-OFX]] |
| Reverse proxy | nginx 1.27-alpine | gzip, SSE senza buffering, body max 25 MB |

## Flussi trasversali

- Autenticazione con cookie httpOnly e refresh rotation → [[Autenticazione e Sicurezza]]
- Notifiche in-app e chat via SSE (nginx con buffering off)
- Modalità demo: il frontend intercetta le API con handler mock senza toccare il DB (`frontend/src/lib/demo/`)
