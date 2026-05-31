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

- The worker protocol strategy is intentionally decided in the first worker issue. That issue must produce the chosen approach, affected Docker/CI/venv wiring, rollback path, and exact verification matrix before implementation issues begin.
