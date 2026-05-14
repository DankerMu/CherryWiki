## ADDED Requirements

### Requirement: Smoke workflow fails when no tests are discovered
The smoke workflow SHALL fail if the expected smoke test suite discovers zero tests.

#### Scenario: Smoke test path is empty
- **WHEN** `tests/smoke/` is missing, renamed, or no test files match the command
- **THEN** CI MUST fail rather than passing because of a global `passWithNoTests` setting

### Requirement: Egress smoke uses normal URL fetcher dependencies
The egress smoke test SHALL install and use the URL fetcher worker's normal Python dependency set.

#### Scenario: URL fetcher dependency is missing
- **WHEN** `requests`, `dnspython`, or another worker runtime dependency is unavailable
- **THEN** the egress smoke MUST fail instead of bypassing the dependency through direct file loading

#### Scenario: Package import path is broken
- **WHEN** normal `src.*` package imports fail for the URL fetcher worker
- **THEN** the egress smoke MUST fail and surface the import error

### Requirement: Egress smoke covers runtime SSRF behavior
The smoke suite SHALL exercise URL fetcher runtime behavior, not only the `IpValidator` class in isolation.

#### Scenario: Redirect to private IP
- **WHEN** the smoke scenario fetches an allowed URL that redirects to a private or metadata target
- **THEN** the test MUST verify that `UrlFetcher` blocks the redirected target

#### Scenario: Proxy-required fail-closed
- **WHEN** proxy-required mode is enabled with no proxy or an unreachable proxy
- **THEN** the smoke or targeted integration test MUST verify that fetch execution fails closed

### Requirement: Live-stack workflow scope matches evidence
The workflow name and documentation SHALL describe the actual runtime evidence produced.

#### Scenario: Only service containers are used
- **WHEN** the workflow only starts GitHub Actions service containers for MinIO and Redis
- **THEN** it MUST be described as dependency smoke, or additional compose-based checks MUST be added before it is called live-stack proof

#### Scenario: Production compose is claimed as covered
- **WHEN** the workflow claims production stack coverage
- **THEN** it MUST start the relevant production compose services or an equivalent topology and run health/read-write checks through that topology

### Requirement: MinIO and Redis smoke checks prove real connectivity
The smoke suite SHALL keep real MinIO and Redis checks and make their assumptions explicit.

#### Scenario: MinIO smoke runs
- **WHEN** the MinIO smoke test runs
- **THEN** it MUST create, read, and clean up an object through real S3-compatible MinIO credentials

#### Scenario: Redis smoke runs
- **WHEN** the Redis smoke test runs
- **THEN** it MUST ping Redis and persist or retrieve a BullMQ job using the configured Redis URL
