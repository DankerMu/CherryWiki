# Design: Entropy Governance

## Context

The entropy baseline at `.entropy-baseline/latest.json` records the current code-shape risks. The highest-risk patterns are:

- `apps/api/src/chat/chat.service.ts` combines session lifecycle, multi-space scope, ACL, model resolution, static RAG, GraphRAG, rerank, agent routing, persistence, trace writing, and SSE shaping.
- `apps/web/src/pages/Chat.tsx` combines page state, session list, multi-space selector, model availability, database toggle, message rendering, citations, source chain display, and layout behavior.
- API modules use a consistent global exception filter but still replicate local `throwApiError` helpers and sometimes use string error codes outside `packages/shared/src/errors.ts`.
- `apps/ingestion-worker/src/job_client.py` and `apps/url-fetcher-worker/src/job_client.py` duplicate the worker claim/progress/heartbeat/fail/complete protocol.
- Critical implementation directories do not yet have scoped `AGENTS.md` files despite root instructions recommending them.

This change is a refactor/governance stage. It must preserve product behavior while reducing future replication risk.

## Goals / Non-Goals

**Goals:**

- Make future Chat backend work land in bounded services rather than continuing to expand `ChatService`.
- Ensure API error codes and error construction follow a single contract.
- Make the Chat frontend easier to extend by separating state hooks from rendering components.
- Reduce worker lifecycle protocol duplication between ingestion and URL fetch workers.
- Give agents local instructions for API, Web, Worker, Packages, and Tools boundaries.
- Keep each implementation issue small enough for a focused PR and clear verification.

**Non-Goals:**

- No user-visible Chat UX redesign.
- No route, SSE event, DTO, or database schema change unless a regression test proves the current contract requires a type-only correction.
- No replacement of NestJS, React, Ant Design, worker runtime, or queue infrastructure.
- No broad formatting-only churn.
- No refactor of `external/*` reference/fork code.

## Decisions

### Decision 1: Behavior-preserving slices before structural moves

Each refactor slice must first identify existing behavior and add or reuse regression coverage before moving code. This is required for `ChatService`, `Chat.tsx`, and worker protocol migration because each module sits on a user-facing or pipeline-critical path.

Alternative considered: split files first and rely on current tests. Rejected because current hotspots contain several intertwined behaviors; moving code without targeted characterization can mask regressions behind unrelated passing tests.

### Decision 2: API error helper belongs in API common code, while codes belong in shared

Create or reuse a helper under `apps/api/src/common/**` for throwing `HttpException` with `{ code, message, details? }`. Canonical error code values must live in `packages/shared/src/errors.ts`. Services may import the helper but must not define new local `throwApiError` helpers.

Alternative considered: put the helper in `packages/shared`. Rejected because NestJS `HttpException` is an API-framework concern; `packages/shared` should stay framework-neutral.

### Decision 3: Chat backend split keeps `ChatService` as orchestration boundary

`ChatService` remains the public service consumed by `ChatController`, but internal responsibilities move behind injected or locally constructed collaborators:

- session/scope/permission behavior
- model resolution and provider config behavior
- static retrieval, graph context, RRF, rerank behavior
- agent route/dispatch behavior
- trace/usage persistence behavior

The split can happen across multiple PRs. Intermediate states are acceptable only if every PR remains buildable, tested, and behavior-preserving.

### Decision 4: Web Chat split uses hooks for state and components for rendering

The Chat page should become a thin composition boundary. Session loading/deletion, space scope/settings, model availability gating, and message/citation rendering should move into focused hooks/components. Existing visual structure and i18n keys must remain stable unless a test or accessibility bug requires a localized change.

### Decision 5: Python worker protocol extraction must respect separate worker deployability

The shared worker protocol may be implemented as a small shared Python package, a local module copied through build context, or a documented template enforced by tests. The chosen implementation must work in Docker, local venv tests, and CI for both ingestion and URL fetch workers.

Preference: a small shared package if Docker/venv wiring stays simple. If package wiring causes deployment complexity, a protocol test/template approach is acceptable for this stage.

### Decision 6: Scoped `AGENTS.md` files describe boundaries, not new policy exceptions

Scoped instructions must be more specific than root rules and cannot relax root safety, Python venv, Docker, test, or completeness requirements. They should capture module-specific verification commands, ownership boundaries, and common pitfalls.

## Risks / Trade-offs

- **Risk: refactor churn creates behavioral regressions** → Add characterization tests before moving code and run narrow regression suites for each module.
- **Risk: Chat backend split becomes one oversized PR** → Split into session/scope and retrieval/rerank issues with explicit dependencies.
- **Risk: shared Python worker package complicates Docker builds** → Validate Dockerfile/CI wiring in the common-package issue before migrating both workers.
- **Risk: scoped instructions become stale** → Keep files short, module-specific, and focused on commands/boundaries rather than duplicating root rules.
- **Risk: error-code normalization changes public error codes** → Preserve existing response codes unless the current code is a local string not listed in shared `ErrorCode`; add tests for any promoted code.
- **Risk: error helper migration changes HTTP status while preserving envelope shape** → Inventory each migrated call site and assert representative 400/401/403/404/409/422/500 status behavior through common-filter tests or focused service/controller tests.

## Migration Plan

0. Update `docs/project/26_需求追踪矩阵.md` for this governance stage before implementation issues start. Pure refactor rows must explicitly use `N/A（不新增/不变更）` for API or Schema columns rather than leaving blanks.
1. Add scoped module instructions first; this reduces future implementation drift and is low-risk.
2. Inventory API error helper call sites and local string codes, then normalize the common helper and `ErrorCode` before larger API Chat refactors.
3. Split API Chat into small chains: session/scope/permission first, retrieval/graph/RRF/rerank second, model/provider and Agent routing third, persistence/SSE shaping last.
4. Split Web Chat into hooks/components after existing Chat tests are strengthened, with database gating, source-chain rendering, and layout behavior covered.
5. Resolve the Python worker protocol strategy in a decision-only issue, then introduce the chosen common/enforced layer and migrate ingestion and URL fetch workers separately.
6. Re-run targeted tests after each issue; only run full workspace gates when the touched layer warrants it.

## Open Questions

- None for #421-#423. Issue #420 decided the Python worker protocol strategy below.

## Issue #420 Python Worker Protocol Decision

Use a small shared Python package as the worker job lifecycle protocol source of
truth.

Chosen package path for downstream implementation:
`packages/python-worker-protocol/`, exposing an importable package named
`cherry_worker_protocol`.

The ingestion and URL fetch workers will keep worker-specific parser/fetcher
handlers, error classes, result payloads, health ports, environment variables,
and SSRF/parser behavior in their own app trees. The shared package will own
only the lifecycle protocol currently duplicated in both `job_client.py` files:
API base URL normalization, pending-job polling response parsing, progress,
completion, failure reporting, heartbeat payload shape, worker-id generation,
`run_once`, `poll_jobs`, heartbeat thread startup, terminal-state retryability
selection, and active-job cleanup.

### Inspected Constraints

- `apps/ingestion-worker/src/job_client.py` and
  `apps/url-fetcher-worker/src/job_client.py` are structurally identical except
  for `job_type` / heartbeat `worker_type`, handler type, worker error class,
  log label, and worker-id prefix.
- Current per-worker Dockerfiles use per-worker build contexts and copy only
  local `requirements.txt` plus `src/`.
- The root `Dockerfile` also defines `ingestion-worker` and
  `url-fetcher-worker` targets from repository root context.
- `docker-compose.yml` builds both Python workers from per-worker contexts.
- `docker-compose.prod.yml` currently builds `ingestion-worker` from the
  per-worker context but builds `url-fetcher-worker` from the root
  `url-fetcher-worker` target.
- `.github/workflows/ci.yml` runs the Python matrix from
  `apps/${{ matrix.worker }}`, installs local `requirements.txt`, then runs
  `ruff check`, `ruff format --check`, and `python -m pytest tests/ -v`.
- CI validation also syntax-checks each `apps/*/Dockerfile` with its directory
  as build context and syntax-checks root `Dockerfile` targets
  `api web ingestion-worker url-fetcher-worker indexer-worker`.
- Scoped worker `AGENTS.md` files require per-worker venv pytest commands and
  preserving the API-compatible pending/claim, heartbeat, progress, complete,
  fail, retryability, and active-job cleanup protocol.

### Option Comparison

1. Shared Python package

This gives the protocol one importable implementation and one focused test
suite. It matches the observed duplication because the current differences are
parameters and callbacks rather than independent algorithms. Downstream issues
must adjust Python install and Docker build contexts so both workers and both
root targets can see the package. This is a real build/deploy change, but it is
explicit and testable. Verdict: selected.

2. Shared local module wired into both build contexts

Rejected because it has the same Docker build-context problem as a package but
without package metadata, install-time validation, or a clean import contract.
It also makes local venv and CI behavior depend on path injection, increasing
the chance that Docker and local test imports diverge.

3. Protocol-template enforcement

Rejected because current duplication is already near-identical and parameterized
well enough to share directly. A template would avoid Docker rewiring but would
leave two runtime implementations to drift and would not remove the main entropy
source identified by this stage.

### Future Package Contract

Package layout for #421:

```text
packages/python-worker-protocol/
  pyproject.toml
  src/cherry_worker_protocol/
    __init__.py
    job_lifecycle.py
  tests/
    test_job_lifecycle.py
```

Public imports for migrated workers:

```python
from cherry_worker_protocol import (
    InternalApiClient,
    WorkerProtocolConfig,
    generate_worker_id,
    poll_jobs,
    run_once,
    start_heartbeat_thread,
)
```

Required config fields:

- `job_type`: `ingestion` or `url_fetch`
- `worker_type`: same value used in heartbeat `system_info.worker_type`
- `worker_id_prefix`: `ingestion-worker` or `url-fetcher-worker`
- `failure_log_message`: `ingestion job failed` or `url_fetch job failed`
- `worker_error_type`: `IngestionJobError` or `UrlFetchJobError`
- `build_error_json`: worker-local error serializer

The shared package must keep handler behavior generic: it calls
`handler.handle(job, progress)` and does not import worker parser, fetcher,
storage, SSRF, archive, or output modules.

### Future Docker Wiring

Ownership rule: #421 owns every first-time shared-package visibility/build
wiring surface before either worker migration starts. That includes compose
root-context changes needed by both workers, per-worker Dockerfile copy/install
steps, root `Dockerfile` worker target installs, CI Dockerfile syntax-check
context changes, and the shared-package venv/CI test command. #422 and #423
must consume wiring that already exists; they must not be the first issue to
make Docker, compose, CI, or local venv able to see
`packages/python-worker-protocol/`.

The shared package requires root build context anywhere a worker image is built.
These Docker and compose changes are #421 scope, even though worker runtime
imports are introduced later by #422/#423.

Future `apps/ingestion-worker/Dockerfile`:

```dockerfile
COPY packages/python-worker-protocol/ packages/python-worker-protocol/
COPY apps/ingestion-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir ./packages/python-worker-protocol
COPY apps/ingestion-worker/src/ src/
```

Future `apps/url-fetcher-worker/Dockerfile`:

```dockerfile
COPY packages/python-worker-protocol/ packages/python-worker-protocol/
COPY apps/url-fetcher-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir ./packages/python-worker-protocol
COPY apps/url-fetcher-worker/src/ src/
```

Future root `Dockerfile` target `ingestion-worker`:

```dockerfile
COPY packages/python-worker-protocol/ packages/python-worker-protocol/
COPY apps/ingestion-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir ./packages/python-worker-protocol
COPY apps/ingestion-worker/src/ src/
```

Future root `Dockerfile` target `url-fetcher-worker`:

```dockerfile
COPY packages/python-worker-protocol/ packages/python-worker-protocol/
COPY apps/url-fetcher-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir ./packages/python-worker-protocol
COPY apps/url-fetcher-worker/src/ src/
```

Future compose impact:

- `docker-compose.yml` worker build contexts must become `.` for both workers,
  with dockerfiles `apps/ingestion-worker/Dockerfile` and
  `apps/url-fetcher-worker/Dockerfile`.
- `docker-compose.prod.yml` must also build `ingestion-worker` from root context
  with dockerfile `apps/ingestion-worker/Dockerfile`.
- `docker-compose.prod.yml` may keep `url-fetcher-worker` on the root
  `Dockerfile` target because that target will install the shared package.

### Future CI And Venv Impact

#421 owns this CI and local venv wiring before worker migrations:

CI `python-ci` must install the shared package before lint and tests for
`ingestion-worker` and `url-fetcher-worker`:

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
if [ "${{ matrix.worker }}" = "ingestion-worker" ] || [ "${{ matrix.worker }}" = "url-fetcher-worker" ]; then
  pip install -e ../../packages/python-worker-protocol
fi
pip install ruff pytest pytest-asyncio
```

CI Dockerfile syntax checks must use repository root context for the two Python
worker app Dockerfiles:

```bash
docker buildx build --check -f apps/ingestion-worker/Dockerfile .
docker buildx build --check -f apps/url-fetcher-worker/Dockerfile .
```

Root target syntax checks remain:

```bash
docker buildx build --check -f Dockerfile --target ingestion-worker .
docker buildx build --check -f Dockerfile --target url-fetcher-worker .
```

Local venv setup after #421 must install the package into both worker venvs:

```bash
apps/ingestion-worker/.venv/bin/pip install -e packages/python-worker-protocol
apps/url-fetcher-worker/.venv/bin/pip install -e packages/python-worker-protocol
```

The existing pytest commands remain the acceptance commands:

```bash
apps/ingestion-worker/.venv/bin/python -m pytest apps/ingestion-worker/tests -v
apps/url-fetcher-worker/.venv/bin/python -m pytest apps/url-fetcher-worker/tests -v
```

### Rollback Path

If package wiring breaks deployability during #421-#423:

1. Revert the worker imports to the current worker-local `job_client.py`
   implementation for the affected worker.
2. Revert compose build contexts and Python CI install changes for the affected
   worker.
3. Keep `packages/python-worker-protocol/` only if no worker imports it; remove
   it if no implementation issue has shipped.
4. Re-run that worker's venv pytest command plus both compose config checks.

No API, database, parser, fetcher, or queue behavior rollback is required
because the package boundary is limited to worker-side protocol code.

### Downstream Issue Boundaries

- #421: create `packages/python-worker-protocol/`, implement the shared
  lifecycle contract and package tests, and add all shared-package
  visibility/build wiring before worker migrations: root-context compose changes
  for both Python workers, per-worker Dockerfile copy/install steps, root
  `Dockerfile` target package installs, CI Dockerfile syntax-check context
  changes, and the shared-package venv/CI test command. No worker parser/fetcher
  migration.
- #422: migrate only `apps/ingestion-worker` to import and configure the shared
  protocol after #421 wiring exists. Preserve ingestion parser/storage behavior,
  do not introduce first-time Docker/compose/CI/venv wiring, and run ingestion
  tests.
- #423: migrate only `apps/url-fetcher-worker` to import and configure the
  shared protocol after #421 wiring exists, preserve SSRF/fetcher behavior, and
  perform final deployability verification across root/per-worker Docker,
  compose, CI syntax-check expectations, and both worker venv tests. #423 may
  fix regressions in already-owned wiring but must not be the first issue to
  wire shared-package visibility.

### Verification Matrix

Decision-only #420 verification:

```bash
openspec validate entropy-governance --strict --no-interactive
git diff --check
docker compose config --quiet
docker compose -f docker-compose.prod.yml config --quiet
```

Required future #421-#423 verification:

```bash
packages/python-worker-protocol/.venv/bin/python -m pytest packages/python-worker-protocol/tests -v
apps/ingestion-worker/.venv/bin/python -m pytest apps/ingestion-worker/tests -v
apps/url-fetcher-worker/.venv/bin/python -m pytest apps/url-fetcher-worker/tests -v
docker buildx build --check -f apps/ingestion-worker/Dockerfile .
docker buildx build --check -f apps/url-fetcher-worker/Dockerfile .
docker buildx build --check -f Dockerfile --target ingestion-worker .
docker buildx build --check -f Dockerfile --target url-fetcher-worker .
docker compose config --quiet
docker compose -f docker-compose.prod.yml config --quiet
```
