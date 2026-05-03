## ADDED Requirements

### Requirement: Drizzle ORM wiki_pages table
The system SHALL define a `wikiPages` Drizzle pgTable in `packages/shared/src/schema/core.ts` matching the `wiki_pages` SQL table in `schema.sql`. Columns: id (PK), tenant_id (FK tenants), space_id (FK spaces), page_id, title, slug, status (default 'draft'), current_version_id, indexed_version_id, sync_status (default 'synced'), docmost_page_id, created_by (FK users), created_at, updated_at. UNIQUE constraint on (tenant_id, space_id, page_id).

#### Scenario: wiki_pages table matches SQL schema
- **WHEN** the Drizzle schema is loaded and compared to `schema.sql` lines 93-109
- **THEN** all columns, types, defaults, foreign keys, and unique constraints SHALL match exactly

#### Scenario: wiki_pages circular FK to wiki_page_versions
- **WHEN** `current_version_id` and `indexed_version_id` are defined
- **THEN** they SHALL reference `wikiPageVersions.id` via post-definition ALTER TABLE foreign keys (matching schema.sql lines 129-135), NOT via Drizzle `DEFERRABLE` constraints

### Requirement: Drizzle ORM wiki_page_versions table
The system SHALL define a `wikiPageVersions` Drizzle pgTable matching `wiki_page_versions` in `schema.sql`. Columns: id (PK), tenant_id (FK tenants), space_id (FK spaces), wiki_page_pk (FK wiki_pages), page_id, version_no (INT), content_markdown (TEXT), frontmatter_json (JSONB default '{}'), source (TEXT), graphify_run_id, commit_hash, status (default 'draft'), created_by (FK users), created_at. UNIQUE on (wiki_page_pk, version_no).

Note: `published_at` and `published_by` are NOT stored columns — they SHALL be derived at runtime from audit_logs (action='wiki.page.publish') when constructing API responses.

#### Scenario: wiki_page_versions table matches SQL schema
- **WHEN** the Drizzle schema is loaded
- **THEN** all columns SHALL match `schema.sql` lines 111-127 exactly, with no extra columns

### Requirement: Drizzle ORM wiki_sections table
The system SHALL define a `wikiSections` Drizzle pgTable matching `wiki_sections` in `schema.sql`. Columns: id (PK), tenant_id, space_id, wiki_page_pk (FK wiki_pages), page_version_id (FK wiki_page_versions), section_id, heading, level (INT default 2), section_index (INT), start_offset (INT nullable), end_offset (INT nullable), content_hash, acl_json (JSONB default '{}'), created_at. UNIQUE on (page_version_id, section_id).

#### Scenario: wiki_sections table matches SQL schema
- **WHEN** the Drizzle schema is loaded
- **THEN** all columns SHALL match `schema.sql` lines 296-312

### Requirement: Drizzle ORM source_links table
The system SHALL define a `sourceLinks` Drizzle pgTable matching `source_links` in `schema.sql`. Columns: id (PK), tenant_id, space_id, wiki_page_pk (FK wiki_pages), page_version_id (FK wiki_page_versions), section_id (FK wiki_sections, nullable), source_document_id (FK source_documents, nullable), source_uri, quote_hash, evidence_type (default 'reference'), created_at.

#### Scenario: source_links table matches SQL schema
- **WHEN** the Drizzle schema is loaded
- **THEN** all columns SHALL match `schema.sql` lines 435-447

### Requirement: All wiki-related indexes
The migration SHALL create ALL wiki-related indexes defined in `schema.sql`:
- `idx_wiki_pages_indexed_version` ON wiki_pages(indexed_version_id)
- `idx_wiki_pages_current_indexed` ON wiki_pages(current_version_id, indexed_version_id)
- `idx_wiki_versions_status` ON wiki_page_versions(tenant_id, space_id, status, created_at DESC)
- `idx_wiki_sections_page_version` ON wiki_sections(page_version_id)
- `idx_source_links_page_version` ON source_links(page_version_id)
- `idx_source_links_source_doc` ON source_links(source_document_id)

#### Scenario: All 6 indexes exist after migration
- **WHEN** migration completes
- **THEN** all 6 indexes listed above SHALL exist in the database

### Requirement: Zod validation schemas for wiki entities
The system SHALL export Zod schemas in `packages/shared/src/schema/validation.ts` for: `insertWikiPageSchema`, `insertWikiPageVersionSchema`, `publishRequestSchema` (version_id + optional publish_note), `rollbackRequestSchema` (target_version_id + optional reason).

#### Scenario: Insert wiki page validation
- **WHEN** an object with valid space_id, page_id, title, slug is parsed
- **THEN** validation SHALL pass and strip unknown fields

#### Scenario: Publish request validation
- **WHEN** a publish request with version_id is parsed
- **THEN** validation SHALL require version_id as non-empty string and accept optional publish_note

#### Scenario: Rollback request validation
- **WHEN** a rollback request with target_version_id is parsed
- **THEN** validation SHALL require target_version_id as non-empty string

### Requirement: DB migration for wiki tables
The system SHALL include a Drizzle migration that creates wiki_pages, wiki_page_versions, wiki_sections, source_links tables, their ALTER TABLE foreign keys, and all 6 indexes listed above.

#### Scenario: Migration creates tables idempotently
- **WHEN** migration runs against a database that already has these tables (from schema.sql seed)
- **THEN** migration SHALL succeed without error (CREATE TABLE IF NOT EXISTS or equivalent)
