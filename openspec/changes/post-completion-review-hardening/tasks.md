## 1. Auth and API Permission Hardening

- [ ] 1.1 Add API-token context to the request model so global authorization can distinguish bearer JWT sessions from `cwt_` API tokens.
- [ ] 1.2 Enforce token scopes in or before `RbacGuard`; add regression tests proving owner/admin role cannot exceed token scopes.
- [ ] 1.2a Define and document the API token scope mapping table: ordinary REST route permission points are token scopes by default, MCP scopes remain MCP-only, and admin/upload/graphify examples are covered.
- [x] 1.3 Update browser login/refresh/logout flow so refresh tokens are cookie-only and not present in JSON response bodies or required logout request bodies.
- [x] 1.4 Update frontend auth client and auth controller/service tests for cookie-only refresh/logout.
- [ ] 1.5 Fix `/api/uploads/{source_document_id}`, `/status`, and `/reprocess` authorization so service-level Space ACL lookup occurs before final permission decision.
- [ ] 1.6 Add API tests for editor/space-admin upload detail, status, and reprocess access plus unauthorized non-disclosure behavior.
- [ ] 1.7 Make `/api/auth/sessions` current-session marking deterministic from token/session context.
- [ ] 1.8 Align OpenAPI and `docs/design/11_API规范.md` for API token list, browser login/refresh/logout cookie flow, any separately documented machine refresh mode, and upload reprocess contracts; add spec-parity tests or schema validation.

## 2. Async Index, Docmost Sync, and Wiki Preservation

- [x] 2.1 Add transactional lock or database constraint so only one `building` index snapshot can exist per `(tenant_id, space_id)`.
- [x] 2.2 Update indexer failure handling so failed snapshots move to a non-building state and later reindex can proceed.
- [x] 2.3 Add migration/preflight cleanup for existing duplicate `building` snapshots, rollback notes for the new constraint/lock, and same-Space concurrent reindex plus post-failure retry tests.
- [ ] 2.4 Define the Docmost page-sync state machine and canonical persistence contract, including repo path/branch/commit metadata, wiki page version linkage, and reindex job id or invalidation marker.
- [ ] 2.5 Replace Docmost page-sync placeholder repo commit behavior so `page.saved` and `page.deleted` enqueue or trigger reindex/invalidation before marking sync complete.
- [ ] 2.6 Add reconciliation tests and test data for page sync commit failure, reindex enqueue failure, retry/defer behavior, and deletion invalidation.
- [ ] 2.7 Use fallback block matching in Graphify wiki import so human-owned blocks survive block-id/heading churn.
- [ ] 2.8 Add tests where Graphify changes heading/slug and existing human-owned blocks are preserved or converted into proposals using the fallback order `blockId -> stable heading -> content hash -> marker -> safe page-local order`.
- [ ] 2.9 Fix bridge reconciliation pagination to avoid skipping pending events under concurrent status changes.
- [ ] 2.10 Ensure deferred permission-sync states are retried, reconciled, or visibly pending.
  - [ ] 2.10a In `createPermissionSyncProcessor`, throw a retriable error when `pushSpacePermissions` returns deferred so BullMQ retries with backoff; log a `permission_sync_deferred` audit event.
  - [ ] 2.10b After user-sync processor writes back `docmost_user_id`, query all spaces the user belongs to and enqueue permission-sync jobs for each (reactive retry chain).
  - [ ] 2.10c In `reconcilePermissions`, log `permission_sync_deferred` audit events for spaces with pending users instead of silently continuing.
  - [ ] 2.10d Test: deferred permission sync throws retriable error (not UnrecoverableError) and writes audit event; input: space with 1 synced user + 1 unsynced user; expected: `pushPermissions` not called, error thrown, audit row with action `permission_sync_deferred`.
  - [ ] 2.10e Test: user-sync completion enqueues permission-sync for affected spaces; input: user with memberships in 2 spaces; expected: 2 permission-sync jobs enqueued after docmost_user_id writeback.
  - [ ] 2.10f Test: reconciliation logs deferred audit event for spaces with pending users; input: reconcile with 1 space having pending users; expected: audit row with action `permission_sync_deferred`, `errors` counter not incremented.
  - [ ] 2.10g Test: permission sync succeeds after user becomes synced; input: space where all users now have docmost_user_id; expected: `pushPermissions` called with correct member list.

## 3. Frontend Contract and UX Regression Fixes

- [ ] 3.1 Extend frontend permission helpers to include `upload:create`, `upload:read`, `graphify:view`, and `graphify:run` semantics after backend permission points and API response shapes are stable.
- [ ] 3.2 Gate upload routes/forms/actions using upload permissions and add no-permission tests.
- [ ] 3.3 Gate Graphify list/detail actions using graphify permissions and add no-permission tests.
- [ ] 3.4 Fix graph explorer empty-state logic so `node_count > 0` shows graph UI even when no run is currently active.
- [ ] 3.5 Add graph explorer regression test for `node_count > 0` regardless of active Graphify run presence; update OpenAPI if the UI depends on a run-presence field.
- [ ] 3.6 Protect upload detail status loading with a request sequence or abort mechanism so stale responses are ignored.
- [ ] 3.7 Add upload drawer race test for out-of-order status responses.
- [ ] 3.8 Validate Graphify run detail route Space against `run.space_id`; add mismatch test.

## 4. Ops, Container, and CI Evidence Hardening

- [ ] 4.1 Align `docs/ops/docker-compose.skeleton.yml`, `docs/ops/env.example`, and runtime env names for URL fetcher egress configuration.
- [ ] 4.2 Implement or remove documented `SSRF_BLOCKED_CIDRS` support; add tests for configurable blocked ranges if retained.
- [ ] 4.3 Add egress/proxy smoke verification proving proxy-required mode fails closed when proxy is missing/unreachable and URL fetcher cannot bypass the intended outbound route.
- [ ] 4.4 Add live-stack CI smoke tests for real MinIO upload/read and Redis/job or worker heartbeat connectivity; publish the workflow name and CI run evidence.
- [ ] 4.5 Harden production Dockerfiles/compose so API and workers run non-root with compatible `read_only`, `cap_drop`, and `no-new-privileges` settings.
- [ ] 4.6 Replace copy-pasteable weak production credentials with fail-fast placeholders and document secret generation.
- [ ] 4.7 Extend CI validation to `docker compose -f docker-compose.prod.yml config --quiet` and root multi-target Dockerfile production targets.
- [ ] 4.8 Pin `latest` image references in production compose by version or digest, or add explicit drift-risk exceptions with owner and review cadence.

## 5. Final Validation and Rollout

- [ ] 5.1 Run `pnpm -r --if-present typecheck`.
- [ ] 5.2 Run `pnpm -r --if-present lint`.
- [ ] 5.3 Run targeted JS/TS tests for auth, API tokens, uploads, indexer, wiki-sync, wiki-core, frontend upload/graph/Graphify, and CI smoke helpers; record package commands such as `pnpm --filter <api-package> test`, `pnpm --filter <web-package> test`, and any package-specific smoke commands in the implementation issue or PR.
- [ ] 5.4 Run Python worker tests through each worker virtual environment, including `apps/ingestion-worker/.venv/bin/python -m pytest apps/ingestion-worker/tests`, `apps/graphify-worker/.venv/bin/python -m pytest apps/graphify-worker/tests`, and `apps/url-fetcher-worker/.venv/bin/python -m pytest apps/url-fetcher-worker/tests`.
- [ ] 5.5 Run `openspec status --change post-completion-review-hardening` and resolve any incomplete artifacts.
- [ ] 5.6 Document migration and compatibility notes inside the relevant implementation PRs for API token scopes, cookie-only refresh/logout, index snapshot cleanup, and deployment hardening, then summarize them in the final rollout notes.
