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

## Issue #319 Fixture: URL Fetcher SSRF and Proxy Hardening

Fixture level: expanded
Project profile: other
Blast radius: high

Why expanded:

- The issue changes network egress security defaults and proxy-required behavior.
- The issue touches runtime URL fetching, redirect handling, and startup configuration validation.
- The issue must preserve built-in SSRF protections while adding operator-configured blocked CIDRs.

Change surface:

- `apps/url-fetcher-worker/src/ssrf/ip_validator.py`
- URL fetcher configuration and startup paths that parse `SSRF_BLOCKED_CIDRS`, `EGRESS_PROXY_REQUIRED`, and `EGRESS_PROXY_URL`
- URL fetcher redirect handling/runtime fetch path
- `apps/url-fetcher-worker/tests/**`

Must preserve:

- Built-in localhost, RFC1918, link-local, metadata, current-network, IPv6 localhost, IPv6 ULA, IPv6 link-local, and IPv4-mapped IPv6 blocking remains enabled when no custom CIDRs are configured.
- Public, non-blocked destinations remain fetchable when proxy-required mode is disabled and normal SSRF validation passes.
- Malformed CIDR configuration continues to fail closed rather than silently weakening validation.
- Existing successful proxy behavior remains compatible when `EGRESS_PROXY_REQUIRED=true` and a reachable proxy is configured.

Must add/change:

- `SSRF_BLOCKED_CIDRS` appends to the built-in forbidden ranges instead of replacing them.
- Proxy-required mode fails during startup/configuration when no proxy URL is configured.
- Proxy-required runtime failures do not retry through direct egress when the proxy is unreachable.
- Redirect targets are re-resolved and revalidated before any redirected request is fetched.

Selected risk packs:

- Public API / CLI / script entry: environment-variable behavior is part of the worker operator contract.
- Config / project setup: SSRF and proxy settings must be parsed consistently and fail closed on invalid values.
- File IO / path safety / overwrite: not selected for implementation behavior, but path safety is not involved because the change is network egress only.
- Resource limits / large input / discovery: redirect handling must remain bounded by existing redirect/fetch limits and must not introduce unbounded resolution loops.
- Legacy compatibility / examples: default allow/block behavior for existing deployments without custom CIDRs must be preserved.
- Error handling / rollback / partial outputs: proxy and CIDR failures must stop before unsafe direct egress or partial private-target fetches occur.
- Documentation / migration notes: changed additive semantics and proxy-required failure modes need operator-facing notes or test evidence.

Risk packs considered:

- Public API / CLI / script entry: selected - env vars configure worker startup and runtime egress behavior.
- Config / project setup: selected - CIDR and proxy env parsing are the core change.
- File IO / path safety / overwrite: not selected - no filesystem read/write, publish, overwrite, symlink, or path behavior is changed.
- Schema / columns / units / field names: not selected - no data schema or field contract changes.
- Geospatial / CRS / shapefile sidecars: not selected - no geospatial artifacts are touched.
- Time series / forcing / temporal boundaries: not selected - no temporal data behavior is touched.
- Numerical stability / conservation / NaN: not selected - no numerical behavior is touched.
- Solver runtime / performance / threading: not selected - no solver, threading, or numerical runtime surface is touched.
- Resource limits / large input / discovery: selected - redirect chains and DNS/address validation must remain bounded and deterministic.
- Legacy compatibility / examples: selected - no-custom-CIDR deployments and normal public URL fetches must keep working.
- Error handling / rollback / partial outputs: selected - invalid config, unreachable proxy, and private redirects must fail closed with no direct fallback.
- Release / packaging / dependency compatibility: not selected - no new runtime dependency is required for this issue.
- Documentation / migration notes: selected - additive CIDR semantics are a behavior change from replacement semantics.

Required evidence:

- `PYTHONPATH=apps/url-fetcher-worker apps/url-fetcher-worker/.venv/bin/pytest apps/url-fetcher-worker/tests -q`: URL fetcher tests pass with the worker virtualenv.
- Test `SSRF_BLOCKED_CIDRS=203.0.113.0/24`: `203.0.113.10`, `10.1.2.3`, `127.0.0.1`, `169.254.169.254`, and `::ffff:10.0.0.1` are blocked.
- Test unset/empty `SSRF_BLOCKED_CIDRS`: built-in blocked ranges still fail and a representative public IP remains allowed.
- Test malformed `SSRF_BLOCKED_CIDRS`: worker configuration construction or startup raises an explicit configuration error.
- Test `EGRESS_PROXY_REQUIRED=true` with missing proxy URL: startup/configuration fails before fetching.
- Test `EGRESS_PROXY_REQUIRED=true` with an unreachable proxy URL: fetch fails through the proxy path and never falls back to a direct request.
- Test public URL redirecting to a private or metadata target: redirect target is blocked before private-target fetch.

Non-goals:

- Do not implement live-stack smoke workflow changes in #319; those belong to #320.
- Do not add admin model/Docmost outbound probe allowlists in #319; those belong to #322.
- Do not weaken or remove built-in blocked ranges to preserve custom CIDR compatibility.
- Do not add a broad direct-egress fallback for proxy-required deployments.

Review focus:

- Built-in and custom CIDR lists are additive in all construction paths.
- IPv4-mapped IPv6 private/metadata addresses are normalized and blocked.
- Redirect validation uses the effective redirected target, not only the original URL.
- Proxy-required mode cannot silently perform direct outbound requests.
- Tests exercise the normal package/runtime paths rather than only private helper functions.

## Issue #320 Fixture: Live-Stack Smoke Reliability

Fixture level: expanded
Project profile: other
Blast radius: high

Why expanded:

- The issue changes CI deployment evidence and smoke workflow fail/pass behavior.
- The issue touches smoke test discovery, worker Python dependency setup, and URL fetcher runtime-path coverage.
- The issue must preserve existing MinIO/Redis/BullMQ smoke evidence while adding egress runtime coverage.

Change surface:

- `.github/workflows/live-stack-smoke.yml`
- `tests/smoke/egress-smoke.test.ts`
- `tests/smoke/minio-smoke.test.ts`
- `tests/smoke/redis-smoke.test.ts`
- URL fetcher worker test/runtime command wiring used by smoke evidence

Must preserve:

- MinIO smoke continues to create, read, and clean up an object through real S3-compatible credentials.
- Redis smoke continues to ping Redis and persist/retrieve a BullMQ job through the configured Redis URL.
- Smoke workflow still runs on PRs that change URL fetcher, smoke tests, shared packages, or the smoke workflow.
- URL fetcher egress smoke remains deterministic and local-first; it must not depend on public internet availability.

Must add/change:

- The Vitest smoke command fails when zero smoke tests are discovered.
- Egress smoke uses normal URL fetcher package imports and installed worker dependencies instead of direct `ip_validator.py` file loading.
- Egress smoke or equivalent targeted smoke evidence covers redirect-to-private blocking and proxy-required fail-closed behavior.
- Workflow naming, comments, or evidence must accurately state whether it proves dependency containers or production compose topology.
- Environment assumptions for MinIO, Redis/BullMQ, and URL fetcher dependency setup must be visible in workflow/test evidence.

Selected risk packs:

- Public API / CLI / script entry: CI workflow commands and smoke test entrypoints are release gates.
- Config / project setup: worker Python dependencies and `PYTHONPATH`/package import setup are core behavior.
- Resource limits / large input / discovery: test discovery must fail closed and smoke execution must remain bounded/local.
- Legacy compatibility / examples: existing MinIO and Redis/BullMQ smoke coverage must keep working.
- Error handling / rollback / partial outputs: missing tests, missing dependencies, broken imports, unsafe redirects, and proxy-required failures must fail CI rather than pass silently.
- Release / packaging / dependency compatibility: smoke must detect missing URL fetcher runtime dependencies used in deployment.
- Documentation / migration notes: workflow scope and dependency-container assumptions must be explicit.

Risk packs considered:

- Public API / CLI / script entry: selected - workflow/test commands are CI release-gate entrypoints.
- Config / project setup: selected - dependency install, `PYTHONPATH`, env vars, MinIO, and Redis setup are the core change.
- File IO / path safety / overwrite: not selected - no file publish/delete/overwrite behavior is changed beyond test source edits.
- Schema / columns / units / field names: not selected - no data schema or field contract changes.
- Geospatial / CRS / shapefile sidecars: not selected - no geospatial artifacts are touched.
- Time series / forcing / temporal boundaries: not selected - no temporal data behavior is touched.
- Numerical stability / conservation / NaN: not selected - no numerical behavior is touched.
- Solver runtime / performance / threading: not selected - no solver or threaded runtime surface is touched.
- Resource limits / large input / discovery: selected - zero-test discovery and bounded local smoke behavior are central.
- Legacy compatibility / examples: selected - existing MinIO/Redis smoke tests must remain intact.
- Error handling / rollback / partial outputs: selected - CI must fail closed on missing smoke tests, missing worker deps/imports, unsafe redirects, and proxy-required misconfiguration.
- Release / packaging / dependency compatibility: selected - smoke must use the worker dependency set rather than bypassing it.
- Documentation / migration notes: selected - workflow scope must be accurately named/described.

Required evidence:

- `pnpm exec vitest run tests/smoke/ --config vitest.config.ts --passWithNoTests=false`: smoke tests pass and would fail on zero discovered tests.
- A CI/workflow command installs or otherwise uses `apps/url-fetcher-worker/requirements.txt` before egress smoke runs.
- Egress smoke imports URL fetcher through the normal package path such as `src.fetcher`/`src.main`; direct `ip_validator.py` file loading is removed.
- Egress smoke or targeted smoke evidence verifies a public/local allowed URL redirecting to private/metadata is blocked before private-target fetch.
- Egress smoke or targeted smoke evidence verifies proxy-required mode fails closed when proxy URL is missing or unreachable.
- MinIO and Redis smoke tests still run and prove create/read/cleanup plus BullMQ persistence.
- Workflow name/comment/evidence states dependency-container smoke unless compose-based production topology checks are added.

Non-goals:

- Do not re-implement URL fetcher SSRF semantics; #319 already owns runtime behavior.
- Do not add admin model or Docmost outbound probe safety; #322 owns that.
- Do not triage all unrelated OpenSpec artifacts; #321 owns global delivery integrity.
- Do not make smoke depend on external public internet.

Review focus:

- Smoke cannot pass with zero tests.
- Egress smoke fails if URL fetcher dependencies or package imports are broken.
- Runtime `UrlFetcher` behavior, not only isolated `IpValidator`, is covered.
- Existing MinIO/Redis/BullMQ evidence remains active.
- Workflow naming and evidence do not overclaim production compose coverage.

## Issue #322 Fixture: Admin Outbound Probe Safety

Fixture level: expanded
Project profile: other
Blast radius: high

Why expanded:

- The issue changes server-originated outbound requests reachable from admin actions and health checks.
- The issue touches security-sensitive URL validation, DNS/IP classification, allowlist configuration, and error sanitization.
- The issue must preserve legitimate public and explicitly allowlisted self-hosted model/Docmost endpoints.

Change surface:

- `apps/api/src/models/model-config.service.ts`
- `apps/api/src/admin/admin-health.controller.ts`
- Shared admin outbound validation helpers or tests if introduced
- `apps/api/src/models/__tests__/model-config.service.test.ts`
- `apps/api/src/admin/__tests__/admin-health.test.ts`
- Operator-facing docs or environment examples for admin outbound allowlist configuration

Must preserve:

- Existing public model connectivity probes for chat, embedding, and rerank providers continue to execute normally when API keys and public endpoints are valid.
- `MODEL_API_BASE_URL` fallback remains supported when model-level `base_url` is absent, but it is subject to the same validation.
- Docmost health remains `not_configured` when `DOCMOST_BASE_URL` is unset.
- Public Docmost health checks keep bounded timeout behavior and report healthy/unhealthy status without exposing request internals.
- Approved self-hosted/internal endpoints remain possible through an explicit documented allowlist.

Must add/change:

- Admin model probes and Docmost health checks reject non-HTTP(S) schemes before any outbound fetch.
- Targets resolving to localhost, RFC1918/private, link-local, metadata, current-network, IPv6 localhost, IPv6 ULA, IPv6 link-local, or IPv4-mapped blocked ranges are blocked by default.
- A documented admin outbound allowlist permits approved internal hosts/CIDRs for model and Docmost probes.
- Probe and health-check errors are sanitized before returning to the admin UI or audit metadata.
- Tests cover unsupported scheme, blocked localhost/private/metadata targets, allowlisted internal endpoint, bounded Docmost timeout behavior, and sanitized auth/network errors.

Selected risk packs:

- Public API / CLI / script entry: admin model test and health endpoints are API surfaces.
- Config / project setup: allowlist and fallback URL environment variables define operator behavior.
- Resource limits / large input / discovery: DNS/target validation and outbound checks must remain bounded.
- Legacy compatibility / examples: public providers and existing Docmost health behavior must keep working.
- Error handling / rollback / partial outputs: invalid schemes, unsafe targets, timeout, DNS/fetch failures, and auth errors must fail closed with sanitized messages.
- Release / packaging / dependency compatibility: implementation should avoid adding heavyweight dependencies or must fit the existing Node runtime.
- Documentation / migration notes: operators need a clear allowlist path for approved internal/self-hosted endpoints.

Risk packs considered:

- Public API / CLI / script entry: selected - admin probe and health endpoints are user/admin visible API behavior.
- Config / project setup: selected - allowlist env/config and model fallback env are central.
- File IO / path safety / overwrite: not selected - no filesystem publish/delete/path behavior is changed.
- Schema / columns / units / field names: not selected - no database schema or response field rename is required.
- Geospatial / CRS / shapefile sidecars: not selected - no geospatial artifacts are touched.
- Time series / forcing / temporal boundaries: not selected - no temporal data behavior is touched.
- Numerical stability / conservation / NaN: not selected - no numerical behavior is touched.
- Solver runtime / performance / threading: not selected - no solver/threaded runtime behavior is touched.
- Resource limits / large input / discovery: selected - DNS resolution, validation, fetch timeout, and error handling must be bounded.
- Legacy compatibility / examples: selected - public model and Docmost checks must keep existing successful behavior.
- Error handling / rollback / partial outputs: selected - unsafe or failing outbound probes must not make partial unsafe requests or leak secrets.
- Release / packaging / dependency compatibility: selected - API service runtime should not gain fragile unmanaged dependencies.
- Documentation / migration notes: selected - internal/self-hosted endpoint migration requires documented allowlist configuration.

Required evidence:

- `pnpm exec vitest run apps/api/src/models/__tests__/model-config.service.test.ts apps/api/src/admin/__tests__/admin-health.test.ts --config vitest.config.ts`: targeted model/admin health tests pass.
- Test unsupported model `base_url` or `MODEL_API_BASE_URL` scheme: returns `{ reachable: false, error: <safe validation error> }` and does not call fetch.
- Test localhost/private/link-local/metadata model target: blocked before fetch unless allowlisted.
- Test allowlisted internal model endpoint: validation permits fetch and existing probe behavior executes.
- Test provider 401/403 or network error containing auth/request details: returned/admin-visible error excludes API keys, cookies, authorization headers, and full request metadata.
- Test unsupported Docmost scheme: health result is unhealthy/safe without fetch.
- Test unsafe Docmost host: blocked unless allowlisted.
- Test Docmost timeout/fetch failure: bounded timeout remains and error is sanitized.
- Document allowlist configuration with examples for approved internal model and Docmost endpoints.

Non-goals:

- Do not redesign model provider storage, secret reference storage, or admin model CRUD.
- Do not remove support for public model providers or explicitly approved self-hosted providers.
- Do not modify URL fetcher worker SSRF semantics; #319 owns worker behavior.
- Do not implement production compose smoke changes; #320 owns smoke reliability.

Review focus:

- Unsupported schemes and unsafe targets are rejected before outbound fetch.
- Allowlist matching is explicit and narrow enough for approved internal endpoints.
- DNS/IP classification covers IPv4, IPv6, and IPv4-mapped IPv6 blocked ranges.
- Error messages and audit metadata cannot leak API keys, cookies, authorization headers, or request internals.
- Existing public provider and Docmost health tests remain compatible.

## Issue #321 Fixture: OpenSpec Artifact Triage and Traceability

Fixture level: expanded
Project profile: other
Blast radius: high

Why expanded:

- The issue governs delivery integrity rather than runtime behavior, but it decides which local OpenSpec artifacts are considered deliverable.
- The issue touches untracked repository artifacts, OpenSpec metadata completeness, and issue-to-spec traceability.
- The issue must not accidentally commit unrelated draft specs or hide delivery-relevant remediation tests.

Change surface:

- `openspec/changes/round2-review-remediation/**`
- Triage documentation for local `openspec/changes/*` directories
- Missing `.openspec.yaml` metadata for any active OpenSpec change retained in the workspace
- GitHub issue/PR evidence comments and PR body traceability

Must preserve:

- Existing tracked OpenSpec changes remain valid.
- Draft or unrelated local OpenSpec changes are not bulk-staged into this remediation PR.
- Already tracked remediation tests, including `apps/url-fetcher-worker/tests/test_main.py`, remain tracked and visible to Git.
- Issue bodies for #317-#322 remain traceable to `openspec/changes/round2-review-remediation/` and relevant spec files.

Must add/change:

- Record an explicit disposition for every currently untracked `openspec/changes/*` directory: commit, defer, archive, or ignore.
- Add `.openspec.yaml` to active change directories that lack it, or explicitly classify those directories as deferred/non-active in the disposition record.
- Capture evidence from `openspec status --change round2-review-remediation`, `openspec validate round2-review-remediation --strict --no-interactive`, `git diff --name-status origin/main...HEAD`, `git status --short --untracked-files=all`, and `git ls-files` checks for de-registered task-only stubs.
- Confirm no untracked remediation tests/checklists/auth artifacts remain implicitly deliverable.
- Only mark OpenSpec tasks complete when the PR or issue includes linked command/commit evidence.

Selected risk packs:

- Public API / CLI / script entry: OpenSpec CLI status and validation commands are delivery gates for this issue.
- Config / project setup: OpenSpec metadata and change status define project workflow behavior.
- File IO / path safety / overwrite: triage must avoid accidentally staging unrelated local directories or deleting user drafts.
- Legacy compatibility / examples: existing archived/tracked OpenSpec changes and tests must remain usable.
- Error handling / rollback / partial outputs: incomplete triage or validation failure must block delivery rather than silently pass.
- Documentation / migration notes: dispositions and issue traceability must be documented for maintainers.

Risk packs considered:

- Public API / CLI / script entry: selected - OpenSpec CLI validation and status commands are used as delivery gates.
- Config / project setup: selected - `.openspec.yaml` metadata and change completeness are the core change.
- File IO / path safety / overwrite: selected - the work involves many untracked directories that must not be bulk-staged or removed accidentally.
- Schema / columns / units / field names: not selected - no application data schema changes.
- Geospatial / CRS / shapefile sidecars: not selected - no geospatial artifacts are touched.
- Time series / forcing / temporal boundaries: not selected - no temporal data behavior is touched.
- Numerical stability / conservation / NaN: not selected - no numerical behavior is touched.
- Solver runtime / performance / threading: not selected - no solver/runtime behavior is touched.
- Resource limits / large input / discovery: not selected - no large-input runtime discovery behavior is changed.
- Legacy compatibility / examples: selected - existing archived specs and tracked tests must remain visible and valid.
- Error handling / rollback / partial outputs: selected - validation failures and untriaged artifacts must not be treated as successful delivery.
- Release / packaging / dependency compatibility: not selected - no package dependency or release artifact behavior is expected.
- Documentation / migration notes: selected - the output is primarily a maintainable disposition/evidence record.

Required evidence:

- `openspec status --change round2-review-remediation`: reports 4/4 artifacts complete.
- `openspec validate round2-review-remediation --strict --no-interactive`: passes.
- `git diff --name-status origin/main...HEAD`: lists tracked PR delivery files, including the removed task-only active stubs.
- `git status --short --untracked-files=all`: every remaining untracked OpenSpec draft is intentionally listed in the triage record and is not implicitly deliverable.
- `git ls-files openspec/changes/docmost-auto-sync openspec/changes/post-completion-review-hardening`: no output, proving the task-only stubs are removed from tracked active OpenSpec state.
- `git ls-files apps/url-fetcher-worker/tests/test_main.py`: confirms the remediation test is tracked.
- Metadata check showing no active OpenSpec change selected for delivery lacks `.openspec.yaml`.
- PR/issue evidence links #321 to `specs/openspec-delivery-integrity/spec.md`, the task checklist, dependencies, and acceptance criteria.

Non-goals:

- Do not implement the feature specs contained in unrelated local OpenSpec draft directories.
- Do not archive or delete user-created draft change directories unless the disposition record explicitly requires it and the workflow has evidence.
- Do not mark tasks from #318, #319, #320, or #322 complete without their already merged PR evidence.
- Do not change runtime application code for this issue.

Review focus:

- Disposition record covers every untracked OpenSpec directory visible in `git status --short`.
- Active changes have `.openspec.yaml`, or deferred changes are clearly non-active.
- Evidence commands are present, reproducible, and match the issue acceptance criteria.
- The PR stages only intended OpenSpec metadata/triage files and does not bulk-commit unrelated draft specs.
