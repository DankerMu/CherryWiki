## ADDED Requirements

### Requirement: Source document status enumeration
The system SHALL define a single status enumeration for source_documents with the following values. Stage 3 implements the first 8 statuses; later stages implement the remainder.

Stage 3 statuses: `uploaded`, `validating`, `archived`, `parsing`, `parsed`, `parse_failed`, `security_rejected`, `graphify_pending`.

Later stages: `graphify_running`, `graphify_failed`, `wiki_proposed`, `published`, `indexed`, `sync_failed`, `index_failed`.

#### Scenario: Valid status values
- **WHEN** a source_document is queried
- **THEN** its status is one of the defined enumeration values, never a freeform string

### Requirement: Status transition rules
The system SHALL enforce the following legal status transitions. Any attempt to transition to an invalid state SHALL be rejected with 409 CONFLICT.

Legal transitions:
- `uploaded` → `validating` (validation Job started or sync validation begins)
- `validating` → `archived` (validation passed, file promoted to archive)
- `validating` → `security_rejected` (validation failed)
- `archived` → `parsing` (ingestion Job started)
- `parsing` → `parsed` (parsing completed successfully)
- `parsing` → `parse_failed` (parsing failed)
- `parsed` → `graphify_pending` (Graphify Job created, if processing_strategy=immediate)
- `parse_failed` → `uploaded` (reprocess triggered)

#### Scenario: Legal transition
- **WHEN** a source_document with status=validating passes security validation
- **THEN** its status transitions to archived

#### Scenario: Illegal transition rejected
- **WHEN** an attempt is made to transition from status=uploaded directly to status=parsing (skipping validation)
- **THEN** the transition is rejected

#### Scenario: Reprocess resets status
- **WHEN** a parse_failed source_document is reprocessed
- **THEN** its status transitions back to uploaded, allowing the full pipeline to re-execute

### Requirement: Graphify trigger handoff contract
When a source_document reaches status=parsed, the system SHALL check the `processing_strategy` field in metadata_json to determine next action:
- `immediate` (default): automatically create a Graphify Job, transition status to `graphify_pending`
- `stash`: remain at `parsed`, no automatic Graphify trigger
- `archive_only`: remain at `parsed`, no automatic Graphify trigger

For parse_failed or security_rejected documents, no Graphify Job SHALL ever be created.

#### Scenario: Immediate strategy triggers Graphify (default)
- **WHEN** a source_document reaches status=parsed with processing_strategy=immediate
- **THEN** the system creates a Graphify Job and transitions status to graphify_pending

#### Scenario: Stash strategy does not trigger Graphify
- **WHEN** a source_document reaches status=parsed with processing_strategy=stash
- **THEN** no Graphify Job is created and status remains parsed

#### Scenario: Parse failure blocks Graphify
- **WHEN** a source_document has status=parse_failed
- **THEN** no Graphify Job is created regardless of processing_strategy

### Requirement: Batch upload grouping
When multiple files are uploaded to the same Space within a 30-second window, the system SHALL assign them the same `batch_id` in metadata_json. When all files in a batch reach status=parsed (with processing_strategy=immediate), the system SHALL merge them into a single Graphify run instead of creating individual runs.

#### Scenario: Batch upload creates single Graphify run
- **WHEN** user uploads 5 files to space_rd within 10 seconds and all reach parsed status
- **THEN** one Graphify run is created covering all 5 files, linked via batch_id

#### Scenario: Partial batch failure
- **WHEN** 3 of 5 batch files reach parsed but 2 are parse_failed
- **THEN** a Graphify run is created for the 3 successful files; the 2 failed files can be reprocessed later

### Requirement: metadata_json schema
The source_document.metadata_json field SHALL follow a standardized schema. All fields are optional but MUST use the defined keys when present:

| Field | Type | Description |
|---|---|---|
| source_url | string | Original URL (for source_type=url) |
| tags | string[] | User-provided tags |
| author | string | User-provided author |
| processing_strategy | enum | immediate / stash / archive_only |
| batch_id | string | Batch grouping identifier |
| rejection_reason | string | Standardized error code (MIME_MISMATCH, ZIP_BOMB_DETECTED, etc.) |
| rejection_details | object | Additional rejection context |
| injection_risk | boolean | Prompt injection detected |
| injection_patterns | string[] | Matched injection pattern names |
| needs_attention | boolean | Requires manual review |
| fetch_metadata | object | URL fetch details (content_type, response_size, fetch_duration_ms) |
| parse_metadata | object | Parse details (extraction_tool, duration_ms, page_count, char_count) |
| graphify_run_id | string | Associated Graphify run (set when graphify_pending) |
| cleanup_at | timestamp | Quarantine cleanup timestamp |

#### Scenario: metadata_json populated after upload
- **WHEN** user uploads a file with tags=["auth"] and processing_strategy=immediate
- **THEN** metadata_json contains {"tags": ["auth"], "processing_strategy": "immediate"}

#### Scenario: metadata_json after security rejection
- **WHEN** a file is security_rejected due to magic bytes mismatch
- **THEN** metadata_json contains {"rejection_reason": "MIME_MISMATCH", "rejection_details": {"detected_type": "application/x-executable", "declared_type": "application/pdf"}}

### Requirement: Source documents not directly searchable by Chat
Source documents and file_blobs SHALL NOT be indexed or searched by Chat/RAG. Only Published Wiki chunks (derived from Graphify output) SHALL be searchable. This is an architectural constraint enforced by the indexer (Stage 6) only reading from wiki_chunks, never from source_documents or file_blobs.

#### Scenario: Unpublished source document not in Chat results
- **WHEN** a source_document has status=parsed but no Graphify/Wiki/indexing has occurred
- **THEN** Chat API returns no results referencing this source_document's content

### Requirement: Permission model alignment
Upload operations SHALL use `upload:create` permission (not `space:upload`). Upload read operations SHALL use `upload:read` permission. These map to roles as follows: Owner/Admin/SpaceAdmin/Editor have upload:create; Owner/Admin/SpaceAdmin/Editor/Viewer have upload:read.

#### Scenario: Editor can upload
- **WHEN** a user with Editor role on a Space calls POST /api/spaces/{space_id}/uploads
- **THEN** the upload succeeds (Editor has upload:create)

#### Scenario: Viewer cannot upload
- **WHEN** a user with only Viewer role on a Space calls POST /api/spaces/{space_id}/uploads
- **THEN** the upload is rejected with 403 (Viewer lacks upload:create)

#### Scenario: Viewer can view uploads
- **WHEN** a user with Viewer role on a Space calls GET /api/uploads/{source_document_id}
- **THEN** the upload metadata is returned (Viewer has upload:read)
