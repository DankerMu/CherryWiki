# Deployment Architecture

CherryWiki runs as a set of Docker containers orchestrated via docker-compose.

## Service Components

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| cherry-api | custom | 8080 | NestJS REST API |
| cherry-web | custom | 5173 | Vite React frontend |
| postgres | pgvector/pgvector:pg16 | 5432 | Primary database with vector extension |
| redis | redis:8-alpine | 6379 | Job queues and caching |
| minio | minio/minio:latest | 9000/9001 | Object storage (S3-compatible) |
| ingestion-worker | custom Python | 9091 | Document parsing (PDF, DOCX) |
| graphify-worker | custom Python | 9094 | Knowledge graph extraction |
| indexer-worker | node:20-slim | 9093 | Embedding and BM25 indexing |
| wiki-sync-worker | node:20-slim | — | Docmost synchronization |
| nginx | nginx:alpine | 80 | Reverse proxy and TLS termination |

## Health Checks

Every service exposes a health endpoint:
- API: `GET /api/health` returns `{"status":"ok","version":"..."}`
- Workers: HTTP health endpoints on their respective ports
- Database: `pg_isready` command
- Redis: `redis-cli ping`
- MinIO: `GET /minio/health/live`

## Environment Variables

Key configuration via `.env`:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`: Object storage credentials
- `JWT_SECRET`: Token signing key (min 32 characters)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: Initial admin credentials for seed

## Database Migrations

Migrations managed by Drizzle Kit:
- `pnpm db:generate` — Generate migration files from schema changes
- `pnpm db:migrate` — Apply pending migrations
- Migration files in `schemas/migrations/` (tracked in git)
