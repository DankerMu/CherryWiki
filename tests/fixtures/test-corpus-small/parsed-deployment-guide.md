# Deployment Guide

## Prerequisites

- Docker Engine 24+
- Docker Compose v2
- 4 GB RAM minimum (8 GB recommended)
- 20 GB disk space

## Quick Start

```bash
cp .env.example .env
# Edit .env with your secrets
docker compose up -d
```

## Service Architecture

CherryGraph Studio runs as a set of Docker containers:

| Service | Port | Purpose |
|---|---|---|
| cherry-api | 8080 | NestJS API server |
| cherry-web | 3001 | React frontend |
| postgres | 5432 | Primary database |
| redis | 6379 | Cache and job queues |
| minio | 9000 | Object storage |
| ingestion-worker | 9090 | Document parsing |
| url-fetcher-worker | 9091 | URL content fetching |
| graphify-worker | 9092 | Knowledge graph generation |

## Health Checks

All services expose health check endpoints:

- API: `GET /api/health`
- Workers: `GET /health` on their respective health ports

Docker Compose configures automatic health checks with 10-second intervals and 3 retries before marking a container unhealthy.

## Backup Strategy

### Database

PostgreSQL backups should run daily via `pg_dump`. Retain at least 7 daily backups and 4 weekly backups.

### Object Storage

MinIO data resides in the `minio-data` Docker volume. Back up this volume alongside database backups to ensure consistency between metadata and stored files.
