## ADDED Requirements

### Requirement: Quarantine stage storage
The system SHALL store uploaded files in a quarantine location before security validation. The quarantine path SHALL follow the pattern: `quarantine/{tenant_id}/{space_id}/{upload_id}_{original_filename}`. Files in quarantine SHALL NOT be accessible to ingestion-worker or any downstream processing until explicitly promoted to archive.

#### Scenario: File lands in quarantine on upload
- **WHEN** user uploads a file via POST /api/spaces/{space_id}/uploads
- **THEN** the file is stored in MinIO at quarantine/{tenant_id}/{space_id}/{upload_id}_{filename}

#### Scenario: Quarantine file isolation
- **WHEN** ingestion-worker polls for pending jobs
- **THEN** it SHALL NOT process files that are still in quarantine (source_document status=uploaded)

### Requirement: Archive stage storage
The system SHALL move files from quarantine to archive after security validation passes. The archive path SHALL follow the pattern: `archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}_{original_filename.ext}`. The archive SHALL be immutable — files SHALL NOT be deleted or overwritten after archival.

#### Scenario: File promoted to archive after validation
- **WHEN** security validation passes for a quarantined file
- **THEN** the file is copied to archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}_{filename.ext} and the quarantine copy is deleted

#### Scenario: Archive path recorded in file_blob
- **WHEN** file is promoted to archive
- **THEN** the file_blob.storage_uri is updated to the archive path

### Requirement: Immutable archive on parse failure
Original files SHALL remain in archive even when parsing fails. The source_document status SHALL be set to parse_failed but the archived file SHALL NOT be deleted. This ensures P1-E8 compliance: parse failures preserve original files.

#### Scenario: Parse failure preserves archive file (P1-E8)
- **WHEN** ingestion-worker fails to parse a file and sets source_document status to parse_failed
- **THEN** the original file remains accessible at its archive path in MinIO

#### Scenario: Parse failure does not trigger Graphify
- **WHEN** source_document status transitions to parse_failed
- **THEN** no graphify Job is created for this source_document

### Requirement: Quarantine cleanup
The system SHALL provide a mechanism to clean up security_rejected files from quarantine after a retention period. Files with status=security_rejected SHALL be retained for 7 days, then eligible for deletion. The cleanup MAY be implemented as a scheduled task or manual admin operation in MVP.

#### Scenario: Rejected file retained for 7 days
- **WHEN** a file is security_rejected
- **THEN** the quarantine file remains accessible for at least 7 days after rejection

#### Scenario: Rejected file cleaned up after retention
- **WHEN** cleanup runs and a security_rejected file has been in quarantine for more than 7 days
- **THEN** the quarantine file is deleted and source_document metadata_json records the cleanup timestamp

### Requirement: Archive path convention
The archive path SHALL encode tenant isolation, space isolation, date partitioning, and content addressing. The full path format is: `archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256_prefix8}_{original_filename.ext}`. The SHA256 prefix (first 8 chars) prevents filename collisions while keeping paths human-readable.

#### Scenario: Archive path structure
- **WHEN** user "user_001" in tenant "t1" uploads "report.pdf" (sha256=abc12345...) to space "sp1" on 2026-04-30
- **THEN** the archive path is `archive/t1/sp1/2026/04/30/abc12345_report.pdf`
