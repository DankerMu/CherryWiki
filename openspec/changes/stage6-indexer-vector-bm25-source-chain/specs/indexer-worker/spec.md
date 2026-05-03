## ADDED Requirements

### Requirement: QUEUE_INDEXING job consumption
The indexer-worker SHALL extend `AbstractBullMQWorker` from job-core and consume jobs from the BullMQ `QUEUE_INDEXING` queue (value: 'indexer'). BullMQ message payload SHALL contain `{ jobId: string }` pointing to a `jobs` table row. The `jobs.payload_json` SHALL include: tenant_id, space_id, graphify_run_id (optional), trigger ('graphify_completion' | 'manual_reindex' | 'manual_rebuild'), scope ('full' | 'incremental' | 'single_page'), page_id (only when scope='single_page'). The worker reads the full payload from the jobs table via `resolveJobId()`, following the same pattern as ingestion-worker and graphify-worker.

#### Scenario: job received and processed
- **WHEN** a job row exists with payload_json { tenant_id, space_id, trigger: 'graphify_completion', scope: 'full' } and BullMQ message { jobId } is enqueued
- **THEN** indexer-worker picks up the job, loads payload from jobs table, and begins index building

#### Scenario: invalid job payload
- **WHEN** a job's payload_json is missing required tenant_id
- **THEN** job fails immediately with validation error

### Requirement: Index snapshot lifecycle management
The indexer-worker SHALL manage index_snapshots through the lifecycle: building → ready → activated → superseded (Doc 10 §6.2). The worker SHALL create a new snapshot record with status 'building' at job start.

#### Scenario: snapshot created at job start
- **WHEN** indexer-worker begins processing a full-scope job
- **THEN** a new index_snapshots row is created with status='building', embedding_model_id from active model_configs, wiki_repo_commit_hash from current HEAD

#### Scenario: snapshot moves to ready after indexing
- **WHEN** all chunks are embedded and written
- **THEN** index_snapshot.status updated to 'ready' and chunk_count/node_count/edge_count populated

### Requirement: Published-only page selection
The indexer-worker SHALL only index wiki_page_versions where the page has a published version (current_version_id points to a version with status='published'). Draft and unpublished pages SHALL NOT be indexed.

#### Scenario: published page indexed
- **WHEN** a page has status=published current_version
- **THEN** that version's content is chunked and embedded

#### Scenario: draft page skipped
- **WHEN** a page has only draft versions
- **THEN** no chunks are created for that page

### Requirement: Chunking and embedding pipeline
The indexer-worker SHALL: (1) load published pages for the space, (2) call rag-core chunker to produce ChunkResult[], (3) write wiki_chunks rows, (4) call ai-core embedding provider to generate vectors, (5) write embeddings rows, (6) update BM25 full-text index (automatic via GIN index on content column).

#### Scenario: full pipeline execution
- **WHEN** a space has 10 published pages producing 50 chunks
- **THEN** 50 wiki_chunks rows and 50 embeddings rows are written, all with index_snapshot_id = current building snapshot

### Requirement: Incremental embedding deduplication
The indexer-worker SHALL compare each chunk's content_hash against the previous snapshot's chunks (same page + section + chunk_index). If content_hash matches, the worker SHALL reuse the existing embedding vector instead of calling the embedding API.

#### Scenario: unchanged chunk reuses embedding
- **WHEN** a chunk has content_hash identical to the same position in the previous snapshot
- **THEN** the embedding is copied from the previous embeddings row; no embedding API call is made

#### Scenario: changed chunk generates new embedding
- **WHEN** a chunk has a different content_hash from the previous snapshot
- **THEN** a new embedding API call is made and the new vector is stored

#### Scenario: new page with no prior chunks
- **WHEN** a page did not exist in the previous snapshot
- **THEN** all chunks generate new embeddings

### Requirement: Atomic snapshot activation
The indexer-worker SHALL activate a completed snapshot in a single database transaction: (1) set index_snapshots.status = 'activated' and activated_at = now(), (2) update spaces.active_index_snapshot_id to the new snapshot ID, (3) set the previous active snapshot's status to 'superseded'.

#### Scenario: atomic activation
- **WHEN** snapshot building completes successfully
- **THEN** in one transaction: new snapshot becomes 'activated', space points to it, old snapshot becomes 'superseded'

#### Scenario: activation failure rollback
- **WHEN** the activation transaction fails (e.g., DB error)
- **THEN** snapshot remains in 'ready' status; space.active_index_snapshot_id unchanged; old snapshot still 'activated'

### Requirement: Build failure isolation
The indexer-worker SHALL NOT modify spaces.active_index_snapshot_id if indexing fails. The failed snapshot SHALL remain with status='building' (Doc 10 §6.2 does not define a 'failed' snapshot status — the snapshot stays in 'building' and is cleaned up by the data retention policy). Chat continues using the previous active snapshot per Doc 10 §6.3 Fallback.

#### Scenario: embedding API failure
- **WHEN** the embedding API returns a non-retryable error during indexing
- **THEN** the current snapshot is NOT activated (remains 'building'); space.active_index_snapshot_id remains pointing to the previous snapshot; the jobs table row is marked failed via JobStateMachine

#### Scenario: partial chunk failure
- **WHEN** 45 of 50 chunks are embedded but the 46th fails after retries
- **THEN** the snapshot is NOT activated (remains 'building'); all written chunks/embeddings for this snapshot are orphaned (cleaned up by retention policy)

### Requirement: Concurrency mutex
The indexer-worker SHALL prevent concurrent indexing for the same space_id. If a building snapshot already exists for the space, the new job SHALL wait or fail with INDEXING_IN_PROGRESS.

#### Scenario: concurrent indexing rejected
- **WHEN** an indexing job starts for space_rd while another is already building
- **THEN** the new job fails with error code INDEXING_IN_PROGRESS

### Requirement: Job progress reporting
The indexer-worker SHALL report progress via job_events: 'indexing_started' (with page count), 'chunks_created' (with chunk count), 'embedding_progress' (with completed/total), 'snapshot_activated', 'indexing_failed'.

#### Scenario: progress events emitted
- **WHEN** indexing processes 50 chunks across 10 pages
- **THEN** job_events include: indexing_started (pages: 10), chunks_created (chunks: 50), embedding_progress updates, snapshot_activated

### Requirement: Single-page reindex scope
The indexer-worker SHALL support scope='single_page' with page_id. In this mode, the worker creates a new snapshot, copies all unchanged chunks/embeddings from the current active snapshot (via content_hash match), regenerates only the specified page's chunks, and atomically activates the new snapshot. This preserves snapshot immutability per Doc 10 §6.1.

#### Scenario: single page reindex
- **WHEN** job has scope='single_page', trigger='manual_reindex', and page_id='rd.auth.sso'
- **THEN** a new snapshot is created; the specified page's chunks are regenerated; other pages' chunks are copied from the previous snapshot; the new snapshot is atomically activated

#### Scenario: single page reindex preserves snapshot immutability
- **WHEN** single-page reindex is in progress
- **THEN** the current active snapshot's chunks are never modified; Chat continues using the old snapshot until the new one is activated

### Requirement: Chunk index_status lifecycle
The indexer-worker SHALL set wiki_chunks.index_status = 'indexed' and indexed_at = now() for each chunk after its embedding is successfully generated and written. Chunks that fail embedding remain index_status = 'pending'. This satisfies the requirement tracking matrix row "索引构建" (index_status=indexed).

#### Scenario: successful chunk indexing
- **WHEN** a chunk's embedding is successfully generated and stored
- **THEN** chunk.index_status = 'indexed' and chunk.indexed_at is set

#### Scenario: failed chunk remains pending
- **WHEN** a chunk's embedding fails after retries
- **THEN** chunk.index_status remains 'pending'
