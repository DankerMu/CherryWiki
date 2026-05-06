# Backup and Restore

CherryWiki backups contain four mandatory components:

- `db.dump`: PostgreSQL dump in custom `pg_dump -Fc` format.
- `minio/`: MinIO object mirror.
- `graphify-output.tar.gz`: Graphify output directory archive.
- `wiki-repo.tar.gz`: Wiki Repo directory archive.

Restore refuses to run unless all four components exist.

## Required Tools

- PostgreSQL client tools: `pg_dump`, `pg_restore`
- MinIO Client: `mc`
- Standard CLI tools: `tar`, `curl`

## Environment Variables

Required for backup and restore:

| Variable | Description |
| --- | --- |
| `POSTGRES_HOST` | PostgreSQL host |
| `POSTGRES_PORT` | PostgreSQL port |
| `POSTGRES_USER` | PostgreSQL user |
| `POSTGRES_DB` | PostgreSQL database name |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `MINIO_ENDPOINT` | MinIO endpoint, for example `http://localhost:9000` |
| `MINIO_ACCESS_KEY` | MinIO access key |
| `MINIO_SECRET_KEY` | MinIO secret key |
| `GRAPHIFY_OUTPUT_PATH` | Graphify output directory to back up and restore |
| `WIKI_REPO_PATH` | Wiki Repo directory to back up and restore |

Required for restore only:

| Variable | Description |
| --- | --- |
| `CHERRY_API_URL` | CherryWiki API base URL used for `/api/admin/system/health` |

Optional:

| Variable | Description |
| --- | --- |
| `BACKUP_OUTPUT_PATH` | Parent directory for timestamped backups. Defaults to `./backups`. |

## Backup

```bash
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=cherrywiki
export POSTGRES_DB=cherrywiki
export POSTGRES_PASSWORD=change-me
export MINIO_ENDPOINT=http://localhost:9000
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export GRAPHIFY_OUTPUT_PATH=/var/lib/cherrywiki/graphify-output
export WIKI_REPO_PATH=/var/lib/cherrywiki/wiki-repo
export BACKUP_OUTPUT_PATH=/var/backups/cherrywiki

./scripts/backup.sh
```

The script prints the timestamped backup directory on success.

## Restore

```bash
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=cherrywiki
export POSTGRES_DB=cherrywiki
export POSTGRES_PASSWORD=change-me
export MINIO_ENDPOINT=http://localhost:9000
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export GRAPHIFY_OUTPUT_PATH=/var/lib/cherrywiki/graphify-output
export WIKI_REPO_PATH=/var/lib/cherrywiki/wiki-repo
export CHERRY_API_URL=http://localhost:3000

./scripts/restore.sh /var/backups/cherrywiki/2026-05-06_02-00-00
```

Restore runs `pg_restore --clean --if-exists`, mirrors MinIO objects back to `cherrywiki/`, extracts both archives, then calls the health endpoint.

## Daily Cron With 7-Day Retention

Store production secrets in a root-readable env file such as `/etc/cherrywiki/backup.env`, then schedule:

```cron
0 2 * * * /bin/bash -lc 'cd /opt/cherrywiki && set -a && . /etc/cherrywiki/backup.env && set +a && BACKUP_OUTPUT_PATH=/var/backups/cherrywiki ./scripts/backup.sh >> /var/log/cherrywiki-backup.log 2>&1 && find /var/backups/cherrywiki -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;'
```
