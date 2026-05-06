#!/usr/bin/env bash
set -euo pipefail

BACKUP_REQUIRED_ENV_VARS=(
  POSTGRES_HOST
  POSTGRES_PORT
  POSTGRES_USER
  POSTGRES_DB
  POSTGRES_PASSWORD
  MINIO_ENDPOINT
  MINIO_ACCESS_KEY
  MINIO_SECRET_KEY
  GRAPHIFY_OUTPUT_PATH
  WIKI_REPO_PATH
)

backup_require_env_vars() {
  local missing=0
  local var_name

  for var_name in "$@"; do
    if [[ -z "${!var_name:-}" ]]; then
      printf 'Required: %s\n' "$var_name" >&2
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
}

backup_run_step() {
  local label="$1"
  shift

  printf 'Starting: %s\n' "$label" >&2
  if ! "$@"; then
    printf 'Failed: %s\n' "$label" >&2
    return 1
  fi
}

backup_remove_partial() {
  local backup_dir="$1"

  if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
    rm -rf "$backup_dir"
    printf 'Failed: backup incomplete, removed: %s\n' "$backup_dir" >&2
  fi
}

backup_run_backup_step() {
  local backup_dir="$1"
  shift

  if ! backup_run_step "$@"; then
    backup_remove_partial "$backup_dir"
    return 1
  fi
}

backup_main() {
  set -euo pipefail

  backup_require_env_vars "${BACKUP_REQUIRED_ENV_VARS[@]}" || return 1

  local BACKUP_DIR="${BACKUP_OUTPUT_PATH:-./backups}/$(date +%Y-%m-%d_%H-%M-%S)"
  mkdir -p "$BACKUP_DIR"

  export PGPASSWORD="$POSTGRES_PASSWORD"
  backup_run_backup_step \
    "$BACKUP_DIR" \
    'PostgreSQL backup' \
    pg_dump \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -Fc \
    -f "$BACKUP_DIR/db.dump" || return 1

  backup_run_backup_step \
    "$BACKUP_DIR" \
    'MinIO alias configuration' \
    mc alias set cherrywiki "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" || return 1
  backup_run_backup_step \
    "$BACKUP_DIR" \
    'MinIO backup' \
    mc mirror cherrywiki/ "$BACKUP_DIR/minio/" || return 1

  local graphify_parent
  local graphify_name
  graphify_parent="$(dirname "$GRAPHIFY_OUTPUT_PATH")"
  graphify_name="$(basename "$GRAPHIFY_OUTPUT_PATH")"
  backup_run_backup_step \
    "$BACKUP_DIR" \
    'Graphify output backup' \
    tar czf "$BACKUP_DIR/graphify-output.tar.gz" -C "$graphify_parent" "$graphify_name" || return 1

  local wiki_parent
  local wiki_name
  wiki_parent="$(dirname "$WIKI_REPO_PATH")"
  wiki_name="$(basename "$WIKI_REPO_PATH")"
  backup_run_backup_step \
    "$BACKUP_DIR" \
    'Wiki repo backup' \
    tar czf "$BACKUP_DIR/wiki-repo.tar.gz" -C "$wiki_parent" "$wiki_name" || return 1

  printf '%s\n' "$BACKUP_DIR"
}

if [[ "${TEST_MODE:-}" != "1" ]]; then
  backup_main "$@"
fi
