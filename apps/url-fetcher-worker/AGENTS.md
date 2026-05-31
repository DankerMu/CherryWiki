# apps/url-fetcher-worker Agent Instructions

Root authority: `../../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter URL-fetcher boundaries.

## Boundaries

- This worker owns URL source fetching, SSRF defense, redirect handling, response limits, storage writes, and URL-fetch job lifecycle reporting.
- Preserve SSRF protections for private IPs, metadata endpoints, DNS rebinding, redirects, oversized responses, and egress-proxy assumptions.
- Keep the worker job protocol compatible with `apps/api`: pending/claim, heartbeat, progress, complete, fail, retryability, and active-job cleanup.
- Use this worker venv for all Python commands in this subtree; do not use system Python.
- `external/*` is reference or forked third-party code; do not include it in implementation refactors for URL-fetcher work.

## Verification

- `apps/url-fetcher-worker/.venv/bin/python -m pytest apps/url-fetcher-worker/tests -v`
- If Docker networking or proxy assumptions change, also run `docker compose config --quiet`.
