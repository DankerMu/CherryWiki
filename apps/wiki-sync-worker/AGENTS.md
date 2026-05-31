# apps/wiki-sync-worker Agent Instructions

Root authority: `../../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter wiki-sync-worker boundaries.

## Boundaries

- This Node worker owns Docmost bridge synchronization jobs: page sync, permission sync, user/space provisioning, Docmost push, and reconciliation.
- Reuse `@cherrygraph/wiki-core` and `@cherrygraph/shared` contracts instead of redefining wiki status, block ownership, bridge event, or permission payload shapes.
- Preserve idempotency, debounce/coalescing behavior, permission mapping, human-block protection, and retry/failure reporting.
- Treat `external/docmost` and all `external/*` paths as reference or forked third-party code; do not include them in implementation refactors for wiki-sync work.

## Verification

- `pnpm --filter @cherrygraph/wiki-sync-worker test`
- `pnpm --filter @cherrygraph/wiki-sync-worker build`
