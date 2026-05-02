## ADDED Requirements

### Requirement: ZIP bomb detection
The system SHALL detect ZIP bombs by calculating the total uncompressed size of all entries before extraction. If the total uncompressed size exceeds 500MB, the ZIP SHALL be rejected with status=security_rejected. The system SHALL also detect compression ratio bombs (ratio > 100:1 for any single entry).

#### Scenario: Normal ZIP file
- **WHEN** a ZIP file has total uncompressed size of 50MB
- **THEN** ZIP bomb validation passes

#### Scenario: ZIP bomb detected by total size (P1-E14)
- **WHEN** a ZIP file has total uncompressed size exceeding 500MB
- **THEN** validation fails with status=security_rejected and reason "zip_bomb_total_size"

#### Scenario: ZIP bomb detected by compression ratio
- **WHEN** a ZIP file has an entry with compression ratio > 100:1 (e.g., 1KB compressed → 200MB uncompressed)
- **THEN** validation fails with status=security_rejected and reason "zip_bomb_compression_ratio"

### Requirement: ZIP symlink entry prohibition
The system SHALL reject ZIP files containing symbolic link entries. Any entry with an external file attribute indicating a symlink SHALL cause the entire ZIP to be rejected with reason "ZIP_SYMLINK_DETECTED".

#### Scenario: ZIP with symlink entry
- **WHEN** a ZIP file contains a symbolic link entry pointing to `/etc/passwd`
- **THEN** validation fails with status=security_rejected and reason "ZIP_SYMLINK_DETECTED"

### Requirement: ZIP path traversal prevention
The system SHALL inspect every entry path in the ZIP file. Entries containing path traversal sequences (../, ..\, or absolute paths starting with /) SHALL cause the entire ZIP to be rejected.

#### Scenario: Normal ZIP paths
- **WHEN** a ZIP file contains entries like "docs/readme.md" and "src/main.py"
- **THEN** path traversal validation passes

#### Scenario: Path traversal detected (P1-E14)
- **WHEN** a ZIP file contains an entry with path "../../etc/passwd"
- **THEN** validation fails with status=security_rejected and reason "zip_path_traversal"

#### Scenario: Absolute path detected
- **WHEN** a ZIP file contains an entry with path "/etc/shadow"
- **THEN** validation fails with status=security_rejected and reason "zip_absolute_path"

### Requirement: ZIP nesting depth limit
The system SHALL detect nested ZIP files (ZIP within ZIP). The maximum nesting depth SHALL be 3 levels. ZIP files with nesting deeper than 3 levels SHALL be rejected.

#### Scenario: Single level ZIP
- **WHEN** a ZIP file contains only regular files (no nested ZIPs)
- **THEN** nesting validation passes

#### Scenario: Acceptable nesting (2 levels)
- **WHEN** a ZIP file contains another ZIP, which contains regular files
- **THEN** nesting validation passes (depth=2, within limit of 3)

#### Scenario: Excessive nesting (P1-E14)
- **WHEN** a ZIP file contains nested ZIPs exceeding 3 levels deep
- **THEN** validation fails with status=security_rejected and reason "zip_nesting_exceeded"

### Requirement: ZIP entry count limit
The system SHALL reject ZIP files containing more than 10,000 entries to prevent resource exhaustion during scanning.

#### Scenario: ZIP with excessive entries
- **WHEN** a ZIP file contains 15,000 entries
- **THEN** validation fails with status=security_rejected and reason "zip_entry_count_exceeded"

### Requirement: ZIP allowed content types
After ZIP extraction, each individual file within the ZIP SHALL be validated against the same extension whitelist and magic bytes checks as direct uploads. Files within the ZIP that fail validation SHALL cause the entire ZIP to be rejected.

#### Scenario: ZIP containing allowed file types
- **WHEN** a ZIP contains .pdf, .docx, and .md files
- **THEN** content validation passes for all entries

#### Scenario: ZIP containing disallowed file type
- **WHEN** a ZIP contains a .exe file among other valid files
- **THEN** the entire ZIP is rejected with status=security_rejected and reason "zip_contains_disallowed_type"
