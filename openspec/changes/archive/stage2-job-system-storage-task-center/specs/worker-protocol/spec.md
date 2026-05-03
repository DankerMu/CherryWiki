## ADDED Requirements

### Requirement: Python Worker polls for pending jobs via HTTP
The system SHALL expose GET /internal/jobs/pending for Python Workers to poll for available jobs. The endpoint MUST be authenticated with `X-Worker-Key` header.

#### Scenario: Worker polls and gets a pending job
- **WHEN** a Python Worker calls GET /internal/jobs/pending?type=graphify&limit=1
- **THEN** the system returns up to 1 pending job of type `graphify` ordered by priority ASC, created_at ASC

#### Scenario: No pending jobs available
- **WHEN** a Python Worker polls and no pending jobs exist for the requested type
- **THEN** the system returns an empty array with HTTP 200

#### Scenario: Invalid worker API key
- **WHEN** a request to /internal/jobs/* has an invalid or missing X-Worker-Key
- **THEN** the system returns HTTP 401

### Requirement: Worker claims job with Redis distributed lock
The system SHALL use Redis SETNX with TTL for distributed job locking. Only one Worker can hold a lock for a given job at a time.

#### Scenario: Worker successfully claims a job
- **WHEN** a Worker receives a pending job from poll and executes `SET job:lock:{job_id} {worker_id} NX EX 600`
- **THEN** the lock is acquired, and the Worker calls PATCH /internal/jobs/{job_id}/progress to transition the job to `running`

#### Scenario: Lock already held by another worker
- **WHEN** a Worker attempts SETNX on a job that is already locked
- **THEN** the SETNX returns false and the Worker skips this job

#### Scenario: Worker crash causes lock expiry
- **WHEN** a Worker crashes while holding a lock and 10 minutes pass
- **THEN** the Redis key expires, and the timeout scanner marks the job as failed (eligible for retry)

### Requirement: Worker reports progress
The system SHALL accept progress updates from Workers during job execution via PATCH /internal/jobs/{job_id}/progress.

#### Scenario: Worker reports progress percentage
- **WHEN** a Worker calls PATCH /internal/jobs/{job_id}/progress with `{worker_id, percent: 45, stage: "chunking"}`
- **THEN** the system updates the job's progress metadata and records a job event

#### Scenario: Worker reports progress for job it does not own
- **WHEN** a Worker calls progress on a job locked by a different worker_id
- **THEN** the system returns HTTP 409

### Requirement: Worker reports completion
The system SHALL accept completion reports from Workers via PATCH /internal/jobs/{job_id}/complete.

#### Scenario: Worker reports successful completion
- **WHEN** a Worker calls PATCH /internal/jobs/{job_id}/complete with `{worker_id, result_json: {...}}`
- **THEN** the job status transitions to `succeeded`, `result_json` is stored, `completed_at` is set, and the Redis lock is released

#### Scenario: Completion rejected for non-owner
- **WHEN** a Worker calls complete on a job whose lock is held by a different worker_id
- **THEN** the system returns HTTP 409 and the job status is unchanged

### Requirement: Worker reports failure
The system SHALL accept failure reports from Workers via PATCH /internal/jobs/{job_id}/fail.

#### Scenario: Worker reports retryable failure
- **WHEN** a Worker calls PATCH /internal/jobs/{job_id}/fail with `{worker_id, error_json: {code: "PARSE_ERROR", message: "..."}, retryable: true}`
- **THEN** the system stores error_json, releases the lock, and triggers retry logic (if attempts remain)

#### Scenario: Worker reports non-retryable failure
- **WHEN** a Worker calls fail with `retryable: false`
- **THEN** the job transitions to `failed` permanently, error_json is stored, no retry is attempted

### Requirement: Worker heartbeat and dead worker detection
The system SHALL accept heartbeats from Workers via POST /internal/workers/heartbeat. Workers that miss heartbeats beyond a threshold MUST have their locks released.

#### Scenario: Worker sends heartbeat with active jobs
- **WHEN** a Worker calls POST /internal/workers/heartbeat with `{worker_id, active_jobs: ["job_1", "job_2"]}`
- **THEN** the system records the heartbeat timestamp and returns ack=true with any cancel_requested job ids

#### Scenario: Heartbeat reveals cancel request
- **WHEN** a Worker sends heartbeat and one of its active_jobs has `cancel_requested_at` set
- **THEN** the heartbeat response includes that job_id in `cancel_requested` array

#### Scenario: Worker misses heartbeat beyond threshold
- **WHEN** a Worker has not sent a heartbeat for 3 consecutive intervals (90 seconds with 30s interval)
- **THEN** the system marks the Worker as offline and releases all locks held by that worker_id

### Requirement: Node.js Worker BullMQ direct consumption
The system SHALL provide a BullMQ queue factory and Worker base class for Node.js Workers to directly consume jobs from Redis queues.

#### Scenario: Node.js Worker processes BullMQ job
- **WHEN** a job is added to the `ingestion` BullMQ queue
- **THEN** the ingestion-worker dequeues it, the jobs table status is updated to `running`, and upon completion the status transitions to `succeeded`

#### Scenario: BullMQ job fails and retries
- **WHEN** a BullMQ job processing throws an error and attempts remain
- **THEN** BullMQ retries with exponential backoff and the jobs table reflects the retry status

### Requirement: Atomic owner-checked lock release
The system SHALL use a Lua script for lock release to atomically verify that the releasing Worker is the current lock owner. This prevents a Worker from releasing a lock that was already stolen after TTL expiry.

#### Scenario: Owner releases lock
- **WHEN** a Worker calls release with its own worker_id and the lock key `job:lock:{job_id}` still holds that worker_id
- **THEN** the Lua script atomically verifies ownership and deletes the key

#### Scenario: Non-owner release is rejected
- **WHEN** a Worker calls release but the lock is held by a different worker_id (or has expired and been re-acquired)
- **THEN** the Lua script returns 0 (no deletion), and the Worker MUST NOT report completion for that job

### Requirement: Lock renewal during long-running jobs
The system SHALL allow Workers to renew their Redis lock TTL during execution to prevent premature expiry on long-running jobs.

#### Scenario: Worker renews lock before expiry
- **WHEN** a Worker calls `SET job:lock:{job_id} {worker_id} XX EX 600` while still holding the lock
- **THEN** the lock TTL is reset to 600 seconds

#### Scenario: Lock renewal fails because lock was stolen
- **WHEN** a Worker attempts renewal but the lock is now held by a different worker_id (or expired)
- **THEN** the renewal fails (XX condition not met) and the Worker MUST stop processing and not report completion
