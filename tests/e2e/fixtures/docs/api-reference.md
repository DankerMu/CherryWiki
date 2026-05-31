# API Reference

CherryWiki exposes a RESTful API at `/api/` with JWT authentication.

## Authentication

### POST /api/auth/login
Request: `{"email": "user@example.com", "password": "..."}`
Response: `{"data": {"access_token": "jwt...", "expires_in": 3600, "user": {...}}}`

### POST /api/auth/refresh
Request: `{"refresh_token": "..."}`
Response: `{"data": {"access_token": "jwt...", "expires_in": 3600}}`

## Uploads

### POST /api/spaces/:spaceId/uploads
Upload a document file (multipart/form-data) or URL for processing.
- Field: `file` (binary) or body `{"url": "https://..."}`
- Returns: `{"data": {"id": "...", "source_document_id": "...", "status": "uploaded"}}`

### GET /api/uploads/:sourceDocumentId/status
Check processing status of an uploaded document.
- Returns: `{"data": {"status": "uploaded|parsing|parsed|indexing|indexed|failed"}}`

## Chat

### POST /api/chat/completions
Send a chat message with retrieval-augmented generation.
- Body: `{"message": "...", "space_id": "...", "retrieval_mode": "hybrid"}`
- Response: SSE stream of events (session, content, citations, usage, message.completed)

### GET /api/chat/sessions
List chat sessions for the authenticated user.

## Wiki

### GET /api/wiki/pages?space_id=...
List wiki pages in a space.

### GET /api/wiki/pages/:pageId
Get a single wiki page with content.

## Spaces

### GET /api/spaces
List spaces accessible to the authenticated user.

### POST /api/spaces
Create a new space (admin only).

## Health

### GET /api/health
Returns service health status. No authentication required.
Response: `{"status": "ok", "version": "1.0.0"}`
