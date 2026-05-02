## ADDED Requirements

### Requirement: Parsed.md frontmatter standard
Every parsed.md output SHALL include a YAML frontmatter block containing the following mandatory fields: source_document_id, original_filename, source_type, uploaded_by, space_id, sha256, parsed_md_hash, parsed_at, extraction_tool, extraction_tool_version.

#### Scenario: Frontmatter completeness
- **WHEN** ingestion-worker produces a parsed.md for a PDF file
- **THEN** the frontmatter contains all mandatory fields including source_document_id, extraction_tool="pdfplumber", extraction_tool_version matching the installed pdfplumber version

#### Scenario: parsed_md_hash for change detection
- **WHEN** the same file is re-parsed (reprocess)
- **THEN** parsed_md_hash is recalculated, and if the content differs from the previous parse, downstream Graphify can detect the change

### Requirement: Extraction metadata tracking
Each parsed.md SHALL include additional extraction metadata in the frontmatter: extraction_params (OCR language, table strategy, etc.), extraction_duration_ms, page_count (for PDF/Office), char_count (extracted characters), image_count (referenced images).

#### Scenario: PDF extraction metadata
- **WHEN** a 50-page PDF is parsed with OCR enabled
- **THEN** frontmatter includes extraction_params.ocr_enabled=true, extraction_params.ocr_lang="chi_sim+eng", page_count=50, char_count reflecting total extracted characters, extraction_duration_ms reflecting actual parsing time

#### Scenario: Text file metadata
- **WHEN** a .txt file is parsed
- **THEN** frontmatter includes extraction_tool="passthrough", page_count=1, char_count matching file content length

### Requirement: Parsed.md storage location
The parsed.md output SHALL be stored in MinIO at the path: `archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}.parsed.md`. The source_document.parsed_uri field SHALL be updated with this storage path upon successful parsing.

#### Scenario: Parsed output storage
- **WHEN** ingestion-worker successfully parses a file
- **THEN** the parsed.md is uploaded to MinIO at the correct archive path and source_document.parsed_uri is updated

### Requirement: Preview text generation
The system SHALL generate a preview text (first 500 characters of the parsed content, excluding frontmatter) and store its hash as preview_hash in the frontmatter. The preview text itself SHALL be stored as `{sha256}.preview.txt` alongside the parsed.md.

#### Scenario: Preview generation
- **WHEN** a document is successfully parsed
- **THEN** a preview.txt file is generated with the first 500 characters and preview_hash is included in the frontmatter
