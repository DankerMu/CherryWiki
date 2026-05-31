# tools Agent Instructions

Root authority: `../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter tool-local boundaries.

## Boundaries

- Tools are CLI/runtime utilities consumed by agents or workers. Preserve command names, stdout/stderr shape, exit codes, environment variables, timeouts, and callback/audit side effects unless the issue explicitly changes the CLI contract.
- Keep `tools/cherrydb` read-only by default: preserve SQL validation, AST allowlist behavior, timeout handling, chart envelope output, and chart callback behavior.
- Keep `tools/cherrywiki` as an API-facing wiki utility; do not import API internals when an HTTP/API contract exists.
- Local tool tests should use an existing project venv, not system Python.
- `external/*` is reference or forked third-party code; do not include it in implementation refactors for tool work.

## Verification

- `apps/graphify-worker/.venv/bin/python -m pytest tools/cherrydb/tests -v`
- `apps/graphify-worker/.venv/bin/python -m pytest tools/cherrywiki/tests -v`
