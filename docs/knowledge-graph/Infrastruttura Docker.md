# Infrastruttura Docker

Stack orchestrato da `docker-compose.yml` (prod) + `docker-compose.dev.yml` (override dev con hot-reload). Rete bridge interna `fm-net`; solo nginx è esposto (porta `HTTP_PORT` da `.env`, default 80).

## Servizi

| Servizio | Immagine | Ruolo | Volume |
|---|---|---|---|
| postgres | postgres:16-alpine (pinnata sha256) | [[Database]] | `postgres_data` |
| minio | minio/minio (pinnata) | allegati S3-compatible | `minio_data` |
| ollama | ollama/ollama:0.23.0 | LLM locale per [[Chat LLM]] (limite 8 GB RAM, auto-pull modello da `OLLAMA_MODEL`) | `ollama_data` |
| backend | build da `./backend` | API [[Backend]] :3000 interno | — |
| frontend | build da `./frontend` | SPA [[Frontend]] :80 interno | — |
| nginx | nginx:1.27-alpine (pinnata) | reverse proxy | `nginx/nginx.conf` |

## nginx (`nginx/nginx.conf`)

- `/api/*` → backend:3000, tutto il resto → frontend
- gzip attivo; `client_max_body_size 25m` (allegati); **buffering off** per gli stream SSE (chat/notifiche)
- TLS-ready ma la terminazione HTTPS è delegata a [[Tailscale e Accesso]]

## Dev mode

`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`: backend `start:dev` con mount di `src/`, `prisma/`, `test/`; frontend `vite dev --host` con mount di `src/`, `public/`.

Build, versioning e rollback → [[Deploy e Versioning]].
