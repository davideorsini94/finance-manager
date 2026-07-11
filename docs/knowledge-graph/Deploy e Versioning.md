# Deploy e Versioning

Lo stack gira con `docker compose` ([[Infrastruttura Docker]]). Backend e frontend sono build locali taggate `:latest` nel compose; le altre immagini sono pinnate via sha256.

## Workflow di rilascio (con punto di rollback)

1. **Prima di ricostruire**, tagga le immagini correnti con la versione attuale: `docker tag finance-manager-backend:latest finance-manager-backend:<vecchia>` (idem frontend) — è il punto di rollback
2. Bump `version` in `backend/package.json` e `frontend/package.json`
3. `docker compose build backend frontend` (rigenera Prisma client + nest build + vite build)
4. Tag delle nuove immagini con la nuova versione + `docker compose up -d backend frontend`
5. Export `.tar` versionati in `docker-images-amd64/`: `docker save ... -o finance-manager-<svc>-amd64-<ver>.tar`, **senza sovrascrivere** i vecchi (i `.tar` senza versione nel nome = v0.1.0)

## Rollback

`docker tag finance-manager-backend:<vecchia> finance-manager-backend:latest` (idem frontend) poi `docker compose up -d backend frontend`; in alternativa ricaricare il `.tar` corrispondente con `docker load`.

## Note

- Il CMD di produzione del backend esegue `prisma db push --accept-data-loss` all'avvio
- Eventuali errori `tsc` locali da client Prisma stantio si risolvono nella build Docker (`prisma generate`)
- `node_modules` del frontend può essere stato installato su macOS: per buildare in locale su Linux serve `npm install --no-save @rollup/rollup-linux-x64-gnu`
