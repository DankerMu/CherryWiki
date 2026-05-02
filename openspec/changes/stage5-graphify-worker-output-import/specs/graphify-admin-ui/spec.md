## ADDED Requirements

### Requirement: Graphify runs list page
`apps/web` SHALL provide a Graphify runs management page at `/spaces/:spaceId/graphify` showing:
- Paginated list of graphify_runs for the space
- Status badge (pending/running/succeeded/failed/cancelled) with color coding; failed runs with `error_json.reason='quarantined'` show a quarantine warning icon
- Mode, trigger_type, created_at, duration (completed_at - started_at)
- Stats summary (node_count, edge_count, wiki_page_count from stats_json)
- "New Run" button (requires graphify:run permission)
- Status filter tabs (All / Running / Succeeded / Failed / Cancelled); Failed tab highlights quarantined runs

#### Scenario: View runs for a space
- **WHEN** user navigates to /spaces/s1/graphify
- **THEN** page SHALL show most recent runs with status badges

#### Scenario: Create run from UI
- **WHEN** user clicks "New Run" and selects mode
- **THEN** POST /api/spaces/{space_id}/graphify/runs SHALL be called and list refreshes

### Requirement: Run detail page
`apps/web` SHALL provide a run detail page at `/spaces/:spaceId/graphify/:runId` showing:
- Run metadata (status, mode, trigger_type, timing)
- Stats (nodes, edges, communities, wiki pages)
- GRAPH_REPORT.md rendered as Markdown (from GET /api/graphify/runs/{run_id}/report)
- Error details if failed (error_json rendered)
- Cancel button (if pending/running, requires graphify:run)
- Retry button (if failed/quarantined)

#### Scenario: View succeeded run detail
- **WHEN** user opens a succeeded run
- **THEN** report tab SHALL render GRAPH_REPORT.md with summary, communities, god nodes, ambiguous edges

#### Scenario: View failed run detail
- **WHEN** user opens a failed run
- **THEN** error section SHALL show error_json in readable format

### Requirement: Quarantine review (admin only)
Admin users SHALL see a quarantine alert badge in the admin sidebar when any run has `error_json.reason='quarantined'`. The admin graphify page at `/admin/graphify` SHALL:
- List all failed runs across spaces, highlighting quarantined ones
- Show quarantine reason (schema_validation / shrink_guard / limit_exceeded) from error_json
- "Retry" button → creates new run via `POST /api/admin/graphify/runs/{run_id}/retry`
- Error details expandable panel showing full error_json

#### Scenario: Admin retries quarantined run
- **WHEN** admin clicks Retry on a quarantined run
- **THEN** POST /api/admin/graphify/runs/{run_id}/retry called, new run created

### Requirement: Graphify sidebar entry
Space sidebar SHALL include a "Graphify" navigation entry (below Wiki) linking to `/spaces/:spaceId/graphify`. Show run count badge if any run is in progress.

#### Scenario: Active run indicator
- **WHEN** a run with status 'running' exists for the space
- **THEN** sidebar entry SHALL show a spinning indicator

### Requirement: API client functions
Frontend API layer SHALL include: `createGraphifyRun(spaceId, params)`, `listGraphifyRuns(query)`, `getGraphifyRun(runId)`, `cancelGraphifyRun(runId)`, `retryGraphifyRun(runId)`, `getGraphifyReport(runId)`, `getGraphifySummary(runId)`, `adminListGraphifyRuns(query)`, `adminRetryRun(runId)`.
