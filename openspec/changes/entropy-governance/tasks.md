## 0. Stage Gate and Inventory

- [x] 0.1 Update `docs/project/26_需求追踪矩阵.md` with entropy-governance rows for scoped agent context, API error contract, API Chat boundary, Web Chat boundary, Python worker protocol, and baseline refresh. Use explicit `N/A（不新增/不变更）` for unchanged API/Schema columns.
  - Verification: `rg -n "Entropy governance|熵治理" docs/project/26_需求追踪矩阵.md` shows rows with non-empty API, Schema, and Test columns.
- [ ] 0.2 Produce implementation inventories for API error helpers/local string codes, Chat backend responsibility seams, Web Chat responsibility seams, and Python worker job protocol duplication.
  - Verification: each downstream issue references the relevant inventory and has a bounded file list before code movement starts.

## 1. Scoped Agent Context

Issue #409 fixture:
- Issue type: docs/config governance
- Project profile: other
- Blast radius: low
- Fixture level: none
- Repair intensity: low
- Change surface: scoped `AGENTS.md` files under `apps/`, `packages/`, and `tools/`
- Must preserve: root `AGENTS.md` authority, completeness discipline, Python venv rules, Docker safety, testing/progress requirements, and exclusion of `external/*` reference/fork code from implementation refactors
- Selected risk packs:
  - Documentation / migration notes: selected - scoped instructions are documentation/config for future implementation agents
- Risk packs considered:
  - Public API / CLI / script entry: not selected - no route, command behavior, or CLI contract changes
  - Config / project setup: not selected - no runtime config or build/deploy behavior changes
  - File IO / path safety / overwrite: not selected - no runtime file access behavior changes
  - Schema / columns / units / field names: not selected - no database or data schema changes
  - Geospatial / CRS / shapefile sidecars: not selected - no geospatial code changes
  - Time series / forcing / temporal boundaries: not selected - no temporal data behavior changes
  - Numerical stability / conservation / NaN: not selected - no numerical code changes
  - Solver runtime / performance / threading: not selected - no solver/runtime code changes
  - Resource limits / large input / discovery: not selected - no discovery or resource-bound code changes
  - Legacy compatibility / examples: not selected - no behavior compatibility surface changes
  - Error handling / rollback / partial outputs: not selected - no runtime error path changes
  - Release / packaging / dependency compatibility: not selected - no package metadata, dependency, or release artifact changes
- Required evidence:
  - `rg -n "external/\\*|reference|参考" apps/*/AGENTS.md packages/AGENTS.md tools/AGENTS.md` shows reference-project scope is explicit where relevant
  - Manual scoped-file review confirms no scoped file relaxes root completeness, Docker, Python venv, testing, or progress rules
- Non-goals: source-code refactors, root policy relaxation, and changes inside `external/*`

- [x] 1.1 Add `apps/api/AGENTS.md` with API-specific boundaries, shared package reuse rules, error-contract guidance, permission-check guidance, and targeted verification commands.
  - Verification: scoped file exists, does not relax root rules, and mentions `pnpm --filter @cherrygraph/api test`.
- [x] 1.2 Add `apps/web/AGENTS.md` with React/Ant Design/i18n/theme-token boundaries and targeted Web verification commands.
  - Verification: scoped file exists, does not relax root rules, and mentions `pnpm --filter @cherrygraph/web test` plus Web typecheck.
- [x] 1.3 Add worker scoped instructions for `apps/graphify-worker/`, `apps/ingestion-worker/`, `apps/url-fetcher-worker/`, `apps/indexer-worker/`, and `apps/wiki-sync-worker/`.
  - Verification: Python worker instructions include full venv pytest commands; Node worker instructions include workspace commands; no scoped file includes `external/*` as implementation scope.
- [x] 1.4 Add `packages/AGENTS.md` and `tools/AGENTS.md` covering framework-neutral package constraints and CLI verification commands.
  - Verification: scoped files distinguish shared packages from app-framework code and keep CLI/tool tests local.

## 2. API Error Contract

Issue #410 fixture:
- Issue type: refactor / contract foundation
- Project profile: other
- Blast radius: high
- Fixture level: expanded
- Repair intensity: high
- Change surface: `apps/api/src/common/**`, `packages/shared/src/errors.ts`, `packages/shared/src/__tests__/errors.test.ts`, `docs/audit/api-error-inventory.md`, and focused API/common/shared tests
- Must preserve: public HTTP routes, DTOs, database schema, current error envelope `{ error: { code, message, details? }, meta: { request_id } }`, HTTP status mapping, `details` propagation, 5xx sanitization, and request-id behavior
- Must add/change: one common API error helper under `apps/api/src/common/**`; an inventory of local `throwApiError` helpers/local string codes by required domain; shared `ErrorCode` entries for client-facing local string codes found in the inventory; tests proving representative 400/401/403/404/409/422/500 compatibility through the helper and filter
- Selected risk packs:
  - Public API / CLI / script entry: selected - API client-facing error envelope and status behavior must remain compatible
  - Schema / columns / units / field names: selected - shared `ErrorCode` is a cross-package API contract, though DB schema is unchanged
  - Error handling / rollback / partial outputs: selected - the change centralizes error throwing and must preserve filter/failure semantics
  - Documentation / migration notes: selected - inventory evidence is required for dependent migration issues
- Risk packs considered:
  - Config / project setup: not selected - no runtime config or deployment behavior changes intended
  - File IO / path safety / overwrite: not selected - no runtime file access behavior changes
  - Geospatial / CRS / shapefile sidecars: not selected - no geospatial code changes
  - Time series / forcing / temporal boundaries: not selected - no temporal data behavior changes
  - Numerical stability / conservation / NaN: not selected - no numerical code changes
  - Solver runtime / performance / threading: not selected - no solver/runtime code changes
  - Resource limits / large input / discovery: not selected - no large input or discovery behavior changes
  - Legacy compatibility / examples: not selected - no legacy example/runtime behavior changes
  - Release / packaging / dependency compatibility: not selected - no dependency or package metadata changes
- Invariant Matrix:
  - Governing invariant: every API client-facing error code introduced or inventoried by this foundation must be a shared `ErrorCode`, and the global filter must emit the same HTTP status, message, optional details, and `meta.request_id` for helper-thrown errors.
  - Source-of-truth identity/contract: `packages/shared/src/errors.ts::ErrorCode` plus `apps/api/src/common/filters/http-exception.filter.ts` response envelope.
  - Producers: common API error helper, existing local helper inventory, and promoted string-code call sites selected for this foundation.
  - Validators/preflight: helper tests, `HttpExceptionFilter` tests, shared `ErrorCode` tests, and inventory scan commands.
  - Storage/cache/query: none - no DB/cache schema or query behavior changes.
  - Public routes/entrypoints: representative helper/filter test controller paths only; existing business routes are not migrated wholesale in #410.
  - Frontend/downstream consumers: API clients consuming `{ error, meta }`; compatibility asserted by filter tests rather than UI changes.
  - Failure paths/rollback/stale state: 400/401/403/404/409/422 helper-thrown errors keep details/status; 500 helper-thrown errors remain sanitized by existing filter behavior.
  - Evidence/audit/readiness: `docs/audit/api-error-inventory.md`, `rg -n "function throwApiError|throwApiError\\(" apps/api/src`, targeted Vitest commands, and OpenSpec validation.
  - Regression rows:
    - common helper + valid shared `ErrorCode` + 400/401/403/404/409/422 -> matching HTTP status, code, message, details when provided, and request_id in response meta
    - common helper + 500 -> sanitized `INTERNAL_ERROR` response from the existing filter, without leaking helper message/details
    - inventory local string code classified client-facing -> added to `ErrorCode` and covered by shared tests
    - non-canonical third-party/worker-specific failure payload string -> documented as out of scope in inventory, while project-owned timeout payloads visible through `JobDto.error_json` are promoted
- Boundary-surface checklist:
  - Shared helper roots: `apps/api/src/common/**` error helper and `HttpExceptionFilter`
  - Public entrypoints: test-only controller routes exercising the helper/filter contract
  - Producer/consumer evidence boundaries: inventory scan source -> `docs/audit/api-error-inventory.md` -> dependent issue scope
  - Unchanged downstream consumers: current REST/SSE clients relying on `error.code`, `error.message`, `error.details`, and `meta.request_id`
- Required evidence:
  - `pnpm exec vitest run apps/api/src/common/filters/__tests__/http-exception.filter.test.ts --config vitest.config.ts --passWithNoTests=false`
  - `pnpm --filter @cherrygraph/shared test`
  - `pnpm --filter @cherrygraph/api test`
  - `rg -n "function throwApiError|const throwApiError" apps/api/src` still shows existing domain-local helpers until dependent migration issues, but the inventory must classify them and no new domain-local helper may be added by #410
  - `openspec validate entropy-governance --strict --no-interactive`
- Non-goals: migrating every API domain helper, changing public route/DTO/schema behavior, changing `HttpExceptionFilter` envelope shape, or touching `external/*`

- [x] 2.1 Add an API error inventory listing current local `throwApiError` definitions, local string codes, HTTP statuses, and representative tests per API domain.
  - Verification: inventory includes at least `chat`, `wiki`, `graphify`, `jobs`, `groups`, `models`, `mcp`, `feedback`, `api-tokens`, `governance`, `audit`, and `admin/proposals` findings or an explicit N/A.
- [x] 2.2 Add a common API error helper under `apps/api/src/common/**` and tests proving compatibility with `HttpExceptionFilter`, including representative 400/401/403/404/409/422/500 statuses.
  - Verification: common helper tests and existing HTTP exception filter tests pass.
- [x] 2.3 Promote existing API-returned local string error codes into `packages/shared/src/errors.ts` and update shared error tests.
  - Verification: local strings such as proposal status/action codes, missing embedding model codes, and project-owned job timeout payload codes are canonical `ErrorCode` values; non-canonical third-party/worker-specific failure payloads remain documented out of scope.
- [ ] 2.4 Dependent issues #411/#412: migrate local `throwApiError` helper definitions in API services/controllers to the common helper by API domain, preserving HTTP status, code, message, details, and `meta.request_id`.
  - Verification: `rg -n "function throwApiError" apps/api/src` returns only the common helper location; targeted API service/controller tests pass for migrated domains.

## 3. API Chat Backend Boundary

- [ ] 3.1 Add or strengthen characterization tests for Chat session lifecycle, multi-space scope validation, and permission rejection before extracting session/scope code.
  - Verification: targeted `apps/api/src/chat/__tests__/chat.service.test.ts` scenarios pass and assert unchanged error code/status behavior.
- [ ] 3.2 Extract Chat session/scope/permission responsibilities from `apps/api/src/chat/chat.service.ts` into a focused backend collaborator while preserving controller behavior.
  - Verification: Chat session list/get/update/delete and stream request session creation tests pass.
- [ ] 3.3 Add or strengthen characterization tests for static retrieval, graph context, RRF fusion, rerank fallback, strict/no-hit behavior, and retrieval trace metadata.
  - Verification: targeted Chat retrieval/rerank tests pass, including non-fatal rerank fallback.
- [ ] 3.4 Extract static retrieval, graph context, RRF fusion, rerank call/fallback, and trace metadata responsibilities into focused backend collaborator(s).
  - Verification: `apps/api/src/chat/__tests__/rerank.test.ts`, source-chain/citation tests, and relevant integration tests pass.
- [ ] 3.5 Add or strengthen characterization tests for model/provider resolution, Agent/static route selection, database toggle routing, and Agent SSE event behavior.
  - Verification: `apps/api/src/chat/__tests__/query-routing.test.ts` and relevant `apps/api/src/agent/__tests__/*` routing/SSE tests pass.
- [ ] 3.6 Extract model/provider resolution and Agent dispatch decision code into focused collaborator(s), keeping `ChatService` as public orchestration boundary.
  - Verification: Chat stream still emits the same `session`, `content`, `citations`, `usage`, `agent.tool_use`, `chart.data`, `message.completed`, and `error` event names where applicable.
- [ ] 3.7 Add or strengthen characterization tests for message/citation persistence, model usage logs, retrieval traces, and completion metadata.
  - Verification: `apps/api/src/chat/__tests__/model-usage.test.ts` and persistence/citation tests pass.
- [ ] 3.8 Extract trace/usage/message/citation persistence and SSE shaping helpers while preserving `ChatService` as public orchestration boundary.
  - Verification: targeted Chat and Agent tests pass; `apps/api/src/chat/chat.service.ts` no longer contains newly added mixed-responsibility blocks for these concerns.

## 4. Web Chat Boundary

- [ ] 4.1 Add or strengthen Web characterization tests for session switching, deletion, multi-space scope changes, model-unavailable gating, database toggle gating, message rendering, citation/source-chain rendering, and current layout controls.
  - Verification: `pnpm --filter @cherrygraph/web test -- chat` or the repo-equivalent targeted Vitest command passes.
- [ ] 4.2 Extract session loading/deletion workflows from `apps/web/src/pages/Chat.tsx` into focused hook(s).
  - Verification: session switching/deletion tests pass and visible i18n text remains unchanged.
- [ ] 4.3 Extract selected-space scope/settings, model availability gating, and database toggle gating into focused hook(s).
  - Verification: scope/model/database gating tests pass and request payload behavior remains unchanged.
- [ ] 4.4 Move message markdown rendering, message parts, citation panel, and source-chain rendering into focused components without changing UX or i18n keys.
  - Verification: message/citation/source-chain tests pass; unsafe markdown image/link behavior remains unchanged.
- [ ] 4.5 Keep `Chat.tsx` as a thin page composition boundary and run targeted Web tests/typecheck.
  - Verification: `pnpm --filter @cherrygraph/web test` and Web typecheck pass for touched files.

## 5. Python Worker Protocol

- [ ] 5.1 Inspect Docker/CI/venv constraints and decide the worker protocol strategy: shared Python package, shared local module wired into both build contexts, or protocol-template enforcement.
  - Verification: decision note records chosen strategy, rejected alternatives, Docker/CI/venv impact, rollback path, and exact verification commands.
- [ ] 5.2 Implement the shared/enforced worker job lifecycle protocol with tests for pending polling, claim, heartbeat, progress, completion, failure, retryability, lock expiry, concurrent claim, duplicate terminal calls, and active jobs cleanup.
  - Verification: protocol tests pass in the selected package/template location.
- [ ] 5.3 Migrate `apps/ingestion-worker` to the shared/enforced protocol and run ingestion worker tests.
  - Verification: `apps/ingestion-worker/.venv/bin/python -m pytest apps/ingestion-worker/tests -v` passes.
- [ ] 5.4 Migrate `apps/url-fetcher-worker` to the shared/enforced protocol and run URL fetch worker tests.
  - Verification: `apps/url-fetcher-worker/.venv/bin/python -m pytest apps/url-fetcher-worker/tests -v` passes.
- [ ] 5.5 Update Docker/CI/local verification wiring only where required by the chosen strategy.
  - Verification: `docker compose config --quiet`, `docker compose -f docker-compose.prod.yml config --quiet`, and relevant CI workflow checks are updated or explicitly documented as unchanged.

## 6. Governance Verification

- [ ] 6.1 Re-run entropy-focused checks using the same scope as `.entropy-baseline/latest.json`, excluding `external/*`, generated output, venvs, fixtures/screenshots, and `openspec/*`.
  - Verification: audit notes show the same include/exclude rules and no implementation refactor touches `external/*`.
- [ ] 6.2 Archive the old baseline if present, update `.entropy-baseline/latest.json` after implementation, and record trend changes against this baseline.
  - Verification: baseline timestamp/commit/scope are current and trend summary reports changed high-entropy hotspots.
- [ ] 6.3 Update `progress.md` with the completed entropy governance slices and actual verification commands.
  - Verification: `progress.md` stays under 200 lines and references the relevant issue numbers.
