#!/bin/sh
set -e

echo "[entrypoint] enabling corepack..."
corepack enable

echo "[entrypoint] installing dependencies..."
pnpm install --frozen-lockfile

echo "[entrypoint] building..."
pnpm build

echo "[entrypoint] running database migrations..."
pnpm drizzle-kit migrate

echo "[entrypoint] running seed (idempotent)..."
node --import tsx schemas/seed.ts

echo "[entrypoint] starting cherry-api..."
exec node apps/api/dist/main.js
