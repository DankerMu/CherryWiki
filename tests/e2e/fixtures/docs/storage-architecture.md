# Object Storage Architecture

CherryWiki uses MinIO (S3-compatible) for document storage with a quarantine-archive lifecycle.

## Bucket Structure

- **quarantine**: Newly uploaded files land here first. Ingestion workers pick files from quarantine for processing.
- **archive**: Successfully parsed and validated files are promoted to archive. Archive files are immutable and referenced by source_documents.
- **wiki-assets**: Extracted images and attachments from wiki pages.

## Upload Lifecycle

1. User uploads via `POST /api/spaces/:spaceId/uploads` (multipart/form-data)
2. File stored in quarantine bucket with key `{tenant_id}/{space_id}/{uuid}/{filename}`
3. `source_documents` row created with status='uploaded'
4. Ingestion job queued in Redis (queue: 'ingestion', type: 'parse')
5. Ingestion worker claims job, downloads from quarantine
6. Worker parses file → generates `parsed.md`
7. `parsed.md` uploaded to archive bucket
8. `source_documents.status` updated to 'parsed'
9. Quarantine file retained for 7 days, then auto-deleted

## File Validation

Before quarantine storage:
- MIME type validation (rejects mismatched extensions)
- File size check (max 50MB per file)
- Malware scanning placeholder (extensible via validation pipeline)

## Supported Formats

| Format | Parser | Notes |
|--------|--------|-------|
| PDF | pdf-parse | Extracts text + metadata |
| DOCX | mammoth | Converts to markdown |
| Markdown | passthrough | Stored as-is |
| TXT | passthrough | Plain text preserved |
