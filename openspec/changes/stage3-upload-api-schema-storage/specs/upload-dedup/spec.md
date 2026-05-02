## ADDED Requirements

### Requirement: Content-level deduplication via SHA256
The system SHALL compute SHA256 hash of the uploaded file content and use it for content-level deduplication. If a file_blob with the same (tenant_id, sha256) already exists, the system SHALL NOT store a duplicate copy in MinIO. Instead, it SHALL reuse the existing file_blob record.

#### Scenario: First upload of a file (P1-E6 baseline)
- **WHEN** user uploads a file with SHA256 that does not exist in file_blobs for this tenant
- **THEN** system creates a new file_blob record, stores the file in MinIO, and creates a source_document referencing the new file_blob

#### Scenario: Duplicate content upload returns existing blob (P1-E6)
- **WHEN** user uploads a file with SHA256 that already exists in file_blobs for this tenant
- **THEN** system reuses the existing file_blob (no new MinIO storage), creates a new source_document referencing the existing file_blob, and skips quarantine-to-archive copy

### Requirement: Space-level reference deduplication
The system SHALL enforce uniqueness of (space_id, file_blob_id) in source_documents. If the same file content is uploaded to the same Space, the system SHALL return the existing source_document rather than creating a duplicate.

#### Scenario: Same file uploaded to same space returns existing document
- **WHEN** user uploads a file to space_rd where a source_document already exists for the same file_blob
- **THEN** system returns 200 (not 201) with the existing source_document_id and does not create a new record

#### Scenario: Same file uploaded to different space creates new document
- **WHEN** user uploads a file to space_legal that already exists in space_rd
- **THEN** system reuses the file_blob but creates a new source_document in space_legal, returns 201

### Requirement: Concurrent upload race condition handling
The system SHALL handle concurrent uploads of identical files gracefully. If two requests simultaneously try to create a file_blob with the same (tenant_id, sha256), the database UNIQUE constraint SHALL catch the conflict. The losing request SHALL fall back to querying the existing file_blob and proceed normally.

#### Scenario: Two concurrent uploads of same file
- **WHEN** two upload requests for the same file arrive simultaneously
- **THEN** exactly one file_blob is created, both requests complete successfully with the same file_blob_id, and only one copy exists in MinIO

### Requirement: URL upload deduplication
URL uploads SHALL NOT participate in SHA256 deduplication at upload time because the content is not yet available. Deduplication for URL uploads SHALL occur after url-fetcher-worker downloads the content and creates the file_blob. If the fetched content SHA256 matches an existing file_blob, the existing blob SHALL be reused.

#### Scenario: URL upload skips dedup at submission
- **WHEN** user submits a URL upload
- **THEN** system creates source_document without file_blob_id (null until fetched), no SHA256 check is performed

#### Scenario: URL fetch result matches existing blob
- **WHEN** url-fetcher-worker downloads content whose SHA256 matches an existing file_blob
- **THEN** the existing file_blob is linked to the source_document, no duplicate storage occurs
