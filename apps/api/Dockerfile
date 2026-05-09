FROM node:20-slim AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 10001 agent \
 && adduser --system --uid 10001 --ingroup agent --home /home/agent agent

ARG CLAUDE_CODE_VERSION=2.1.131
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
ENV DISABLE_AUTOUPDATER=1

RUN corepack enable

WORKDIR /app

# ── dependency resolution ──
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY packages/shared/package.json      packages/shared/
COPY packages/ai-core/package.json     packages/ai-core/
COPY packages/auth-core/package.json   packages/auth-core/
COPY packages/graph-core/package.json  packages/graph-core/
COPY packages/job-core/package.json    packages/job-core/
COPY packages/rag-core/package.json    packages/rag-core/
COPY packages/wiki-core/package.json   packages/wiki-core/

COPY apps/api/package.json             apps/api/

RUN pnpm install --frozen-lockfile

# ── build ──
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY schemas/ schemas/
COPY drizzle.config.ts ./

RUN pnpm build

# ── runtime ──
FROM base AS runtime

WORKDIR /app

COPY --from=build /app ./
COPY tools/ tools/
RUN pip3 install --no-cache-dir --break-system-packages tools/cherrywiki tools/cherrydb

EXPOSE 8080

CMD ["sh", "/app/ops/entrypoint-api.sh"]
