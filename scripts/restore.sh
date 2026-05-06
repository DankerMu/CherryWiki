#!/usr/bin/env bash
set -euo pipefail

RESTORE_REQUIRED_ENV_VARS=(
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
  CHERRY_API_URL
)

restore_require_env_vars() {
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

restore_run_step() {
  local label="$1"
  shift

  printf 'Starting: %s\n' "$label" >&2
  if ! "$@"; then
    printf 'Failed: %s\n' "$label" >&2
    return 1
  fi
}

restore_validate_components() {
  local BACKUP_DIR="$1"
  local missing=0

  if [[ ! -f "$BACKUP_DIR/db.dump" ]]; then
    printf 'Missing: db.dump\n' >&2
    missing=1
  fi

  if [[ ! -d "$BACKUP_DIR/minio" ]]; then
    printf 'Missing: minio/\n' >&2
    missing=1
  fi

  if [[ ! -f "$BACKUP_DIR/graphify-output.tar.gz" ]]; then
    printf 'Missing: graphify-output.tar.gz\n' >&2
    missing=1
  fi

  if [[ ! -f "$BACKUP_DIR/wiki-repo.tar.gz" ]]; then
    printf 'Missing: wiki-repo.tar.gz\n' >&2
    missing=1
  fi

  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
}

restore_extract_archive() {
  local label="$1"
  local archive_path="$2"
  local target_path="$3"

  rm -rf "$target_path"
  mkdir -p "$target_path"
  restore_run_step "$label" tar xzf "$archive_path" -C "$target_path" --strip-components=1
}

restore_health_check() {
  local health_url="${CHERRY_API_URL%/}/api/admin/system/health"
  local response

  printf 'Starting: health check\n' >&2
  if ! response="$(curl --fail --silent --show-error "$health_url")"; then
    printf 'Failed: health check\n' >&2
    return 1
  fi

  if [[ "$response" == *unhealthy* || "$response" == *'"status":"error"'* || "$response" == *'"status": "error"'* ]]; then
    printf 'Failed: health check\n' >&2
    printf '%s\n' "$response" >&2
    return 1
  fi

  printf 'Health: %s\n' "$response"
}

restore_main() {
  set -euo pipefail

  local BACKUP_DIR="${1:-}"
  if [[ -z "$BACKUP_DIR" ]]; then
    printf 'Required: backup_dir\n' >&2
    return 1
  fi

  if [[ ! -d "$BACKUP_DIR" ]]; then
    printf 'Not found: %s\n' "$BACKUP_DIR" >&2
    return 1
  fi

  restore_validate_components "$BACKUP_DIR" || return 1
  restore_require_env_vars "${RESTORE_REQUIRED_ENV_VARS[@]}" || return 1

  export PGPASSWORD="$POSTGRES_PASSWORD"
  restore_run_step \
    'PostgreSQL restore' \
    pg_restore \
    --clean \
    --if-exists \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    "$BACKUP_DIR/db.dump" || return 1

  restore_run_step \
    'MinIO alias configuration' \
    mc alias set cherrywiki "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" || return 1
  restore_run_step \
    'MinIO restore' \
    mc mirror "$BACKUP_DIR/minio/" cherrywiki/ || return 1

  restore_extract_archive 'Graphify output restore' "$BACKUP_DIR/graphify-output.tar.gz" "$GRAPHIFY_OUTPUT_PATH" || return 1
  restore_extract_archive 'Wiki repo restore' "$BACKUP_DIR/wiki-repo.tar.gz" "$WIKI_REPO_PATH" || return 1

  restore_health_check || return 1
  printf 'Restore succeeded\n'
}

if [[ "${TEST_MODE:-}" != "1" ]]; then
  restore_main "$@"
fi
