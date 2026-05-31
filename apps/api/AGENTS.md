# apps/api Agent Instructions

Root authority: `../../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter API-local boundaries.

## Boundaries

- This is the NestJS API app. Controllers own REST/SSE shapes; services own orchestration; `src/common/` owns API filters, guards, and common helpers.
- Reuse `packages/*` for domain models, schemas, permissions, job contracts, graph/wiki/rag logic, and shared DTO-like types. Do not copy package models into API modules.
- Keep client-facing error codes in `@cherrygraph/shared` `ErrorCode`; API-specific throwing helpers belong under `apps/api/src/common/**`. Do not add new local `throwApiError` variants.
- Preserve HTTP status, error envelope shape, `details`, and `meta.request_id` when touching error handling.
- Permission checks must stay explicit through `@Permissions`, guards, space permission resolvers, or service-level ACL checks for internal/non-controller paths.
- `external/*` is reference or forked third-party code; do not include it in implementation refactors for API work.

## Verification

- `pnpm --filter @cherrygraph/api test`
- `pnpm --filter @cherrygraph/api typecheck`
- Add narrower Vitest targets when changing a single API domain, then run the full API test command before handoff.
