## ADDED Requirements

### Requirement: Create Graphify run
`POST /api/spaces/{space_id}/graphify/runs` SHALL create a new graphify_runs record and enqueue a `graphify` job. Requires `graphify:run` permission (Doc 12 §2.2).

Request body per OpenAPI `CreateGraphifyRunRequest`:
```
{ mode: 'full' | 'update' | 'incremental',  // required
  trigger_type: 'manual' | 'scheduled' | 'auto',  // required
  input_scope?: { page_ids?: string[], source_document_ids?: string[] },
  options?: { wiki?: boolean, no_viz?: boolean, directed?: boolean } }
```
Headers: `X-Idempotency-Key` (optional, per OpenAPI `idempotencyKey` parameter).
- If `input_scope` is omitted, all parsed source_documents in the space are included.
- If another run is already `pending` or `running` for the same space, return `409 GRAPHIFY_RUN_IN_PROGRESS`.

#### Scenario: Create manual run
- **WHEN** user with graphify:run calls POST with mode='full', trigger_type='manual'
- **THEN** graphify_runs record created with status='pending', job created with type='graphify'
- **AND** audit event `graphify.run.create` logged (Doc 12 §8)

#### Scenario: Reject concurrent run
- **WHEN** space already has a run with status='running'
- **THEN** response SHALL be 409 with error code `GRAPHIFY_RUN_IN_PROGRESS`

#### Scenario: Insufficient permissions
- **WHEN** user lacks graphify:run permission
- **THEN** response SHALL be 403

### Requirement: List Graphify runs
`GET /api/graphify/runs` SHALL return paginated graphify_runs. Supports query params per OpenAPI: `space_id`, `status` (pending|running|succeeded|failed|cancelled), `trigger_type`, `page`, `per_page`, `sort`. Requires `graphify:view` permission.

#### Scenario: Filter by status
- **WHEN** query has `status=succeeded`
- **THEN** only succeeded runs SHALL be returned

### Requirement: Get Graphify run
`GET /api/graphify/runs/{run_id}` SHALL return run details per OpenAPI `GraphifyRun` schema: run_id, space_id, mode, trigger_type, status, progress (percent, stage), input_scope (page_ids, source_document_ids), result (nodes_created, nodes_updated, edges_created, wiki_pages_generated, schema_version, graph_json_uri, report_uri), created_at, started_at, completed_at. Requires `graphify:view` on run's space.

#### Scenario: Get succeeded run
- **WHEN** run exists and status is 'succeeded'
- **THEN** response SHALL include result.graph_json_uri, result.report_uri, result.nodes_created

#### Scenario: Run not found
- **WHEN** run_id does not exist
- **THEN** response SHALL be 404 with `GRAPHIFY_RUN_NOT_FOUND`

### Requirement: Cancel Graphify run
`POST /api/graphify/runs/{run_id}/cancel` SHALL cancel a pending or running run. Returns `{ status: 'cancelling' }` per OpenAPI. Requires `graphify:run` on run's space.

#### Scenario: Cancel pending run
- **WHEN** run status is 'pending'
- **THEN** status transitions to 'cancelled', job cancelled, audit event `graphify.run.cancel` logged

#### Scenario: Cancel non-cancellable run
- **WHEN** run status is 'succeeded' or 'failed'
- **THEN** response SHALL be 409 with `GRAPHIFY_RUN_NOT_CANCELLABLE`

### Requirement: Retry Graphify run
`POST /api/graphify/runs/{run_id}/retry` SHALL create a new run (201) with same parameters as the failed run. Requires `graphify:run`. Headers: `X-Idempotency-Key` (optional).

#### Scenario: Retry failed run
- **WHEN** original run status is 'failed'
- **THEN** new run created with trigger_type same as original, audit event `graphify.run.retry` logged

#### Scenario: Retry non-failed run
- **WHEN** original run status is 'succeeded'
- **THEN** response SHALL be 409 with `GRAPHIFY_RUN_NOT_RETRYABLE`

### Requirement: Get run report
`GET /api/graphify/runs/{run_id}/report` SHALL return the GRAPH_REPORT.md content per OpenAPI: `{ run_id, report_format, content, generated_at }`. Requires `graphify:view`.

#### Scenario: Report available
- **WHEN** run is succeeded and report exists
- **THEN** response SHALL include `{ content: "<markdown>", report_format: "markdown", generated_at: "..." }`

### Requirement: Get graph summary (admin diagnostic only)
`GET /api/graphify/runs/{run_id}/graph` SHALL return graph summary stats. In Phase 1, this is restricted to admin role as a diagnostic tool — graph data is store-only, not used in retrieval (Phase 1 scope lock).

#### Scenario: Admin views graph summary
- **WHEN** admin user requests graph summary for a succeeded run
- **THEN** response SHALL include node_count, edge_count, community_count

#### Scenario: Non-admin denied
- **WHEN** non-admin user requests graph summary
- **THEN** response SHALL be 403

### Requirement: Admin list all runs
`GET /api/admin/graphify/runs` SHALL return paginated runs across all spaces per OpenAPI. Admin role required. Supports `?space_id=...&status=failed` filtering.

#### Scenario: Admin filters failed runs (including quarantined)
- **WHEN** admin queries with `status=failed`
- **THEN** all failed runs (including those internally quarantined) SHALL be returned

### Requirement: Admin retry
`POST /api/admin/graphify/runs/{run_id}/retry` SHALL create a new run per OpenAPI (202). Admin role required. Headers: `X-Idempotency-Key` (optional).

### Requirement: Quarantine handling (internal mechanism)
Quarantine is NOT a separate API status — it is an internal state stored as `status='failed'` with `error_json: { "reason": "quarantined", "quarantine_type": "shrink_guard" | "schema_validation" | "limit_exceeded", ... }`. Admin can retry quarantined runs via the standard retry endpoint after reviewing the error.

This avoids adding a non-OpenAPI status and keeps the public API consistent with the OpenAPI contract.

### Requirement: Run completion handler (internal)
When graphify-worker reports a job as completed, the GraphifyService SHALL:
1. Update graphify_runs with output URIs and stats_json
2. Download graph.json from MinIO
3. Call graph-core parser + validator
4. Run Doc 12 §6.1 output validation:
   - nodes.length <= GRAPHIFY_MAX_NODES (default 50000)
   - edges.length <= GRAPHIFY_MAX_EDGES (default 200000)
   - File path safety (no `..`, no absolute paths, no symlinks)
   - Single file size <= 100MB
   - Total output size <= 1GB
   - wiki/*.md count > 0
   - Node/edge deviation from last succeeded run <= 80%
5. If any validation fails → mark run as 'failed' with quarantine error_json, do NOT import
6. If validation passes → call GraphImportService.importRun() + wiki-core importGraphifyWiki()
7. Apply wiki Markdown sanitization (Doc 12 §6.3): strip HTML tags (keep only `<!-- graphify:* -->` comments), remove script/iframe/object/embed, strip event handlers, remove data: URIs
8. Update graphify_runs status to 'succeeded'

#### Scenario: Successful completion pipeline
- **WHEN** worker reports success with valid graph.json passing all checks
- **THEN** graph data imported, wiki pages created (sanitized), status='succeeded'

#### Scenario: Schema validation failure → quarantine
- **WHEN** worker reports success but graph.json has missing required node fields
- **THEN** run marked 'failed' with error_json `{ "reason": "quarantined", "quarantine_type": "schema_validation", "details": "..." }`, no import

#### Scenario: Shrink guard → quarantine
- **WHEN** new run has 15 nodes but previous succeeded run had 100 (deviation 85% > threshold 80%)
- **THEN** run marked 'failed' with error_json `{ "reason": "quarantined", "quarantine_type": "shrink_guard", "previous_count": 100, "current_count": 15 }`

#### Scenario: Shrink guard — within threshold
- **WHEN** new run has 25 nodes but previous succeeded run had 100 (deviation 75% < threshold 80%)
- **THEN** validation SHALL pass, import proceeds normally

#### Scenario: Node limit exceeded → quarantine
- **WHEN** graph.json has 60000 nodes (> GRAPHIFY_MAX_NODES)
- **THEN** run marked 'failed' with error_json `{ "reason": "quarantined", "quarantine_type": "limit_exceeded", "details": "nodes: 60000 > 50000" }`
