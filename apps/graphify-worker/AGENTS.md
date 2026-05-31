# apps/graphify-worker Agent Instructions

Root authority: `../../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter Graphify-worker boundaries.

## Boundaries

- This worker owns Graphify run execution, Claude Code runner integration, output validation, storage reads/writes, heartbeat, and job completion/failure reporting.
- Preserve the internal worker job protocol: pending/claim, heartbeat, progress, complete, fail, retryability, and active-job cleanup must stay compatible with `apps/api`.
- Do not bypass quarantine, validation reports, size limits, storage URI handling, or Graphify run state transitions.
- Use this worker venv for all Python commands in this subtree; do not use system Python.
- `external/*` is reference or forked third-party code; do not include it in implementation refactors for Graphify-worker work.

## Verification

- `apps/graphify-worker/.venv/bin/python -m pytest apps/graphify-worker/tests -v`
- If Docker wiring changes, also run `docker compose config --quiet`.
