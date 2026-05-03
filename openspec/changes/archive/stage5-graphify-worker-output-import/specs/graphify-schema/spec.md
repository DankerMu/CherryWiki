## ADDED Requirements

### Requirement: Drizzle table definitions for graphify_runs
The `packages/shared/src/schema/core.ts` SHALL export a `graphifyRuns` Drizzle table matching `schema.sql` `graphify_runs` exactly: id, tenant_id, space_id, job_id, trigger_type, mode, status, input_version, output_version, graphify_ref, graph_json_uri, wiki_output_uri, report_uri, graph_html_uri, schema_version, stats_json, error_json, created_by, created_at, started_at, completed_at.

#### Scenario: Create a graphify run record
- **WHEN** inserting `{ tenant_id, space_id, job_id, trigger_type: 'manual', mode: 'full', status: 'pending' }`
- **THEN** record SHALL be created with `schema_version` defaulting to `'v1'` and `stats_json` defaulting to `'{}'`

Note: `mode` enum is `full | update | incremental` per OpenAPI; `status` enum is `pending | running | succeeded | failed | cancelled` per OpenAPI. `quarantined` is an internal status not exposed in the API response — internally stored as `failed` with `error_json.reason: 'quarantined'`.

### Requirement: Drizzle table definitions for graph_nodes
The `packages/shared/src/schema/core.ts` SHALL export a `graphNodes` Drizzle table matching `schema.sql` `graph_nodes` exactly: id, tenant_id, space_id, graphify_run_id, node_key, stable_key, label, norm_label, type, community_id, wiki_page_pk, page_version_id, source_refs_json, acl_json, created_at. UNIQUE constraint on (tenant_id, space_id, graphify_run_id, node_key).

#### Scenario: Unique constraint enforcement
- **WHEN** inserting two nodes with same (tenant_id, space_id, graphify_run_id, node_key)
- **THEN** second insert SHALL fail with unique constraint violation

### Requirement: Drizzle table definitions for graph_edges
The `packages/shared/src/schema/core.ts` SHALL export a `graphEdges` table: id, tenant_id, space_id, graphify_run_id, source_node_id, target_node_id, relation_type, confidence_label, raw_confidence_score, effective_confidence_score, evidence_count, evidence_refs_json, acl_json, created_at.

### Requirement: Drizzle table definitions for graph_communities
The `packages/shared/src/schema/core.ts` SHALL export a `graphCommunities` table: id, tenant_id, space_id, graphify_run_id, community_key, label, summary, node_count, metadata_json, created_at. UNIQUE on (tenant_id, space_id, graphify_run_id, community_key).

### Requirement: Drizzle table definitions for graph_node_aliases
The `packages/shared/src/schema/core.ts` SHALL export a `graphNodeAliases` table: id, tenant_id, space_id, node_stable_key, alias, source, confidence, created_at. UNIQUE on (tenant_id, space_id, node_stable_key, alias).

### Requirement: Drizzle table definitions for graph_node_merges
The `packages/shared/src/schema/core.ts` SHALL export a `graphNodeMerges` table: id, tenant_id, space_id, from_stable_key, to_stable_key, reason, created_by, created_at.

### Requirement: Drizzle table definitions for graph_reports
The `packages/shared/src/schema/core.ts` SHALL export a `graphReports` table: id, tenant_id, space_id, graphify_run_id, report_markdown, stats_json, created_at.

### Requirement: Drizzle table definitions for page_block_metadata
The `packages/shared/src/schema/core.ts` SHALL export a `pageBlockMetadata` table: id, tenant_id, space_id, wiki_page_pk, page_version_id, block_id, owner, content_hash, graphify_run_id, last_editor, editable, created_at, updated_at. UNIQUE on (page_version_id, block_id).

### Requirement: Drizzle table definitions for graph_evidence_refs
The `packages/shared/src/schema/core.ts` SHALL export a `graphEvidenceRefs` table matching schema.sql exactly: id, tenant_id, space_id, edge_id (FK graph_edges ON DELETE CASCADE), page_id (FK wiki_pages), page_version_id (FK wiki_page_versions), section_id (FK wiki_sections), source_document_id (FK source_documents), quote_text (TEXT), confidence_contribution (DOUBLE PRECISION), created_at.

### Requirement: Drizzle table definitions for wiki_update_proposals
The `packages/shared/src/schema/core.ts` SHALL export a `wikiUpdateProposals` table matching schema.sql: id, tenant_id, space_id, wiki_page_pk (FK wiki_pages), graphify_run_id (FK graphify_runs), proposal_type, status (default 'pending'), diff_json (JSONB default '{}'), created_at, resolved_at. Used by wiki normalization to record conflicts between Graphify output and human-curated blocks.

### Requirement: Drizzle table definitions for index_snapshots
The `packages/shared/src/schema/core.ts` SHALL export a `indexSnapshots` table: id, tenant_id, space_id, graphify_run_id, wiki_repo_commit_hash, embedding_model_id, chunk_count, node_count, edge_count, status, created_at, activated_at.

### Requirement: All indexes matching schema.sql
The Drizzle definitions SHALL include all indexes from schema.sql: idx_graph_nodes_stable_key, idx_graph_nodes_label_trgm (GIN trigram), idx_graph_edges_source, idx_graph_edges_target, idx_graph_edges_confidence, idx_graph_node_aliases_lookup, idx_graph_node_merges_from, idx_page_blocks_page_version, idx_page_blocks_owner, idx_index_snapshots_space, idx_index_snapshots_active, idx_graphify_runs_job, idx_graph_evidence_refs_edge, idx_graph_evidence_refs_page, idx_graph_evidence_refs_source_doc.

### Requirement: Zod validation schemas
`packages/shared/src/schema/validation.ts` SHALL export: `createGraphifyRunSchema`, `graphNodeSchema`, `graphEdgeSchema`, `graphCommunitySchema`, `pageBlockMetadataSchema`.

#### Scenario: Validate graphify run creation
- **WHEN** input has `trigger_type: 'manual'`, `mode: 'full'`
- **THEN** validation SHALL pass

#### Scenario: Reject invalid confidence_label
- **WHEN** graphEdgeSchema validates `{ confidence_label: 'UNKNOWN' }`
- **THEN** validation SHALL fail

### Requirement: Drizzle migration
A Drizzle migration SHALL be generated that adds all 11 tables (10 + wiki_update_proposals) and 15 indexes, and runs successfully against existing DB with Stage 0-4 tables already present.
