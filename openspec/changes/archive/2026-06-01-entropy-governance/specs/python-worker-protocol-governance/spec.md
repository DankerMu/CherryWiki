## ADDED Requirements

### Requirement: Worker job lifecycle protocol is shared or enforced

The ingestion and URL fetch workers SHALL share or enforce one job lifecycle protocol for pending-job polling, claim, heartbeat, progress, completion, failure reporting, retryability, and active job tracking.

#### Scenario: Protocol behavior matches both workers
- **WHEN** ingestion-worker and url-fetcher-worker claim and run jobs
- **THEN** both use the same protocol semantics for pending-job polling, worker identity, heartbeat payload, progress updates, completion, and failure reporting

#### Scenario: Protocol edge cases are consistent
- **WHEN** pending polling returns no jobs, a claim races another worker, heartbeat/progress API calls fail, a lock expires, active jobs are cleaned up, or completion/failure is retried
- **THEN** ingestion-worker and url-fetcher-worker apply the same retryability, logging, and terminal-state semantics

#### Scenario: Worker-specific behavior remains isolated
- **WHEN** ingestion parsing behavior or URL fetching behavior changes
- **THEN** the shared protocol layer does not need worker-specific parser/fetcher knowledge

### Requirement: Worker migration preserves deployability

The worker protocol refactor SHALL keep local venv tests, Docker builds, and CI commands working for both workers.

#### Scenario: Ingestion worker migration is independently verifiable
- **WHEN** ingestion-worker is migrated to the shared/enforced protocol
- **THEN** `apps/ingestion-worker/.venv/bin/python -m pytest apps/ingestion-worker/tests -v` passes and URL fetch worker behavior remains unchanged

#### Scenario: URL fetch worker migration is independently verifiable
- **WHEN** url-fetcher-worker is migrated to the shared/enforced protocol
- **THEN** `apps/url-fetcher-worker/.venv/bin/python -m pytest apps/url-fetcher-worker/tests -v` passes and ingestion worker behavior remains unchanged
