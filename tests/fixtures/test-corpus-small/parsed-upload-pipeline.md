# Upload and Ingestion Pipeline

## Upload Flow

Files uploaded via `POST /api/spaces/{space_id}/uploads` go through a multi-stage pipeline:

1. **Quarantine** — file lands in a temporary quarantine bucket
2. **Validation** — MIME type check, magic bytes verification, size limit enforcement
3. **Archive** — validated file moves to the permanent archive bucket
4. **Parsing** — ingestion-worker extracts text content to `parsed.md`

## Supported Formats

| Format | Max Size | Parser |
|---|---|---|
| PDF | 50 MB | PyMuPDF |
| DOCX | 50 MB | python-docx |
| Markdown | 10 MB | passthrough |
| Plain text | 10 MB | passthrough |
| ZIP | 200 MB | zipfile (with security checks) |

## ZIP Security

ZIP archives undergo additional validation:

- Total uncompressed size must not exceed 500 MB
- No path traversal (`../` in filenames)
- Maximum nesting depth of 2 levels
- Maximum 100 files per archive

## URL Fetching

Documents can also be ingested from URLs via `POST /api/spaces/{space_id}/uploads` with `source_type=url`. The url-fetcher-worker applies SSRF protection before downloading.

### SSRF Protection

Blocked targets:
- Private IP ranges (10.x, 172.16-31.x, 192.168.x)
- Loopback (127.x, ::1)
- Link-local (169.254.x)
- Cloud metadata endpoints (169.254.169.254)

DNS resolution is checked before connection to prevent DNS rebinding attacks.
