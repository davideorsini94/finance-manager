# ---------- base ----------
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --include=dev

# ---------- development ----------
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
# Compila lo seed in JS standalone così possiamo eseguirlo in produzione senza ts-node
RUN npx tsc prisma/seed.ts --outDir dist --esModuleInterop --target es2022 --module commonjs --skipLibCheck --resolveJsonModule
RUN npm prune --omit=dev

# ---------- production ----------
FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/seed.js && node dist/main.js"]
