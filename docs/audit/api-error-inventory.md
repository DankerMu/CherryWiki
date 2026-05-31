# API Error Inventory

> Issue #410 foundation inventory. Scope: `apps/api/src/**`, excluding tests except for representative coverage references. Dependent helper migration remains in #411/#412.

## Summary

- Local `throwApiError` definitions found: 18 existing domain-local helpers plus the new common helper at `apps/api/src/common/errors/api-error.ts`.
- Client-facing local string codes promoted to `ErrorCode`: `NO_EMBEDDING_MODEL_CONFIGURED`, `RETRIEVAL_TRACE_NOT_FOUND`, `REBUILD_ALREADY_RUNNING`, `INVALID_SCOPE`, `PROPOSAL_ALREADY_RESOLVED`, `INVALID_PROPOSAL_STATUS`, `INVALID_PROPOSAL_ACTION`, `REINDEX_ALREADY_RUNNING`, `WORKER_TIMEOUT`, `TIMEOUT`.
- Arbitrary third-party or worker-specific failure payload codes such as `PARSE_ERROR`, `GRAPHIFY_ERROR`, and `WORKER_FAILURE` remain out of scope unless they become canonical project-owned codes; project-owned timeout payloads are promoted because `jobs.error_json` flows through `JobDto.error_json`.
- 5xx behavior: local helpers may pass `ErrorCode.INTERNAL_ERROR`, but `HttpExceptionFilter` sanitizes 5xx responses to `INTERNAL_ERROR` and `Internal server error`.

## Required Domains

| Domain | Local helper definition | Local string codes | HTTP statuses observed | Representative tests | Notes |
|---|---|---|---|---|---|
| chat | `apps/api/src/chat/chat.service.ts:2356` | `NO_EMBEDDING_MODEL_CONFIGURED` -> promoted | 400, 403, 404, 422 | `apps/api/src/chat/__tests__/chat.service.test.ts` | `NO_CHAT_MODEL_CONFIGURED` was already shared; helper left for #411/#412. |
| wiki | `apps/api/src/wiki/wiki.service.ts:1132` | `REINDEX_ALREADY_RUNNING` -> promoted | 404, 409, 500 | `apps/api/src/wiki/__tests__/wiki.service.test.ts`, `apps/api/src/wiki/__tests__/wiki.controller.test.ts`, `apps/api/src/wiki/__tests__/wiki-diff.test.ts` | Reindex conflict now uses shared `ErrorCode.REINDEX_ALREADY_RUNNING`; helper left for #411/#412. |
| graphify | `apps/api/src/graphify/graphify.service.ts:1151` | N/A | 401, 403, 404, 409 | `apps/api/src/graphify/__tests__/graphify.service.test.ts`, `apps/api/src/graphify/__tests__/graphify.controller.test.ts` | Uses shared graphify/run/permission codes; helper left for #411/#412. |
| jobs | `apps/api/src/jobs/jobs.service.ts:542` | N/A | 401, 404, 409, 422 | `apps/api/src/jobs/__tests__/jobs.service.test.ts` | Public job API uses shared generic codes for thrown API errors and exposes persisted `JobDto.error_json` unchanged. Project-owned timeout payload codes visible through that field must also be shared `ErrorCode` values. Internal job helper is listed separately below. |
| groups | `apps/api/src/groups/group.service.ts:1248` | N/A | 404, 409, 422 | `apps/api/src/groups/__tests__/group.service.test.ts` | Uses shared group/user/space validation codes; helper left for #411/#412. |
| models | `apps/api/src/models/model-config.service.ts:948` | N/A | 404, 409, 422 | `apps/api/src/models/__tests__/model-config.service.test.ts`, `apps/api/src/models/__tests__/model-config.controller.test.ts` | Uses shared model/secret/embedding-limit codes. |
| mcp | `apps/api/src/mcp/mcp.service.ts:626` | N/A | 401, 403, 404, 409, 429, 502 | `apps/api/src/mcp/__tests__/mcp-registry.test.ts`, `apps/api/src/mcp/__tests__/mcp-policy.test.ts`, `apps/api/src/mcp/__tests__/mcp-audit.test.ts`, `apps/api/src/mcp/__tests__/mcp-rate-limit.test.ts` | Dynamic `code` variable resolves to shared `MCP_SERVER_TIMEOUT` or `MCP_SERVER_ERROR`. |
| feedback | `apps/api/src/feedback/feedback.service.ts:534` | N/A | 400, 404, 409, 422, 500 | `apps/api/src/feedback/__tests__/feedback.service.test.ts`, `apps/api/src/feedback/__tests__/feedback.controller.test.ts` | Zod validation helper emits shared `VALIDATION_ERROR` with details. |
| api-tokens | `apps/api/src/api-tokens/api-token.service.ts:347` | N/A | 401, 404, 422 | `apps/api/src/api-tokens/__tests__/api-token.service.test.ts`, `apps/api/src/api-tokens/__tests__/api-token.controller.test.ts`, `tests/integration/api-token-lifecycle.test.ts` | Zod validation helper emits shared `VALIDATION_ERROR` with details. |
| governance | `apps/api/src/governance/governance.service.ts:932` | N/A | 400, 404, 500 | `apps/api/src/governance/__tests__/governance.service.test.ts`, `apps/api/src/governance/__tests__/governance-reindex.test.ts`, `apps/api/src/governance/__tests__/conflict-detection.test.ts` | Zod validation helper emits shared `VALIDATION_ERROR` with details. |
| audit | `apps/api/src/audit/audit-query.controller.ts:249` | N/A | 401, 422 | `apps/api/src/audit/__tests__/audit-query.test.ts` | Controller-local helper left for #411/#412. |
| admin/proposals | `apps/api/src/admin/proposals/proposal.service.ts:202` | `PROPOSAL_ALREADY_RESOLVED`, `INVALID_PROPOSAL_STATUS`, `INVALID_PROPOSAL_ACTION` -> promoted | 400, 404, 409 | `apps/api/src/admin/__tests__/proposal.controller.test.ts` | Helper left for #411/#412. |

## Additional Existing Helpers

| Domain | Local helper definition | Local string codes | HTTP statuses observed | Representative tests | Notes |
|---|---|---|---|---|---|
| admin/index | `apps/api/src/admin/admin-index.service.ts:279` | `RETRIEVAL_TRACE_NOT_FOUND`, `REBUILD_ALREADY_RUNNING`, `INVALID_SCOPE` -> promoted | 400, 404, 409, 422, 500 | `apps/api/src/admin/__tests__/admin-index.test.ts`, `apps/api/src/admin/__tests__/retrieval-trace.test.ts` | Helper left for #411/#412. |
| users | `apps/api/src/users/user.service.ts:767` | N/A | 403, 404, 409, 422 | `apps/api/src/users/__tests__/user.service.test.ts` | Uses shared user/group/permission codes. |
| graph | `apps/api/src/graph/graph.service.ts:525` | N/A | 401, 404 | `apps/api/src/graph/__tests__/graph-search.test.ts`, `apps/api/src/graph/__tests__/graph-path.test.ts`, related integration tests | Required domain list did not include graph, but helper is present and should migrate in #411/#412. |
| spaces | `apps/api/src/spaces/space.service.ts:814` | N/A | 401, 404, 409, 422 | `apps/api/src/spaces/__tests__/space.service.test.ts` | Uses shared space/generic codes. |
| uploads | `apps/api/src/uploads/uploads.service.ts:1251` | N/A | 400, 401, 403, 404, 409, 413, 422, 500 | `apps/api/src/uploads/__tests__/uploads.service.test.ts`, `apps/api/src/uploads/__tests__/uploads.controller.test.ts`, upload integration tests | Uses shared upload/security codes. |
| internal/jobs | `apps/api/src/internal/internal-jobs.service.ts:994` | `WORKER_TIMEOUT` -> promoted job payload code | 404, 409, 500 | `apps/api/src/internal/__tests__/internal-jobs.service.test.ts` | Dead-worker cleanup writes `WORKER_TIMEOUT` to `jobs.error_json`; `GET /api/jobs/:job_id` and admin job listing expose that payload through `JobDto.error_json`, so the code is shared even though it is not thrown through the API error envelope. |
| job-core/timeout-scanner | `packages/job-core/src/timeout-scanner.ts:34` | `TIMEOUT` -> promoted job payload code | N/A | `packages/job-core/src/__tests__/timeout-scanner.test.ts` | Timeout scanner writes `TIMEOUT` to `jobs.error_json`; that payload can flow through the same `JobDto.error_json` response path, so the project-owned timeout code is shared. |

## Common Helper Foundation

- New helper: `apps/api/src/common/errors/api-error.ts::throwApiError`.
- Helper signature: `(code: ErrorCode, message: string, status: HttpStatus, details?: unknown[]) => never`.
- Compatibility tests: `apps/api/src/common/filters/__tests__/http-exception.filter.test.ts` covers helper-thrown 400, 401, 403, 404, 409, 422, and 500 through the existing `HttpExceptionFilter`.
- Migration status: existing domain-local helpers are intentionally left in place for #411/#412; no new domain-local helper was added in #410.
