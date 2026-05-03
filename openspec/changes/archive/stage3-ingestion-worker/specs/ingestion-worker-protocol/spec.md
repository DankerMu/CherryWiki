## ADDED Requirements

### Requirement: Job polling and execution
The ingestion-worker SHALL poll for pending Jobs of type="ingestion" via GET /internal/jobs/pending?type=ingestion. Upon receiving a Job, it SHALL transition the Job to running status, download the source file from MinIO, execute the appropriate parser, and report completion or failure.

#### Scenario: Normal job execution cycle
- **WHEN** ingestion-worker polls and receives a pending ingestion Job
- **THEN** it claims the Job (locked_by=worker_id), downloads the source file, parses it, uploads parsed.md, and reports completion via PATCH /internal/jobs/{id}/complete with result_json containing parsed_uri and metadata

#### Scenario: No pending jobs
- **WHEN** ingestion-worker polls and no pending ingestion Jobs exist
- **THEN** it waits for the configured poll interval (default 5s) before polling again

### Requirement: Progress reporting
The ingestion-worker SHALL report progress at key stages: downloading (10%), parsing (20-80%), uploading_output (90%), finalizing (95%). The progress updates SHALL be sent via PATCH /internal/jobs/{id}/progress with percent and stage fields.

#### Scenario: Progress updates during parsing
- **WHEN** ingestion-worker is parsing a large PDF
- **THEN** it sends progress updates at downloading (10%), parsing_started (20%), parsing_page_N (20-80% proportional), uploading_output (90%), complete (100%)

### Requirement: Failure handling with error_json
The ingestion-worker SHALL catch all parsing exceptions and report failure via PATCH /internal/jobs/{id}/fail with a structured error_json containing: error_type (parse_error/timeout/download_error/upload_error), error_message, stderr (if available), exit_code (if applicable), stack_trace.

#### Scenario: Parse error reporting (P1-E8)
- **WHEN** parsing fails due to a corrupted PDF
- **THEN** the Job is marked failed with error_json containing error_type="parse_error", error_message describing the corruption, and stack_trace. The source_document status becomes parse_failed. The original archive file is NOT deleted.

#### Scenario: Download error
- **WHEN** the source file cannot be downloaded from MinIO
- **THEN** the Job fails with error_type="download_error" and the source_document status becomes parse_failed

### Requirement: Worker heartbeat
The ingestion-worker SHALL send heartbeat signals via POST /internal/workers/heartbeat at regular intervals (default 30s) while running. The heartbeat SHALL include worker_id, worker_type="ingestion", and system_info (cpu/memory usage).

#### Scenario: Regular heartbeat
- **WHEN** ingestion-worker is running (processing or idle)
- **THEN** it sends heartbeat every 30 seconds with current system metrics

### Requirement: Sandbox isolation
The ingestion-worker SHALL run in a sandboxed environment with: no outbound network access except MinIO and cherry-api internal endpoints, per-job isolated tmpdir cleaned after completion, non-root user (uid 1000), Docker resource limits (2GB RAM, 2 CPU cores, 5GB disk).

#### Scenario: Network isolation
- **WHEN** ingestion-worker attempts to access an external URL during parsing
- **THEN** the connection is blocked by Docker network policy (ingestion-worker has no external network access)

#### Scenario: Tmpdir cleanup
- **WHEN** a parsing job completes (success or failure)
- **THEN** the job's temporary directory is deleted and no residual files remain
