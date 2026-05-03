## ADDED Requirements

### Requirement: Graphify completion triggers indexing
The system SHALL automatically create a `jobs` table row (type='reindex', payload_json with tenant_id, space_id, graphify_run_id, trigger='graphify_completion', scope='full') and enqueue a BullMQ message `{ jobId }` to QUEUE_INDEXING when GraphifyService.handleRunCompletion() succeeds (status='succeeded').

#### Scenario: successful Graphify run triggers indexing
- **WHEN** handleRunCompletion updates a graphify_run to status='succeeded'
- **THEN** a jobs row is created and a BullMQ message is enqueued to QUEUE_INDEXING with the job's ID

#### Scenario: failed Graphify run does not trigger indexing
- **WHEN** handleRunFailure is called for a graphify_run
- **THEN** no jobs row is created and no BullMQ message is enqueued

#### Scenario: quarantined Graphify run does not trigger indexing
- **WHEN** a graphify_run is marked as failed with quarantine
- **THEN** no jobs row is created and no BullMQ message is enqueued

### Requirement: Single page reindex endpoint
The system SHALL expose POST /spaces/{space_id}/wiki/pages/{page_id}/reindex (OpenAPI path key, served under /api server prefix). Permission: wiki:publish on the space. The endpoint SHALL create a jobs row (trigger='manual_reindex', scope='single_page', page_id) and enqueue to QUEUE_INDEXING. Response: 202 with `{ data: { page_id, reindex_job_id, status } }` wrapped in standard envelope. Errors: 403 FORBIDDEN (no wiki:publish), 404 PAGE_NOT_FOUND (page doesn't exist), 409 REINDEX_ALREADY_RUNNING (indexing job for this page already in progress). Supports X-Idempotency-Key.

#### Scenario: successful reindex trigger
- **WHEN** user POSTs to /spaces/space_rd/wiki/pages/rd.auth.sso/reindex with valid auth and wiki:publish permission
- **THEN** returns 202 with { data: { page_id: "rd.auth.sso", reindex_job_id: "job_xxx", status: "pending" } }

#### Scenario: page not found
- **WHEN** user POSTs to reindex a non-existent page_id
- **THEN** returns 404 PAGE_NOT_FOUND

#### Scenario: reindex already running
- **WHEN** an indexing job for this page is already in progress
- **THEN** returns 409 REINDEX_ALREADY_RUNNING

#### Scenario: insufficient permission
- **WHEN** a user without wiki:publish POSTs to reindex
- **THEN** returns 403 FORBIDDEN

#### Scenario: audit event written
- **WHEN** reindex is triggered
- **THEN** audit_logs contains entry with action='wiki.page.reindex'

### Requirement: Rebuild space index endpoint
The system SHALL expose POST /admin/spaces/{space_id}/rebuild-index (OpenAPI path key, served under /api server prefix). Permission: admin role. Request body: { scope: 'full' | 'incremental' (default 'full'), reason: string (optional) }. The endpoint SHALL create a jobs row (trigger='manual_rebuild') and enqueue to QUEUE_INDEXING. Response: 202 with `{ data: <Job object> }` wrapped in standard envelope. Errors: 403 FORBIDDEN (not admin), 404 SPACE_NOT_FOUND, 409 REBUILD_ALREADY_RUNNING. Writes audit event admin.index.rebuild.

#### Scenario: full rebuild trigger
- **WHEN** admin POSTs { scope: "full", reason: "model changed" } to rebuild-index
- **THEN** returns 202 with { data: <Job> }; jobs row created with scope='full', trigger='manual_rebuild'

#### Scenario: incremental rebuild
- **WHEN** admin POSTs { scope: "incremental" } to rebuild-index
- **THEN** jobs row created with scope='incremental'

#### Scenario: audit event written
- **WHEN** rebuild-index is triggered
- **THEN** audit_logs contains entry with action='admin.index.rebuild', details including space_id, scope, reason

#### Scenario: non-admin rejected
- **WHEN** a non-admin user POSTs to rebuild-index
- **THEN** returns 403 FORBIDDEN

#### Scenario: space not found
- **WHEN** admin POSTs to rebuild-index for non-existent space_id
- **THEN** returns 404 SPACE_NOT_FOUND

#### Scenario: rebuild already running
- **WHEN** a rebuild job for this space is already building
- **THEN** returns 409 REBUILD_ALREADY_RUNNING

### Requirement: Idempotency support
Both reindex and rebuild-index endpoints SHALL support X-Idempotency-Key header. Repeated requests with the same key SHALL return the original response without creating duplicate jobs.

#### Scenario: idempotent reindex
- **WHEN** two requests with the same X-Idempotency-Key are sent to reindex
- **THEN** only one jobs row is created; second request returns the same response with X-Idempotent-Replayed: true
