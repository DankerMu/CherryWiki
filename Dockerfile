# ============================================================
# CherryWiki Multi-Target Dockerfile
# Uses pnpm deploy to create self-contained app bundles
# ============================================================

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

# ---- Install all workspace deps ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/auth-core/package.json packages/auth-core/
COPY packages/job-core/package.json packages/job-core/
COPY packages/wiki-core/package.json packages/wiki-core/
COPY packages/rag-core/package.json packages/rag-core/
COPY packages/graph-core/package.json packages/graph-core/
COPY packages/ai-core/package.json packages/ai-core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/ingestion-worker/package.json apps/ingestion-worker/
COPY apps/url-fetcher-worker/package.json apps/url-fetcher-worker/
COPY apps/indexer-worker/package.json apps/indexer-worker/
RUN pnpm install --frozen-lockfile

# ---- Build all TypeScript + Vite ----
FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY apps/ apps/
COPY schemas/ schemas/
COPY drizzle.config.ts ./
RUN pnpm build

# ---- Deploy: create self-contained bundles per app ----
FROM build AS deploy
RUN pnpm deploy --legacy --filter=@cherrygraph/api /deploy/api
RUN pnpm deploy --legacy --filter=@cherrygraph/ingestion-worker --prod /deploy/ingestion-worker
RUN pnpm deploy --legacy --filter=@cherrygraph/url-fetcher-worker --prod /deploy/url-fetcher-worker
RUN pnpm deploy --legacy --filter=@cherrygraph/indexer-worker --prod /deploy/indexer-worker
# Copy migration/seed assets into api bundle
RUN cp -r /app/schemas /deploy/api/schemas && \
    cp /app/drizzle.config.ts /deploy/api/ && \
    cp /app/tsconfig.base.json /deploy/api/ && \
    mkdir -p /deploy/api/packages/shared/src && \
    cp -r /app/packages/shared/src/schema /deploy/api/packages/shared/src/schema

# ============================================================
# Target: api
# ============================================================
FROM base AS api
COPY --from=deploy /deploy/api /app
ENV PATH="/app/node_modules/.bin:$PATH"
EXPOSE 8080
CMD ["sh", "-c", "drizzle-kit migrate && node --import tsx schemas/seed.ts && exec node dist/main.js"]

# ============================================================
# Target: web (nginx serving static build)
# ============================================================
FROM nginx:alpine AS web
COPY ops/nginx/nginx-prod-web.conf /etc/nginx/nginx.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

# ============================================================
# Target: ingestion-worker
# ============================================================
FROM base AS ingestion-worker
COPY --from=deploy /deploy/ingestion-worker /app
EXPOSE 9091
CMD ["node", "dist/main.js"]

# ============================================================
# Target: url-fetcher-worker
# ============================================================
FROM base AS url-fetcher-worker
COPY --from=deploy /deploy/url-fetcher-worker /app
EXPOSE 9092
CMD ["node", "dist/main.js"]

# ============================================================
# Target: indexer-worker
# ============================================================
FROM base AS indexer-worker
COPY --from=deploy /deploy/indexer-worker /app
EXPOSE 9093
CMD ["node", "dist/main.js"]
