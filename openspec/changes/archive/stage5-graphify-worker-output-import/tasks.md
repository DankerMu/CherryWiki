## 1. Drizzle Schema + Validation (graphify-schema)

- [x] 1.1 Add `graphifyRuns` Drizzle table definition to `packages/shared/src/schema/core.ts` matching schema.sql exactly (21 columns, status enum: pending/running/succeeded/failed/cancelled)
- [x] 1.2 Add `graphNodes` table with UNIQUE constraint on (tenant_id, space_id, graphify_run_id, node_key)
- [x] 1.3 Add `graphEdges` table with FKs to graphNodes (source_node_id, target_node_id) and graphifyRuns
- [x] 1.4 Add `graphCommunities` table with UNIQUE on (tenant_id, space_id, graphify_run_id, community_key)
- [x] 1.5 Add `graphNodeAliases` table with UNIQUE on (tenant_id, space_id, node_stable_key, alias)
- [x] 1.6 Add `graphNodeMerges` table
- [x] 1.7 Add `graphReports` table with FK to graphifyRuns
- [x] 1.8 Add `pageBlockMetadata` table with UNIQUE on (page_version_id, block_id)
- [x] 1.9 Add `graphEvidenceRefs` table with exact schema.sql columns (quote_text, confidence_contribution — NOT excerpt), ON DELETE CASCADE for edge_id FK
- [x] 1.10 Add `indexSnapshots` table
- [x] 1.11 Add `wikiUpdateProposals` table (wiki_page_pk, graphify_run_id, proposal_type, status, diff_json, resolved_at)
- [x] 1.12 Add all 15 indexes from schema.sql (including GIN trigram for graph_nodes.label)
- [x] 1.13 Export all new tables from `packages/shared/src/schema/index.ts`
- [x] 1.14 Add Zod schemas to `packages/shared/src/schema/validation.ts`: createGraphifyRunSchema (mode: full/update/incremental, trigger_type: manual/scheduled/auto), graphNodeSchema, graphEdgeSchema, graphCommunitySchema, pageBlockMetadataSchema
- [x] 1.15 Write tests for Zod validation schemas
- [x] 1.16 Generate Drizzle migration, verify it runs against existing DB

## 2. graph-core Parser + Importer (graph-core-parser)

- [x] 2.1 Define TypeScript types: `GraphOutput`, `GraphNode`, `GraphEdge`, `GraphCommunity`, `ConfidenceLabel` (EXTRACTED/INFERRED/AMBIGUOUS)
- [x] 2.2 Implement `parseGraphJson(raw: string)` — parse JSON, apply defaults for missing optional fields (type→'concept', community→null, norm_label→normalizeLabel(label))
- [x] 2.3 Implement `validateGraphOutput(parsed)` — check required fields, reject empty nodes, warn on dangling edge refs, normalize invalid confidence labels to AMBIGUOUS, enforce node label length ≤256, check node/edge limits (GRAPHIFY_MAX_NODES/EDGES)
- [x] 2.4 Implement `normalizeLabel(label: string)` — replicate Graphify's `re.sub(r"[^a-z0-9 ]", "", label.lower()).strip()`
- [x] 2.5 Implement `computeStableKey(spaceId, normLabel, nodeType)` — SHA256 first 16 hex chars per Doc 21 §8A.3
- [x] 2.6 Implement `mapConfidence(label, rawScore)` — Doc 09 §12.2: default scores → effective 0.90/0.70/0.40; non-default → clamp(raw * 0.9, 0, 1)
- [x] 2.7 Implement `mergeCommunities(nodes)` — group by community field, return GraphCommunity[] with node_count
- [x] 2.8 Implement `GraphImportService.importRun(tenantId, spaceId, runId, graphOutput, previousRunId?)`:
  - Compute stable_key for each node
  - Match existing nodes via stable_key or graph_node_aliases lookup
  - Insert graph_nodes, graph_edges, graph_communities
  - Record new aliases for node_key changes
  - Detect deviation > 80% from previous succeeded run (Doc 12 §6.1) → return shrinkDetected
  - Return import stats
- [x] 2.9 Export all public API from `packages/graph-core/src/index.ts`
- [x] 2.10 Write unit tests for parseGraphJson (minimal, full, missing optional fields, invalid JSON)
- [x] 2.11 Write unit tests for validateGraphOutput (empty nodes, dangling edges, invalid confidence, label too long, node/edge limits)
- [x] 2.12 Write unit tests for normalizeLabel (mixed case, special chars, unicode)
- [x] 2.13 Write unit tests for computeStableKey (consistency, different types produce different keys)
- [x] 2.14 Write unit tests for mapConfidence: EXTRACTED→0.90, INFERRED→0.70, AMBIGUOUS→0.40, non-default continuous score→clamp(raw*0.9)
- [x] 2.15 Write unit tests for mergeCommunities (grouping, null community excluded)
- [x] 2.16 Write unit tests for GraphImportService (first run, second run matching, shrink guard at 80% threshold)
- [x] 2.17 Write contract test using `tests/fixtures/test-graphify-output/graph.json` — parse + validate + import should succeed with expected stats

## 3. graphify-worker Runner (graphify-worker-runner)

- [x] 3.1 Implement `apps/graphify-worker/src/storage_client.py`: MinIO download_file / upload_file / upload_directory, consistent with ingestion-worker pattern
- [x] 3.2 Implement `apps/graphify-worker/src/manifest.py`: generate graphify_input_manifest.json from job payload
- [x] 3.3 Rewrite `apps/graphify-worker/src/runner.py` `run()`:
  - Download inputs from MinIO to `{GRAPHIFY_WORKDIR}/{run_id}/input/`
  - Generate manifest
  - Execute Graphify CLI via subprocess with timeout
  - Validate output per Doc 12 §6.1 (existence + path safety + file size ≤100MB + total ≤1GB)
  - Upload outputs to MinIO under `graphify-out/{tenant_id}/{space_id}/{run_id}/`
  - Count nodes/edges/wiki pages for stats_json
  - Cleanup working directory
  - Return completion payload with URIs and stats
- [x] 3.4 Implement validation_report.json generation: after output validation, produce structured report with check results, node/edge/wiki counts, total size
- [x] 3.5 Handle errors: download failure, CLI timeout, non-zero exit, missing output files, path traversal, oversized files → all report job failed with structured error_json
- [x] 3.6 Write unit tests for storage_client (mock MinIO, test download/upload)
- [x] 3.7 Write unit tests for manifest generation
- [x] 3.8 Write unit tests for validation_report.json generation (pass/fail scenarios)
- [x] 3.9 Write unit tests for runner (mock subprocess, test success path, timeout, CLI failure, missing output, path traversal detection, file size check)
- [x] 3.10 Write integration test: runner with `tests/fixtures/test-graphify-output/` as pre-prepared output (mock Graphify CLI by copying fixture output to workdir)

## 4. Wiki Normalization (wiki-normalization)

- [x] 4.1 Implement `packages/wiki-core/src/normalization/identify-page-type.ts` — per Doc 21 §9.3 rules, compare after safeFilename()
- [x] 4.2 Implement `packages/wiki-core/src/normalization/safe-filename.ts` — replicate `_safe_filename()` exactly + `uniqueSlug()` with `_2/_3` dedup
- [x] 4.3 Implement `packages/wiki-core/src/normalization/sanitize-markdown.ts` — Doc 12 §6.3: strip HTML (keep graphify comments), remove script/iframe/object/embed, strip event handlers, remove data: URIs, sanitize external links
- [x] 4.4 Implement `packages/wiki-core/src/normalization/import-graphify-wiki.ts` — main entry point:
  - Parse graph.json community/god-node labels
  - For each wiki file: identify type → generate page_id (Doc 21 §9.4 exact rules) → generate frontmatter (all 17 fields) → sanitize content → map to repo path
  - Inject section-level block ownership markers (per h2 boundaries, not page-level)
  - Detect conflicts with existing pages (check page_block_metadata per section)
  - Write wiki_pages + wiki_page_versions + wiki_sections + page_block_metadata
  - Create wiki_update_proposals for human/graphify conflicts
  - Store GRAPH_REPORT.md in graph_reports
  - Generate index_update_manifest
  - Generate git commit info (Doc 05 §3.5 format)
  - Return NormalizationResult
- [x] 4.5 Implement conflict resolution — all 7 scenarios from Doc 21 §9.8:
  - Slug collision same page → update
  - Slug collision different page → append `_gf_{run_id_short}`
  - Label rename (norm_label unchanged) → update title + git mv
  - Label rename (norm_label changed) → alias lookup
  - Same god node regenerated → update managed blocks only
  - Community re-clustering → deprecate old, create new draft
  - GRAPH_REPORT.md → graph_reports table only
- [x] 4.6 Implement `packages/wiki-core/src/normalization/block-markers.ts` — inject/parse `<!-- graphify:managed:start/end -->` at section level
- [x] 4.7 Implement git commit generation: author `graphify <graphify@cherrygraph.local>`, message `[{space}][graphify][{run_id}] {summary}`
- [x] 4.8 Export normalization API from `packages/wiki-core/src/index.ts`
- [x] 4.9 Write unit tests for identifyPageType (index, community, god_node, generated_article)
- [x] 4.10 Write unit tests for safeFilename (spaces, slashes, colons, unicode) + uniqueSlug (_2/_3 dedup)
- [x] 4.11 Write unit tests for sanitize-markdown (script removal, comment preservation, data URI removal, event handler removal)
- [x] 4.12 Write unit tests for block markers at section level (inject per h2, parse, round-trip)
- [x] 4.13 Write unit tests for importGraphifyWiki with fixture data:
  - First import: 4 pages created, correct types/paths/frontmatter/section-level blocks
  - Second import same data: pages updated with version+1
  - Human block preservation on re-import
  - Proposal creation for human/graphify conflict → wiki_update_proposals record
  - Community re-clustering → old archived, new draft
- [x] 4.14 Write unit tests for git commit message generation
- [x] 4.15 Write unit tests for index_update_manifest generation

## 5. Graphify API Module (graphify-api)

- [x] 5.1 Create `apps/api/src/graphify/` module structure: graphify.module.ts, graphify.controller.ts, graphify.service.ts
- [x] 5.2 Implement GraphifyService.createRun(): per OpenAPI CreateGraphifyRunRequest (mode: full/update/incremental, trigger_type required), concurrent run check (409), create graphify_runs record, enqueue job, audit `graphify.run.create`
- [x] 5.3 Implement GraphifyService.listRuns(): per OpenAPI GET /graphify/runs with space_id/status/trigger_type query params
- [x] 5.4 Implement GraphifyService.getRun(): by run_id, permission check `graphify:view` on run's space
- [x] 5.5 Implement GraphifyService.cancelRun(): validate status (pending/running only), update to cancelled, cancel job, permission `graphify:run`
- [x] 5.6 Implement GraphifyService.retryRun(): validate status (failed only), create new run with same params, permission `graphify:run`
- [x] 5.7 Implement GraphifyService.getReport(): fetch from graph_reports table, return per OpenAPI format (content, report_format, generated_at)
- [x] 5.8 Implement GraphifyService.getGraphSummary(): aggregate stats, admin-only in Phase 1
- [x] 5.9 Implement GraphifyService.handleRunCompletion(): the internal pipeline — download graph.json → parse → Doc 12 §6.1 full validation (node/edge limits, path safety, file size, deviation >80%) → sanitize wiki markdown (Doc 12 §6.3) → import graph → normalize wiki → update run status to 'succeeded' or 'failed' (quarantined)
- [x] 5.10 Implement GraphifyController: POST /spaces/{space_id}/graphify/runs, GET /graphify/runs, GET /graphify/runs/{run_id}, POST /graphify/runs/{run_id}/cancel, POST /graphify/runs/{run_id}/retry, GET /graphify/runs/{run_id}/report, GET /graphify/runs/{run_id}/graph (admin only), GET /admin/graphify/runs, POST /admin/graphify/runs/{run_id}/retry
- [x] 5.11 Register GraphifyModule in app.module.ts
- [x] 5.12 Write controller tests: all endpoints happy path + error cases (not found, concurrent run, not cancellable, not retryable, permission denied with graphify:run/graphify:view)
- [x] 5.13 Write service tests: createRun concurrent check, completion pipeline (mock graph-core + wiki-core), quarantine-as-failed flow, shrink guard at 80% threshold, node/edge limit check

## 6. Admin UI — Graphify Runs (graphify-admin-ui)

- [x] 6.1 Add Graphify API client functions to frontend API layer (per OpenAPI endpoints)
- [x] 6.2 Implement GraphifyRunsList component: paginated list with status badges (pending/running/succeeded/failed/cancelled), quarantine warning icon on failed+quarantined, mode, timing, stats
- [x] 6.3 Implement GraphifyRunDetail component: metadata + rendered GRAPH_REPORT.md + error display (quarantine reason expandable)
- [x] 6.4 Implement NewRunDialog: mode selector (full/update/incremental) + trigger_type + optional source_document_ids picker + confirm
- [x] 6.5 Implement cancel/retry action buttons with confirmation dialogs
- [x] 6.6 Implement admin quarantine review panel: failed runs with quarantine reason, retry button
- [x] 6.7 Add "Graphify" entry to Space sidebar navigation with active-run indicator
- [x] 6.8 Add routes: /spaces/:spaceId/graphify, /spaces/:spaceId/graphify/:runId, /admin/graphify
- [x] 6.9 Write component tests: runs list rendering, status badges, cancel/retry button visibility by status

## 7. E2E + Integration Tests (P1-E1/E4/E9/E10)

- [x] 7.1 Write P1-E1 integration test: upload source → parse → create graphify run → mock CLI → validate output → normalize wiki → verify wiki page visible via list API
- [x] 7.2 Write P1-E4 integration test: graphify run fails → verify no graph/wiki import performed, previous succeeded run's data unchanged, no index_snapshot created
- [x] 7.3 Write P1-E9 integration test: create run → cancel → verify status=cancelled, no import, job cancelled
- [x] 7.4 Write P1-E10 integration test: 5 files batch upload → verify single graphify run created (not 5 separate runs)
- [x] 7.5 Write quarantine integration test: graph.json with >50000 nodes → run marked failed with quarantine error_json, no import

## 8. Stage 4 → Stage 5 移交测试债务清理

- [x] 8.1 After first successful graphify wiki import: execute D1-D9 manual verification items from 需求追踪矩阵 §6.1, capture screenshots
- [x] 8.2 Write D11 integration test: publish→list shows published page
- [x] 8.3 Write D12 integration test: rollback creates new version
- [x] 8.4 Write D13 integration test: idempotency key publish/rollback
- [x] 8.5 Update 需求追踪矩阵 with Stage 5 rows: Graphify run CRUD, graph import, wiki normalization, quarantine handling, validation report — all with API/schema/test coverage
