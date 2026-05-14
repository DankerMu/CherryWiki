## Context

Second-round review was performed after an initial deep review and fix cycle. The repo currently has no tracked diff, but there are delivery-relevant untracked artifacts, including OpenSpec changes, one URL fetcher test, a local auth-state JSON file, and a manual checklist. The latest merged smoke workflow adds useful MinIO/Redis checks, but it can still pass without proving URL fetcher runtime safety or production compose behavior.

Key references:

- `openspec/changes/post-completion-review-hardening/`
- `openspec/changes/admin-model-health-fixes/`
- `cherrywiki_implementation_stage_plan.md`
- `docs/engineering/12_权限安全审计.md`
- `docs/engineering/14_测试验收规范.md`
- `docs/engineering/24_威胁建模与安全用例.md`
- `.github/workflows/live-stack-smoke.yml`
- `apps/url-fetcher-worker/src/ssrf/ip_validator.py`
- `apps/api/src/models/model-config.service.ts`
- `apps/api/src/admin/admin-health.controller.ts`

## Goals / Non-Goals

**Goals:**

- Turn second-round review findings into explicit implementation issues.
- Remove accidental credential exposure from the delivery path.
- Preserve default SSRF protections even when operators configure additional blocked CIDRs.
- Make live-stack smoke tests fail when no tests are discovered and cover the normal URL fetcher runtime path.
- Make OpenSpec artifacts either tracked and validated or clearly excluded from delivery.
- Add safety constraints for admin-triggered outbound health/model probes.

**Non-Goals:**

- Do not redesign the complete auth/session system beyond secret hygiene for local artifacts.
- Do not replace the existing `post-completion-review-hardening` change; this change narrows and operationalizes second-round findings.
- Do not require every unit test to become a live integration test.
- Do not block all admin-configured outbound probes; restrict them enough to avoid internal network fetch primitives.

## Decisions

### D1: Treat auth-state files as secrets, not fixtures

Browser storage state files can contain reusable refresh cookies. They must be ignored by default and never used as committed fixtures. If a test requires authenticated state, it must generate state dynamically in CI or use placeholders that cannot authenticate.

Alternative considered: leave `cherry-auth.json` untracked and rely on human discipline. This is rejected because untracked local files are easy to add accidentally during bulk commits.

### D2: Custom SSRF CIDRs are additive

`SSRF_BLOCKED_CIDRS` must append to built-in forbidden ranges. Built-ins include localhost, RFC1918, link-local/metadata, current-network ranges, IPv6 localhost, IPv6 unique-local, IPv6 link-local, and IPv4-mapped IPv6 variants. Operators can add more blocked networks, but cannot remove the default safety set through this variable.

Alternative considered: keep override semantics and document the risk. This is rejected because one common production customization would silently disable metadata/private-IP protection.

### D3: Egress smoke must exercise normal imports and runtime behavior

The smoke suite should install URL fetcher Python dependencies and execute tests through the package import path or a small live fetcher scenario. Directly loading `ip_validator.py` with synthetic modules is acceptable for unit tests but not sufficient as deployment smoke evidence.

The egress smoke does not need to crawl the public internet. It can use local HTTP servers and DNS/test resolver control to prove redirect revalidation, private/metadata blocking, and proxy-required fail-closed behavior.

### D4: Zero smoke tests are a CI failure

The workflow must override the global `passWithNoTests: true` behavior for smoke runs. A smoke workflow that discovers no tests is a failed deployment signal, even if the repo's general test config allows empty suites for package-level ergonomics.

### D5: Production-stack evidence is named precisely

If the workflow only starts GitHub Actions service containers, it must be described as dependency smoke. If it is called live-stack smoke, it must run enough of the production compose or equivalent service topology to prove the deployment-critical path it claims.

### D6: OpenSpec delivery state is explicit

Before creating implementation issues or marking PRs ready, each OpenSpec change related to the work must be validated. Untracked changes must be intentionally included, archived, or ignored. A missing `.openspec.yaml` is a blocking artifact completeness issue.

### D7: Admin outbound probes get SSRF-style guardrails

Admin model connectivity and Docmost health checks are privileged operations, but they still originate from the server. They must reject unsupported schemes and internal network targets unless an explicit allowlist or local-development override is configured. Error reporting must not expose API keys, cookies, or authorization headers.

## Risks / Trade-offs

- **Risk**: Additive CIDR behavior changes existing deployments that relied on override semantics.
  - **Mitigation**: Document the behavior change and provide a separate explicit escape hatch only if product owners accept the risk; default and recommended behavior remains additive.
- **Risk**: Live-stack smoke tests may increase CI time or flakiness.
  - **Mitigation**: Keep smoke coverage small, deterministic, and local-first; use timeouts and health checks; reserve full production compose smoke for the narrow services under test.
- **Risk**: Blocking private targets in model probes can affect self-hosted model providers.
  - **Mitigation**: Add a documented allowlist for approved internal model endpoints rather than allowing arbitrary internal fetches.
- **Risk**: Secret scanning can produce false positives on examples.
  - **Mitigation**: Use placeholders that are clearly non-secret and maintain allowlist entries only for documented dummy values.

## Migration Plan

1. Remove or rotate the leaked local refresh session outside the repo workflow.
2. Add ignore rules and secret scan coverage before bulk-staging any untracked files.
3. Change URL fetcher CIDR parsing to merge defaults plus configured CIDRs; update tests.
4. Install URL fetcher Python dependencies in the smoke workflow and expand egress smoke coverage.
5. Add `--passWithNoTests=false` to the smoke command.
6. Validate and commit only the intended OpenSpec changes; ignore or move local-only files.
7. Define internal endpoint allowlist parsing before enabling admin outbound private-target blocking, then add targeted tests.

Rollback for runtime changes should be per capability: revert CIDR merge logic and tests only if a replacement hardening mechanism exists; revert smoke workflow changes independently if CI infrastructure fails for non-product reasons.

## Open Questions

- Which command should become the canonical pre-commit secret scan in this repo (`gitleaks`, `detect-secrets`, or GitHub secret scanning only)?
- Should self-hosted/private model providers be allowed through an env-based allowlist, a database flag per model config, or both? The implementation issue must choose one before enabling default private-target blocking.
- Should the live-stack workflow be renamed to dependency smoke if production compose startup is deferred?

## Issue #318 Fixture: Secret Hygiene

Fixture level: expanded
Project profile: other
Blast radius: high

Why expanded:

- The issue touches file ignore behavior and delivery hygiene for auth-state artifacts.
- The issue includes potential credential exposure and manual-test credential handling.
- The issue requires reproducible secret scan evidence before delivery.

Change surface:

- `.gitignore`
- local-only `cherry-auth.json` and `*-auth.json` handling
- manual test checklist delivery location or ignore decision
- secret scanning documentation or script path

Must preserve:

- Existing tracked test fixtures and example files remain commit-capable when they do not contain reusable credentials.
- Developer-local auth state remains usable locally but cannot be accidentally staged under normal workflows.
- Manual test evidence remains reproducible with placeholder credentials.
- Commit-capable auth examples must not use the local artifact naming pattern `*-auth.json`; use non-secret names such as `*.auth.example.json` or a dedicated placeholder fixture path instead.

Must add/change:

- Ignore local browser/auth-state JSON artifacts.
- Ensure `test-checklist.csv` is either converted to placeholder-only tracked manual evidence or excluded from delivery.
- Add or document one reproducible secret scan command.
- Record session rotation/revocation and scan evidence without exposing secret values.

Selected risk packs:

- File IO / path safety / overwrite: ignore rules must cover root and Playwright auth artifact paths without hiding intentional tracked fixtures.
- Error handling / rollback / partial outputs: secret scan must fail on staged/local reusable auth tokens and avoid printing secret values in evidence.
- Documentation / migration notes: operators need a repeatable scan command and manual checklist must use placeholders or stay local-only.

Risk packs considered:

- Public API / CLI / script entry: not selected - no runtime API, CLI, or script entrypoint behavior changes are required.
- Config / project setup: selected - `.gitignore` and delivery check conventions affect project setup.
- File IO / path safety / overwrite: selected - auth-state file patterns and manual checklist delivery handling are the core change.
- Schema / columns / units / field names: not selected - no application data schema or field contract changes.
- Geospatial / CRS / shapefile sidecars: not selected - no geospatial artifacts are touched.
- Time series / forcing / temporal boundaries: not selected - no temporal data behavior is touched.
- Numerical stability / conservation / NaN: not selected - no numerical behavior is touched.
- Solver runtime / performance / threading: not selected - no solver or runtime performance surface is touched.
- Resource limits / large input / discovery: not selected - no large-input discovery behavior changes are required.
- Legacy compatibility / examples: selected - ignore rules must not make legitimate tracked examples or fixtures disappear.
- Error handling / rollback / partial outputs: selected - delivery must fail closed when secrets are detected.
- Release / packaging / dependency compatibility: not selected - no package dependency or release artifact changes are expected.
- Documentation / migration notes: selected - scan and manual checklist handling must be documented for maintainers.

Required evidence:

- `git check-ignore cherry-auth.json local-auth.json playwright/.auth/state.json`: all paths are ignored.
- `git check-ignore --no-index tests/fixtures/test-corpus-small/parsed-auth-design.md tests/manual/stage8-e2e-checklist.md`: expected no output, proving tracked non-secret fixtures/manual docs are not hidden by the new patterns.
- `git check-ignore --no-index tests/fixtures/auth-state.placeholder.json`: expected no output, proving non-secret JSON placeholder fixtures remain commit-capable when they avoid the `*-auth.json` local-artifact pattern.
- `git status --short`: no reusable auth JSON or real credential checklist is staged.
- Secret scan command documented in the repo and executed with a zero finding summary, excluding secret values.
- Issue/PR comment records session rotation or revocation completion without token values.

Non-goals:

- Do not redesign session issuance, refresh token storage, or server-side auth flows.
- Do not commit local browser storage state as a fixture.
- Do not allow placeholder/example auth JSON to use `*-auth.json`; that pattern is reserved for ignored local auth-state artifacts.
- Do not expose token, cookie, or password values in docs, PR evidence, or issue comments.

Review focus:

- Ignore patterns cover expected auth-state artifacts without overmatching source fixtures.
- Checklist credentials are placeholders or the checklist is excluded from delivery.
- Secret scan command is reproducible on a clean checkout.
- Evidence text does not include secret material.
