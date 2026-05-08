#!/bin/sh
set -e

echo "[entrypoint] ensuring agent user for Claude Code sandbox..."
if ! id agent >/dev/null 2>&1; then
  addgroup --system --gid 10001 agent 2>/dev/null || true
  adduser --system --uid 10001 --ingroup agent --home /home/agent agent 2>/dev/null || true
fi

echo "[entrypoint] installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION:-2.1.131} 2>/dev/null || true

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
