# apps/ingestion-worker Agent Instructions

Root authority: `../../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter ingestion-worker boundaries.

## Boundaries

- This worker owns source document parsing after archive/upload, parser output normalization, storage writes, and ingestion job lifecycle reporting.
- Preserve parser safety behavior for MIME/magic-byte validation, ZIP handling, prompt-injection markers, parse failures, and retryable vs non-retryable errors.
- Keep the worker job protocol compatible with `apps/api`: pending/claim, heartbeat, progress, complete, fail, retryability, and active-job cleanup.
- Use this worker venv for all Python commands in this subtree; do not use system Python.
- `external/*` is reference or forked third-party code; do not include it in implementation refactors for ingestion-worker work.

## Verification

- `apps/ingestion-worker/.venv/bin/python -m pytest apps/ingestion-worker/tests -v`
- If Docker wiring changes, also run `docker compose config --quiet`.
