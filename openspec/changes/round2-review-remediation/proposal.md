## Why

Second-round review found that several post-completion hardening items can still ship with false confidence: a local browser auth artifact contains a refresh cookie, URL fetcher custom CIDR configuration weakens built-in SSRF blocking, the live-stack smoke workflow can pass while missing critical egress/runtime paths, and OpenSpec/test artifacts remain untracked or incomplete.

This change turns the review findings into a focused remediation stage before the current model/admin and ops hardening work is considered ready for delivery.

## What Changes

- Prevent browser auth-state JSON and local manual-test credential files from being committed, and require secret scanning before delivery.
- Make `SSRF_BLOCKED_CIDRS` additive so built-in localhost/private/link-local/metadata protections are always retained.
- Replace shallow egress smoke coverage with tests that exercise the normal URL fetcher import/runtime path, installed Python dependencies, redirect revalidation, proxy-required fail-closed behavior, and expected test discovery.
- Tighten the live-stack smoke workflow so zero discovered tests fail CI and the workflow name/scope accurately reflects what is proven.
- Require OpenSpec change artifacts and manual-test evidence to be explicitly tracked, validated, or ignored before issues/PRs are marked ready.
- Add admin-configured model endpoint safety requirements so model connectivity probes cannot become an admin-triggered internal network fetch primitive.

## Capabilities

### New Capabilities

- `delivery-secret-hygiene`: local auth artifacts, manual credential records, ignore rules, and pre-delivery secret scanning.
- `url-fetcher-egress-ssrf-safety`: URL fetcher SSRF configuration semantics, proxy fail-closed behavior, redirect revalidation, and regression tests.
- `live-stack-smoke-reliability`: smoke workflow discovery guarantees, dependency installation, runtime-path egress coverage, and production-stack evidence.
- `openspec-delivery-integrity`: change artifact completeness, validation, tracking decisions, and issue linkage.
- `admin-outbound-probe-safety`: safety constraints for admin model connectivity probes and Docmost/admin health outbound checks.

### Modified Capabilities

- None. This repository does not currently have archived OpenSpec baseline specs; the above capabilities define the remediation contract for the second-round review.

## Impact

- **Repo hygiene**: `.gitignore`, local auth-state conventions, manual test checklist handling, secret scan documentation/CI.
- **URL fetcher**: `apps/url-fetcher-worker/src/ssrf/*`, `apps/url-fetcher-worker/src/main.py`, URL fetcher tests and Python dependency setup.
- **CI/smoke**: `.github/workflows/live-stack-smoke.yml`, `tests/smoke/*`, Docker Compose smoke setup, Vitest smoke command flags.
- **OpenSpec/issue flow**: `openspec/changes/*`, issue templates/bodies, validation evidence.
- **Admin/model health**: `apps/api/src/models/model-config.service.ts`, `apps/api/src/admin/admin-health.controller.ts`, associated tests and API/operator guidance.
