## ADDED Requirements

### Requirement: Magic bytes file type detection
The system SHALL read the first 4096 bytes of an uploaded file and use magic bytes analysis to determine the true file type. The detected type SHALL be compared against the declared Content-Type and file extension. If the detected type conflicts with the declared type for binary files, the upload SHALL be rejected with status=security_rejected.

#### Scenario: Matching magic bytes and extension
- **WHEN** a file with .pdf extension has PDF magic bytes (%PDF-) and Content-Type application/pdf
- **THEN** validation passes

#### Scenario: ELF binary masquerading as PDF (P1-E15)
- **WHEN** a file with .pdf extension has ELF magic bytes (0x7f454c46)
- **THEN** validation fails, source_document status is set to security_rejected, audit_log records "magic_bytes_mismatch" with detected_type=application/x-executable and declared_type=application/pdf

#### Scenario: Text file with no magic bytes
- **WHEN** a .txt or .md file has no recognizable magic bytes and contains only printable text/UTF-8 content
- **THEN** validation passes (text files are exempt from strict magic bytes check)

#### Scenario: Shell script masquerading as text file (P1-E15)
- **WHEN** a file named `notes.txt` starts with a shebang line (`#!/bin/bash` or `#!/usr/bin/env python`)
- **THEN** validation fails with status=security_rejected and reason "MIME_MISMATCH" (shebang indicates executable script, not plain text)

#### Scenario: Binary content in text extension
- **WHEN** a file with .txt extension contains non-UTF-8 binary content (null bytes in first 4096 bytes)
- **THEN** validation fails with status=security_rejected and reason "MIME_MISMATCH"

### Requirement: Extension whitelist
The system SHALL maintain a whitelist of allowed file extensions for Phase 1: .md, .mdx, .txt, .rst, .pdf, .docx, .pptx, .xlsx, .png, .jpg, .jpeg, .webp, .zip. Files with extensions not in the whitelist SHALL be rejected.

#### Scenario: Allowed extension
- **WHEN** user uploads a file with .docx extension
- **THEN** extension validation passes

#### Scenario: Disallowed extension
- **WHEN** user uploads a file with .exe extension
- **THEN** validation fails with status=security_rejected and reason "extension_not_allowed"

#### Scenario: No extension
- **WHEN** user uploads a file with no extension
- **THEN** validation fails with status=security_rejected and reason "missing_extension"

### Requirement: MIME type consistency check
The system SHALL verify that the declared Content-Type, the detected magic bytes type, and the file extension are consistent. The system SHALL use a mapping table to define valid combinations (e.g., .pdf → application/pdf → PDF magic bytes).

#### Scenario: Consistent MIME type
- **WHEN** a .docx file has Content-Type application/vnd.openxmlformats-officedocument.wordprocessingml.document and ZIP magic bytes (Office files are ZIP-based)
- **THEN** validation passes

#### Scenario: Inconsistent MIME type
- **WHEN** a .pdf file has Content-Type image/png
- **THEN** validation fails with status=security_rejected and reason "mime_type_mismatch"

### Requirement: Security rejection audit logging
The system SHALL write an audit_log entry for every security rejection. The audit entry SHALL include: action="upload.security_rejected", user_id, space_id, source_document_id, rejection_reason, detected_type, declared_type, filename.

#### Scenario: Audit log on rejection
- **WHEN** a file is rejected due to magic bytes mismatch
- **THEN** an audit_log entry is created with action="upload.security_rejected" and all relevant details

### Requirement: Standardized error codes
The security rejection reason codes SHALL use the following standardized values to align with test specifications (Doc 14 §4.5A/B): `MIME_MISMATCH` for magic bytes / MIME / shebang violations, `ZIP_BOMB_DETECTED` for ZIP bomb, `PATH_TRAVERSAL_DETECTED` for ZIP path traversal, `ZIP_NESTING_EXCEEDED` for ZIP nesting depth, `SSRF_BLOCKED` for SSRF violations. These codes SHALL appear in both audit_log metadata and API error responses.

#### Scenario: Error code in API response
- **WHEN** an ELF binary is uploaded as report.pdf
- **THEN** the API returns 422 with error_code="MIME_MISMATCH" and the audit_log uses the same code
