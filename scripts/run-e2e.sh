#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/tests/e2e/logs"
mkdir -p "$LOG_DIR"

MODE="ci"
for arg in "$@"; do
  case "$arg" in
    --local) MODE="local" ;;
    --help|-h)
      echo "Usage: $0 [--local]"
      echo "  --local   Skip Docker cleanup/rebuild, reuse running services"
      echo "  (default) CI mode: clean → rebuild → start → migrate → test → collect logs"
      exit 0
      ;;
  esac
done

log() { echo "[e2e] $(date '+%H:%M:%S') $*"; }

wait_healthy() {
  local service="$1"
  local url="$2"
  local max_wait="${3:-120}"
  local elapsed=0

  log "Waiting for $service at $url (max ${max_wait}s)..."
  while ! curl -sf "$url" > /dev/null 2>&1; do
    sleep 2
    elapsed=$((elapsed + 2))
    if [ "$elapsed" -ge "$max_wait" ]; then
      log "ERROR: $service did not become healthy within ${max_wait}s"
      return 1
    fi
  done
  log "$service healthy (${elapsed}s)"
}

collect_logs() {
  log "Collecting service logs..."
  docker compose -f "$PROJECT_DIR/docker-compose.yml" logs --no-color > "$LOG_DIR/services.log" 2>&1 || true
  log "Logs saved to $LOG_DIR/services.log"
}

# --- CI mode: cleanup + rebuild + start ---
if [ "$MODE" = "ci" ]; then
  log "CI mode: cleaning up..."
  cd "$PROJECT_DIR"

  docker compose down --volumes --remove-orphans 2>&1 | tee "$LOG_DIR/cleanup.log" || true

  log "Rebuilding images (no-cache)..."
  docker compose build --no-cache 2>&1 | tee "$LOG_DIR/build.log"
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    log "ERROR: Image build failed. See $LOG_DIR/build.log"
    exit 1
  fi

  log "Starting services..."
  docker compose up -d 2>&1 | tee "$LOG_DIR/startup.log"
fi

# --- Wait for services ---
cd "$PROJECT_DIR"
log "Checking service health..."

wait_healthy "PostgreSQL" "http://127.0.0.1:15432" 30 2>/dev/null || \
  (pg_isready -h 127.0.0.1 -p 15432 -U cherrygraph -d cherrygraph -t 30 2>/dev/null || \
   log "WARN: PostgreSQL health check via HTTP failed, trying psql..." && \
   until docker compose exec -T postgres pg_isready -U cherrygraph 2>/dev/null; do sleep 2; done)

wait_healthy "MinIO" "http://127.0.0.1:9000/minio/health/live" 60
wait_healthy "Cherry API" "http://127.0.0.1:8081/api/health" 120

log "All core services healthy."

# --- Database migration + seed ---
log "Running migrations..."
export DATABASE_URL="postgresql://cherrygraph:cherrygraph_dev@127.0.0.1:15432/cherrygraph"
cd "$PROJECT_DIR"
pnpm drizzle-kit migrate 2>&1 | tee "$LOG_DIR/migrate.log"

log "Running seed..."
npx tsx schemas/seed.ts 2>&1 | tee "$LOG_DIR/seed.log"

# --- Run E2E tests ---
log "Running E2E tests..."
export E2E=true
export MINIO_ENDPOINT="http://127.0.0.1:9000"
export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin_dev_secret}"
export REDIS_URL="redis://127.0.0.1:6379"
export API_BASE_URL="http://127.0.0.1:8081"

TEST_EXIT=0
pnpm exec vitest run tests/e2e/ --config tests/e2e/vitest.config.e2e.ts 2>&1 | tee "$LOG_DIR/test-output.log" || TEST_EXIT=$?

if [ "$TEST_EXIT" -ne 0 ]; then
  log "E2E tests FAILED (exit code $TEST_EXIT)"
  collect_logs
  exit "$TEST_EXIT"
fi

log "E2E tests PASSED"
exit 0
