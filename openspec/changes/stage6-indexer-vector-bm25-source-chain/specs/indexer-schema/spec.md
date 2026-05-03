## ADDED Requirements

### Requirement: wiki_chunks Drizzle table definition
The system SHALL define a Drizzle ORM schema for the `wiki_chunks` table matching `docs/schemas/schema.sql` exactly: id, tenant_id, space_id, wiki_page_pk, page_version_id, section_id, chunk_index, content, content_hash, token_count, index_status (default 'pending'), index_snapshot_id, index_version, indexed_at, embedding_model_id, injection_risk (default false), source_chain_json (JSONB default '{}'), acl_json (JSONB default '{}'), created_at. UNIQUE constraint on (page_version_id, chunk_index).

#### Scenario: wiki_chunks table created via migration
- **WHEN** Drizzle migration runs
- **THEN** wiki_chunks table exists with all columns, types, defaults, and constraints matching schema.sql

#### Scenario: wiki_chunks indexes created
- **WHEN** Drizzle migration runs
- **THEN** idx_wiki_chunks_space (tenant_id, space_id), idx_wiki_chunks_fts (GIN on to_tsvector('simple', content)), idx_wiki_chunks_index_status (index_status, index_snapshot_id) indexes exist

### Requirement: embeddings Drizzle table definition
The system SHALL define a Drizzle ORM schema for the `embeddings` table: id, tenant_id, space_id, chunk_id (FK → wiki_chunks ON DELETE CASCADE), model_config_id (FK → model_configs), embedding (VECTOR type, dimension not fixed in schema), created_at.

#### Scenario: embeddings table created via migration
- **WHEN** Drizzle migration runs
- **THEN** embeddings table exists with all columns and foreign key constraints; chunk_id CASCADE delete is enforced

#### Scenario: embeddings indexes created
- **WHEN** Drizzle migration runs
- **THEN** idx_embeddings_model (model_config_id) index exists

### Requirement: pgvector extension enablement
The system SHALL enable the pgvector extension (`CREATE EXTENSION IF NOT EXISTS vector`) in the migration.

#### Scenario: pgvector extension available
- **WHEN** migration completes
- **THEN** `SELECT * FROM pg_extension WHERE extname = 'vector'` returns one row

### Requirement: Zod validation schemas for indexer entities
The system SHALL export Zod schemas for wiki_chunks (insert + select) and embeddings (insert + select) in `packages/shared/src/schema/validation.ts`. The existing `indexSnapshotStatusSchema` at validation.ts:33 SHALL be corrected from `['building', 'ready', 'active', 'failed']` to `['building', 'ready', 'activated', 'superseded']` to match Doc 10 §6.2.

#### Scenario: valid wiki_chunk insert passes validation
- **WHEN** a complete wiki_chunk object with all required fields is validated
- **THEN** Zod parse succeeds and returns typed object

#### Scenario: invalid wiki_chunk insert rejected
- **WHEN** a wiki_chunk object missing required field (e.g., content) is validated
- **THEN** Zod parse throws ZodError

#### Scenario: index_snapshot status validation corrected
- **WHEN** an index_snapshot with status 'activated' is validated
- **THEN** Zod parse succeeds
- **WHEN** an index_snapshot with status 'active' or 'failed' is validated
- **THEN** Zod parse throws ZodError (these are no longer valid values)

#### Scenario: index_snapshot status enum matches Doc 10
- **WHEN** indexSnapshotStatusSchema.options is inspected
- **THEN** values are exactly ['building', 'ready', 'activated', 'superseded']

### Requirement: HNSW index deployment script
The system SHALL provide `scripts/create-vector-index.sql` that creates an HNSW index on embeddings.embedding column with configurable dimension parameter.

#### Scenario: HNSW index creation
- **WHEN** admin runs the script with dimension=1536
- **THEN** HNSW index on embeddings.embedding is created for cosine distance
