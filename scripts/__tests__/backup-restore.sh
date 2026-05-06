#!/usr/bin/env bash
set -euo pipefail

pg_dump() {
  return "${MOCK_PG_DUMP_STATUS:-0}"
}

pg_restore() {
  return "${MOCK_PG_RESTORE_STATUS:-0}"
}

mc() {
  return "${MOCK_MC_STATUS:-0}"
}

tar() {
  return "${MOCK_TAR_STATUS:-0}"
}

curl() {
  printf '{"db":"healthy","redis":"healthy","minio":"healthy"}\n'
  return "${MOCK_CURL_STATUS:-0}"
}

date() {
  if [[ "${1:-}" == '+%Y-%m-%d_%H-%M-%S' ]]; then
    printf '2026-05-06_00-00-00\n'
    return 0
  fi

  command date "$@"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TEST_MODE=1 source "$REPO_ROOT/scripts/backup.sh"
TEST_MODE=1 source "$REPO_ROOT/scripts/restore.sh"

TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

pass_count=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

set_required_env() {
  export POSTGRES_HOST=localhost
  export POSTGRES_PORT=5432
  export POSTGRES_USER=cherrywiki
  export POSTGRES_DB=cherrywiki
  export POSTGRES_PASSWORD=secret
  export MINIO_ENDPOINT=http://localhost:9000
  export MINIO_ACCESS_KEY=minio
  export MINIO_SECRET_KEY=secret
  export GRAPHIFY_OUTPUT_PATH="$TEST_TMP/graphify-output"
  export WIKI_REPO_PATH="$TEST_TMP/wiki-repo"
  export CHERRY_API_URL=http://localhost:3000
  export BACKUP_OUTPUT_PATH="$TEST_TMP/backups"
}

assert_fails_with_all() {
  local name="$1"
  shift
  local command_name="$1"
  shift
  local output
  local status
  local expected

  set +e
  output="$("$command_name" 2>&1)"
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    fail "$name expected non-zero exit"
  fi

  for expected in "$@"; do
    if [[ "$output" != *"$expected"* ]]; then
      fail "$name expected output to contain: $expected; got: $output"
    fi
  done

  pass_count=$((pass_count + 1))
  printf 'PASS: %s\n' "$name"
}

backup_missing_env_case() {
  (
    set_required_env
    unset POSTGRES_HOST
    backup_main
  )
}

backup_pg_dump_failure_case() {
  (
    set_required_env
    export MOCK_PG_DUMP_STATUS=1
    mkdir -p "$GRAPHIFY_OUTPUT_PATH" "$WIKI_REPO_PATH"
    backup_main
  )
}

restore_missing_arg_case() {
  (
    set_required_env
    restore_main
  )
}

restore_empty_dir_case() {
  (
    set_required_env
    local backup_dir="$TEST_TMP/empty-backup"
    mkdir -p "$backup_dir"
    restore_main "$backup_dir"
  )
}

restore_incomplete_dir_case() {
  (
    set_required_env
    local backup_dir="$TEST_TMP/incomplete-backup"
    mkdir -p "$backup_dir/minio"
    touch "$backup_dir/db.dump" "$backup_dir/graphify-output.tar.gz"
    restore_main "$backup_dir"
  )
}

restore_health_failure_case() {
  (
    set_required_env
    export MOCK_CURL_STATUS=1
    local backup_dir="$TEST_TMP/complete-backup"
    mkdir -p "$backup_dir/minio"
    touch "$backup_dir/db.dump" "$backup_dir/graphify-output.tar.gz" "$backup_dir/wiki-repo.tar.gz"
    restore_main "$backup_dir"
  )
}

assert_fails_with_all 'missing backup env var' backup_missing_env_case 'Required: POSTGRES_HOST'
assert_fails_with_all 'pg_dump failure aborts backup' backup_pg_dump_failure_case 'Failed: PostgreSQL backup'
assert_fails_with_all 'missing restore backup_dir argument' restore_missing_arg_case 'Required: backup_dir'
assert_fails_with_all \
  'empty backup dir lists all missing components' \
  restore_empty_dir_case \
  'Missing: db.dump' \
  'Missing: minio/' \
  'Missing: graphify-output.tar.gz' \
  'Missing: wiki-repo.tar.gz'
assert_fails_with_all \
  'incomplete backup dir lists missing component' \
  restore_incomplete_dir_case \
  'Missing: wiki-repo.tar.gz'
assert_fails_with_all 'restore health check failure aborts' restore_health_failure_case 'Failed: health check'

printf 'Passed %s backup/restore shell tests\n' "$pass_count"
