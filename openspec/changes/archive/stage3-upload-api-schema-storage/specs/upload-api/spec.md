## ADDED Requirements

### Requirement: File upload endpoint
The system SHALL provide `POST /api/spaces/{space_id}/uploads` that accepts multipart file upload. The endpoint SHALL validate the user has `upload:create` permission on the target Space. The endpoint SHALL accept a single file via multipart form-data with optional metadata fields: `classification`, `tags`, `processing_strategy` (immediate/stash/archive_only). The response SHALL return `source_document_id`, `file_blob_id`, `job_id`, and `status`.

#### Scenario: Successful file upload
- **WHEN** authenticated user with upload:create permission uploads a 2MB PDF to space_rd
- **THEN** system returns 201 with source_document_id, file_blob_id, job_id, and status=uploaded

#### Scenario: Upload without permission
- **WHEN** authenticated user without upload:create permission uploads a file
- **THEN** system returns 403 FORBIDDEN

#### Scenario: Upload to non-existent space
- **WHEN** user uploads a file to a space_id that does not exist
- **THEN** system returns 404 SPACE_NOT_FOUND

#### Scenario: File exceeds hard limit
- **WHEN** user uploads a file larger than 200MB
- **THEN** system returns 413 FILE_TOO_LARGE with message indicating the 200MB limit

### Requirement: URL upload endpoint
The system SHALL accept URL uploads through the same `POST /api/spaces/{space_id}/uploads` endpoint with `source_type=url` and a `url` field in the request body (JSON or multipart). The system SHALL validate the URL format and protocol (only http/https allowed). The system SHALL create a source_document with status=uploaded, source_type=url, and file_blob_id=NULL (nullable for URL uploads until fetch completes), then create a `url_fetch` Job with queue_name=`url-fetch`.

#### Scenario: Successful URL upload
- **WHEN** user submits a valid https URL to the upload endpoint
- **THEN** system returns 201 with source_document_id, job_id (type=url_fetch), and status=uploaded

#### Scenario: Invalid URL protocol
- **WHEN** user submits a URL with ftp:// or file:// protocol
- **THEN** system returns 400 INVALID_URL_PROTOCOL with message "Only http and https protocols are allowed"

#### Scenario: Malformed URL
- **WHEN** user submits a string that is not a valid URL
- **THEN** system returns 400 INVALID_URL_FORMAT

### Requirement: Upload metadata query
The system SHALL provide `GET /api/uploads/{source_document_id}` that returns the full metadata of an upload including: id, filename, mime_type, sha256, size_bytes, source_type, classification, status, uploader_id, space_id, created_at, updated_at. The user MUST have read permission on the associated Space.

#### Scenario: Query existing upload
- **WHEN** user with space read permission queries an existing source_document_id
- **THEN** system returns 200 with complete metadata including filename, mime_type, sha256, size_bytes, status

#### Scenario: Query non-existent upload
- **WHEN** user queries a source_document_id that does not exist
- **THEN** system returns 404 UPLOAD_NOT_FOUND

#### Scenario: Query without space permission
- **WHEN** user without read permission on the associated Space queries an upload
- **THEN** system returns 403 FORBIDDEN

### Requirement: Upload status query
The system SHALL provide `GET /api/uploads/{source_document_id}/status` that returns the current processing status and associated job information. The response SHALL include: status, job_id, job_status, progress_percent (if available), error_json (if failed). Valid status values: uploaded, archived, parsing, parsed, parse_failed, security_rejected, graphify_pending.

#### Scenario: Check status of processing upload
- **WHEN** user queries status of an upload that is currently being parsed
- **THEN** system returns 200 with status=parsing, job_id, and current progress_percent

#### Scenario: Check status of failed upload
- **WHEN** user queries status of an upload that failed parsing
- **THEN** system returns 200 with status=parse_failed and error_json containing failure details

### Requirement: Reprocess failed upload
The system SHALL provide `POST /api/uploads/{source_document_id}/reprocess` that re-triggers parsing for uploads with status=parse_failed. The system SHALL create a new ingestion Job and update status to uploaded. The user MUST have upload:create permission. Reprocess SHALL NOT be allowed for uploads in non-terminal-failure states.

#### Scenario: Reprocess a parse_failed upload
- **WHEN** user with upload:create permission calls reprocess on a parse_failed source_document
- **THEN** system creates a new ingestion Job, updates status to uploaded, returns 200 with new job_id

#### Scenario: Reprocess a non-failed upload
- **WHEN** user calls reprocess on a source_document with status=parsed
- **THEN** system returns 409 CONFLICT with message "Only parse_failed uploads can be reprocessed"

#### Scenario: Reprocess a security_rejected upload
- **WHEN** user calls reprocess on a source_document with status=security_rejected
- **THEN** system returns 409 CONFLICT with message "Security rejected uploads cannot be reprocessed"

### Requirement: File size tier routing
The system SHALL classify uploads into size tiers and assign Job priority accordingly. Small files (≤5MB) SHALL get priority=50 (high). Medium files (5-50MB) SHALL get priority=100 (normal). Large files (>50MB, ≤200MB) SHALL get priority=200 (low). Files >200MB SHALL be rejected with 413. All ingestion Jobs SHALL use queue_name=`ingestion`. All url_fetch Jobs SHALL use queue_name=`url-fetch`.

#### Scenario: Small file priority
- **WHEN** user uploads a 3MB file
- **THEN** the created ingestion Job has priority=50

#### Scenario: Medium file priority
- **WHEN** user uploads a 25MB file
- **THEN** the created ingestion Job has priority=100

#### Scenario: Large file priority
- **WHEN** user uploads a 100MB file
- **THEN** the created ingestion Job has priority=200

### Requirement: Database schema for file_blobs and source_documents
The system SHALL create Drizzle ORM schema and migration for `file_blobs` and `source_documents` tables matching the definitions in `docs/schemas/schema.sql`. The `file_blobs` table SHALL have a UNIQUE constraint on (tenant_id, sha256). The `source_documents` table SHALL have `file_blob_id` as NULLABLE (for URL uploads before fetch completes). The UNIQUE constraint on (space_id, file_blob_id) allows multiple NULLs per PostgreSQL semantics.

#### Scenario: Migration creates tables
- **WHEN** Drizzle migration runs on a fresh database
- **THEN** file_blobs and source_documents tables are created with all columns, constraints, and indexes as defined in schema.sql
