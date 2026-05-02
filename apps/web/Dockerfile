FROM node:20-slim AS base

RUN corepack enable

WORKDIR /app

# Copy workspace root configs needed by pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy only web app package.json for dependency resolution
# Stub other workspace packages so pnpm doesn't complain
COPY apps/web/package.json apps/web/package.json
RUN find apps -mindepth 1 -maxdepth 1 -not -name web -exec rm -rf {} +  2>/dev/null; true

# Install dependencies (cached unless package.json or lockfile changes)
RUN pnpm install --frozen-lockfile

# Copy web source code
COPY apps/web/ apps/web/

WORKDIR /app/apps/web

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0"]
