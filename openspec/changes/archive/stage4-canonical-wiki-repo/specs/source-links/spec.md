## ADDED Requirements

### Requirement: Source links CRUD in wiki-core
The `wiki-core` package SHALL export functions for creating and querying source_links records that map wiki page sections to source documents.

#### Scenario: Create source link
- **WHEN** a source link is created with wiki_page_pk, page_version_id, section_id, source_document_id, and evidence_type
- **THEN** a `source_links` record SHALL be persisted with all provided fields and a generated id

#### Scenario: Batch create source links
- **WHEN** multiple source links are created for the same page version
- **THEN** all records SHALL be inserted in a single transaction

#### Scenario: Query source links by page version
- **WHEN** querying source links with a page_version_id
- **THEN** all source links for that version SHALL be returned, ordered by section_index

### Requirement: Source links internal query API
The `wiki-core` package SHALL expose source link query functions for internal use. Source links are NOT included in the `WikiPageContent` API response (to match openapi.yaml schema). They are queried separately by callers (e.g., future Chat citation, admin views).

#### Scenario: Query source links by page version
- **WHEN** `queryByPageVersion(pageVersionId)` is called and source links exist
- **THEN** result SHALL contain an array of `{ section_id, source_document_id, source_uri, evidence_type }` ordered by section_index

#### Scenario: Query with no source links
- **WHEN** `queryByPageVersion(pageVersionId)` is called and no source links exist
- **THEN** result SHALL be an empty array

### Requirement: Source links referential integrity
Source link records SHALL maintain referential integrity with wiki_pages, wiki_page_versions, wiki_sections, and source_documents tables.

#### Scenario: Source link references valid entities
- **WHEN** a source link is created
- **THEN** wiki_page_pk, page_version_id MUST reference existing records; section_id and source_document_id MAY be null

#### Scenario: Cascade behavior
- **WHEN** a wiki page version is deleted (if ever)
- **THEN** associated source links SHALL be preserved (no cascade delete — versions are append-only)
