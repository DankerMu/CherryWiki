# apps/indexer-worker Agent Instructions

Root authority: `../../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter indexer-worker boundaries.

## Boundaries

- This Node worker owns wiki indexing jobs, chunk/embedding writes, source-chain preservation, snapshot activation, and index job health.
- Reuse `@cherrygraph/job-core`, `@cherrygraph/rag-core`, and `@cherrygraph/shared` contracts instead of redefining job payloads, status values, or schema types.
- Preserve idempotency, snapshot consistency, retry behavior, and failure reporting when touching indexing flows.
- `external/*` is reference or forked third-party code; do not include it in implementation refactors for indexer-worker work.

## Verification

- `pnpm --filter @cherrygraph/indexer-worker test`
- `pnpm --filter @cherrygraph/indexer-worker typecheck`
- `pnpm --filter @cherrygraph/indexer-worker build`
