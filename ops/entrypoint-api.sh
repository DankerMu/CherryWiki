#!/bin/sh
set -e

echo "[entrypoint] running database migrations..."
pnpm drizzle-kit migrate

echo "[entrypoint] running seed (idempotent)..."
node --import tsx schemas/seed.ts

echo "[entrypoint] starting cherry-api..."
exec node apps/api/dist/main.js
