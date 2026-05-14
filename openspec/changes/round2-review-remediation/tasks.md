## 1. Delivery Secret Hygiene

- [ ] 1.1 Revoke or rotate the refresh session found in local `cherry-auth.json`; record completion in the issue without exposing token values.
- [ ] 1.2 Add ignore rules for local auth-state artifacts such as `cherry-auth.json`, `*-auth.json`, and `playwright/.auth/*.json`.
- [ ] 1.3 Triage `test-checklist.csv`: either move it into a tracked manual-test location with placeholder credentials or ignore/remove it from delivery.
- [ ] 1.4 Add or document a reproducible secret scan command for delivery checks.
- [ ] 1.5 Run the secret scan and record command/output summary in the implementation PR or issue.

## 2. URL Fetcher SSRF and Proxy Hardening

- [x] 2.1 Change `SSRF_BLOCKED_CIDRS` handling so configured CIDRs are appended to built-in forbidden ranges instead of replacing them.
- [x] 2.2 Update URL fetcher tests to assert custom CIDR plus built-in RFC1918, localhost, metadata, and IPv4-mapped IPv6 ranges remain blocked.
- [x] 2.3 Keep malformed CIDR configuration fail-closed and add/retain startup tests for invalid values.
- [x] 2.4 Add regression coverage for proxy-required mode with missing and unreachable proxy configuration.
- [x] 2.5 Add redirect revalidation coverage where an initially allowed URL redirects to a private or metadata address.

## 3. Live-Stack Smoke Reliability

- [ ] 3.1 Update `.github/workflows/live-stack-smoke.yml` so the Vitest smoke command fails when zero tests are discovered.
- [ ] 3.2 Install URL fetcher Python dependencies in the smoke workflow or run the egress smoke inside a prepared worker environment.
- [ ] 3.3 Replace direct `ip_validator.py` file loading in egress smoke with normal package import or a small runtime `UrlFetcher` scenario.
- [ ] 3.4 Add smoke/integration coverage for redirect-to-private blocking and proxy-required fail-closed behavior.
- [ ] 3.5 Decide whether the workflow proves production compose topology; either add compose-based runtime checks or rename/document it as dependency smoke.
- [ ] 3.6 Retain MinIO create/read/cleanup and Redis/BullMQ persistence checks and document their environment assumptions.

## 4. OpenSpec Delivery Integrity

- [ ] 4.1 Triage all untracked `openspec/changes/*` directories as commit, defer, archive, or ignore before final delivery.
- [ ] 4.2 Add missing `.openspec.yaml` metadata to active change directories, including `phase3-persistent-agent-runtime` if it remains active.
- [ ] 4.3 Ensure any remediation tests, including `apps/url-fetcher-worker/tests/test_main.py`, are tracked or replaced by equivalent tracked tests.
- [ ] 4.4 Run `openspec status --change round2-review-remediation` and relevant existing change validations; include outputs in issue/PR evidence.
- [ ] 4.5 Only mark OpenSpec task checkboxes complete after linking commit/test evidence.
- [ ] 4.6 Create and link the GitHub epic and sub-issues with OpenSpec change path, relevant spec files, dependencies, task checklist, and acceptance criteria in every issue body.

## 5. Admin Outbound Probe Safety

- [ ] 5.1 Define and document the admin outbound allowlist configuration for approved internal/self-hosted model and Docmost endpoints.
- [ ] 5.2 Add URL scheme validation to admin model connectivity probes and Docmost health checks.
- [ ] 5.3 Add SSRF-style target validation for model probe and Docmost health host resolution, blocking localhost/private/link-local/metadata targets by default unless allowlisted.
- [ ] 5.4 Sanitize model probe and health-check error messages before returning them to the UI or audit metadata.
- [ ] 5.5 Add tests for unsupported scheme, blocked localhost/private/metadata target, allowlisted internal endpoint, bounded Docmost timeout behavior, and sanitized auth/network errors.

## 6. Final Validation

- [ ] 6.1 Run targeted URL fetcher Python tests with the worker virtual environment.
- [ ] 6.2 Run targeted Vitest suites for smoke helpers, admin model connectivity, and admin health checks.
- [ ] 6.3 Run the updated smoke workflow command locally where possible.
- [ ] 6.4 Update GitHub issues with validation evidence and remaining known risks.

## Issue #318 Evidence Mapping

Selected risk packs:

- Config / project setup: covered by 1.2 and the `git check-ignore` evidence command.
- File IO / path safety / overwrite: covered by 1.2, 1.3, and `git status --short` evidence showing no auth-state artifact is staged.
- Legacy compatibility / examples: covered by review of ignore patterns against existing tracked fixtures and examples.
- Error handling / rollback / partial outputs: covered by 1.4, 1.5, and a secret scan that fails on reusable secrets while evidence excludes secret values.
- Documentation / migration notes: covered by 1.3, 1.4, and PR/issue evidence for session rotation and scan results.

Required evidence for #318:

- Run `git check-ignore cherry-auth.json local-auth.json playwright/.auth/state.json`; expected output lists all three paths.
- Run `git check-ignore --no-index tests/fixtures/test-corpus-small/parsed-auth-design.md tests/manual/stage8-e2e-checklist.md`; expected output is empty, proving legitimate tracked fixtures and manual docs are not newly hidden.
- Run `git check-ignore --no-index tests/fixtures/auth-state.placeholder.json`; expected output is empty, proving commit-capable placeholder JSON uses a non-local-artifact name and remains visible to Git.
- Run `git status --short`; expected output does not include any staged reusable auth JSON or real-credential checklist.
- Run the documented secret scan command; expected output reports no committed or staged reusable credentials.
- Record that the local refresh session was revoked or rotated, without token values.

Non-goals for #318:

- No runtime auth/session implementation changes.
- No committed browser storage-state fixture.
- No placeholder/example auth JSON using the reserved local-artifact pattern `*-auth.json`.
- No changes to URL fetcher, smoke workflow, OpenSpec delivery integrity, or admin outbound probe safety tasks outside the secret-hygiene issue.

## Issue #319 Evidence Mapping

Selected risk packs:

- Public API / CLI / script entry: covered by 2.1, 2.3, 2.4, and tests that exercise env-var-driven construction/startup behavior.
- Config / project setup: covered by 2.1 and 2.3, including additive CIDR parsing and malformed CIDR fail-closed behavior.
- Resource limits / large input / discovery: covered by 2.5 and redirect tests that prove revalidation stays within the existing bounded fetch/redirect behavior.
- Legacy compatibility / examples: covered by 2.2 tests for unset/empty custom CIDRs and representative public destination allow behavior.
- Error handling / rollback / partial outputs: covered by 2.3, 2.4, and 2.5 tests for invalid config, missing/unreachable proxy, and private redirects.
- Documentation / migration notes: covered by implementation notes or docs/test names explaining additive CIDR semantics and proxy-required fail-closed behavior.

Required evidence for #319:

- Run `PYTHONPATH=apps/url-fetcher-worker apps/url-fetcher-worker/.venv/bin/pytest apps/url-fetcher-worker/tests -q`; expected result is pass.
- Add/retain a test with `SSRF_BLOCKED_CIDRS=203.0.113.0/24`; expected result is that `203.0.113.10`, `10.1.2.3`, `127.0.0.1`, `169.254.169.254`, and `::ffff:10.0.0.1` are blocked.
- Add/retain a test with `SSRF_BLOCKED_CIDRS` unset or empty; expected result is that built-in blocked ranges remain blocked and a representative public IP remains allowed.
- Add/retain a malformed CIDR test; expected result is an explicit configuration/startup failure and no unsafe default allow behavior.
- Add/retain a proxy-required missing URL test; expected result is startup/configuration failure before any fetch.
- Add/retain a proxy-required unreachable proxy test; expected result is request failure with no direct egress fallback.
- Add/retain a redirect test where an initially allowed URL redirects to a private or metadata address; expected result is block before fetching the private target.

Non-goals for #319:

- No live-stack smoke workflow changes; those remain in #320.
- No admin model or Docmost outbound probe safety changes; those remain in #322.
- No new secret-hygiene behavior beyond consuming the already merged #318 repo hygiene baseline.
- No replacement of the URL fetcher architecture or broad HTTP client migration.
