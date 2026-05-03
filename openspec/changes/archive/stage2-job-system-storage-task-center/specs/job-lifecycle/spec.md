## ADDED Requirements

### Requirement: Job creation with idempotency
The system SHALL allow creating jobs with an optional `idempotency_key`. When a `idempotency_key` is provided, the system MUST return the existing job if one already exists for the same `tenant_id` + `idempotency_key` combination, rather than creating a duplicate.

#### Scenario: Create new job
- **WHEN** a service creates a job with type=`ingestion`, space_id, and payload_json
- **THEN** the system inserts a new record in the jobs table with status=`pending`, attempt_count=0, and returns the job id

#### Scenario: Duplicate idempotency key returns existing job
- **WHEN** a service creates a job with an idempotency_key that already exists for the same tenant
- **THEN** the system returns the existing job record without creating a new one

#### Scenario: Same idempotency key across tenants
- **WHEN** two different tenants create jobs with the same idempotency_key
- **THEN** the system creates two separate jobs (uniqueness is per-tenant)

### Requirement: Job state machine enforces valid transitions
The system SHALL enforce a strict state machine for job status transitions. Invalid transitions MUST be rejected with HTTP 409.

Valid transitions:
- `pending → running` (Worker claim)
- `pending → cancelled` (user cancel before start)
- `running → succeeded` (Worker reports completion)
- `running → failed` (Worker reports failure or timeout)
- `running → cancelled` (user cancel during execution)
- `failed → pending` (auto-retry when attempt_count < max_attempts)

#### Scenario: Valid transition from pending to running
- **WHEN** a Worker claims a pending job
- **THEN** the job status changes to `running`, `locked_by` is set to the worker_id, `locked_at` and `started_at` are set to now()

#### Scenario: Invalid transition from succeeded to running
- **WHEN** a Worker attempts to claim a job that is already in `succeeded` status
- **THEN** the system rejects the transition with 409 and the job status remains `succeeded`

#### Scenario: Cancel a pending job
- **WHEN** a user cancels a job that is in `pending` status
- **THEN** the job status changes to `cancelled` and `completed_at` is set to now()

#### Scenario: Cancel a running job
- **WHEN** a user cancels a job that is in `running` status
- **THEN** `cancel_requested_at` is set to now(), the API returns `status=running` with `cancel_requested_at` set, and the Worker detects this via heartbeat response or next progress report; the job transitions to `cancelled` only when the Worker acknowledges

#### Scenario: Repeated cancel is idempotent
- **WHEN** a user cancels a job that already has `cancel_requested_at` set or is already `cancelled`
- **THEN** the system returns the current job state without error

### Requirement: Job retry on failure
The system SHALL automatically retry failed jobs when `attempt_count < max_attempts` and the failure is marked as retryable.

#### Scenario: Retryable failure with attempts remaining
- **WHEN** a Worker reports failure with `retryable=true` and `attempt_count` (1) < `max_attempts` (3)
- **THEN** the job status transitions to `pending`, `attempt_count` increments by 1, and `next_run_at` is set with exponential backoff

#### Scenario: Non-retryable failure
- **WHEN** a Worker reports failure with `retryable=false`
- **THEN** the job status transitions to `failed` permanently, `error_json` is stored, and `completed_at` is set

#### Scenario: Max attempts exhausted
- **WHEN** a Worker reports failure and `attempt_count` equals `max_attempts`
- **THEN** the job status transitions to `failed` permanently regardless of retryable flag

### Requirement: Job timeout detection
The system SHALL run a periodic scanner that detects jobs stuck in `running` status beyond their `timeout_seconds`.

#### Scenario: Running job exceeds timeout
- **WHEN** a job has been in `running` status and `locked_at + timeout_seconds < now()`
- **THEN** the scanner marks the job as `failed` with `error_json` containing `{"code": "TIMEOUT", "message": "Job exceeded timeout"}` and releases the lock

#### Scenario: Job with no timeout configured
- **WHEN** a job has `timeout_seconds = NULL`
- **THEN** the scanner uses a global default timeout (30 minutes)

### Requirement: User-facing job query
The system SHALL provide endpoints for users to query their own jobs and for admins to query all jobs. A user MUST be able to see a job if they are the `created_by` user OR have access to the job's Space.

#### Scenario: User queries own job by id
- **WHEN** a user calls GET /api/jobs/{job_id}
- **THEN** the system returns the job if the user is the job creator or has access to the job's Space, otherwise 404

#### Scenario: Job creator can query regardless of space access
- **WHEN** a user who created a job but no longer has Space access calls GET /api/jobs/{job_id}
- **THEN** the system returns the job (creator always has read access)

#### Scenario: User queries job events
- **WHEN** a user calls GET /api/jobs/{job_id}/events
- **THEN** the system returns a chronological list of state transitions and progress updates for that job

#### Scenario: Admin lists jobs with filters
- **WHEN** an admin calls GET /api/admin/jobs with query params type=`graphify`, status=`failed`
- **THEN** the system returns paginated jobs matching the filters across all spaces

### Requirement: Job events persistence
The system SHALL persist all state transitions and progress updates as `job_events` records, providing a complete audit trail for each job.

#### Scenario: State transition creates event
- **WHEN** a job transitions from `pending` to `running`
- **THEN** a `job_events` record is created with `event_type=status_changed` and `detail_json` containing `{from: "pending", to: "running", worker_id: "..."}`

#### Scenario: Progress update creates event
- **WHEN** a Worker reports progress with percent=45 and stage="chunking"
- **THEN** a `job_events` record is created with `event_type=progress_updated` and `detail_json` containing `{percent: 45, stage: "chunking"}`

#### Scenario: Query events returns chronological list
- **WHEN** a user calls GET /api/jobs/{job_id}/events
- **THEN** all `job_events` for that job are returned ordered by `created_at` ASC

### Requirement: Job priority ordering
The system SHALL dispatch pending jobs in priority order (lower number = higher priority) within the same queue.

#### Scenario: Higher priority job dispatched first
- **WHEN** two pending jobs exist in the same queue with priority 50 and priority 100
- **THEN** the job with priority 50 is dispatched to a Worker before the job with priority 100
