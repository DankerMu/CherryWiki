# packages Agent Instructions

Root authority: `../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter package-local boundaries.

## Boundaries

- Packages are shared contracts and domain logic, not app feature modules. Keep them framework-neutral by default: no React, browser storage, controllers, HTTP exceptions, or app-local service orchestration.
- `auth-core` already owns guard/decorator integration; do not let that exception spread into unrelated packages.
- Apps may depend on packages; packages must not import from `apps/*`.
- Canonical shared enums, error codes, schemas, job contracts, graph/wiki/rag helpers, and permission utilities belong here when they are reused by more than one app.
- `external/*` is reference or forked third-party code; do not include it in implementation refactors for package work.

## Verification

- `pnpm --filter @cherrygraph/<package-name> test`
- `pnpm --filter @cherrygraph/<package-name> typecheck`
- `pnpm --filter @cherrygraph/<package-name> build`
