## ADDED Requirements

### Requirement: Page saved webhook notification

The system SHALL POST to Cherry API at `{CHERRY_API_INTERNAL_URL}/api/internal/docmost/events/page-saved` after every successful page save in Docmost. The notification SHALL be asynchronous (fire-and-forget from the user's perspective) and SHALL NOT block the save operation.

Payload SHALL include:
- `event_id`: UUID v4 (unique per event)
- `event_type`: "page.saved"
- `timestamp`: Unix seconds when event was generated
- `space_id`: Docmost space ID
- `page_id`: Docmost page ID
- `title`: Current page title
- `updated_by`: User ID who saved
- `content_hash`: SHA256 of current page Markdown content

The request SHALL include X-Bridge-Signature, X-Bridge-Timestamp, and X-Bridge-Nonce headers computed using the shared DOCMOST_BRIDGE_SECRET.

#### Scenario: Page save triggers webhook
- **WHEN** a user saves a page in Docmost
- **THEN** Cherry API receives POST /api/internal/docmost/events/page-saved within 5 seconds with correct payload and HMAC signature

#### Scenario: Save succeeds even when Cherry API is unreachable
- **WHEN** a user saves a page but Cherry API is down
- **THEN** the page save completes successfully in Docmost; the webhook failure is logged but does not propagate to the user

#### Scenario: Webhook retry on transient failure
- **WHEN** Cherry API returns 5xx on first attempt
- **THEN** the system retries up to 3 times with exponential backoff (1s, 5s, 25s) before giving up

#### Scenario: Rapid consecutive saves deduplicated (P2-E10)
- **WHEN** a user saves the same page twice within 2 seconds
- **THEN** only the latest save generates a webhook event (earlier save is debounced/superseded)

### Requirement: Page deleted webhook notification

The system SHALL POST to `{CHERRY_API_INTERNAL_URL}/api/internal/docmost/events/page-deleted` after page deletion.

Payload SHALL include:
- `event_id`: UUID v4
- `event_type`: "page.deleted"
- `timestamp`: Unix seconds
- `space_id`: Docmost space ID
- `page_id`: Docmost page ID
- `deleted_by`: User ID who deleted

#### Scenario: Page deletion triggers webhook
- **WHEN** a user deletes a page in Docmost
- **THEN** Cherry API receives POST /api/internal/docmost/events/page-deleted with correct payload

### Requirement: Attachment created webhook notification

The system SHALL POST to `{CHERRY_API_INTERNAL_URL}/api/internal/docmost/events/attachment-created` after attachment upload.

Payload SHALL include:
- `event_id`: UUID v4
- `event_type`: "attachment.created"
- `timestamp`: Unix seconds
- `space_id`: Docmost space ID
- `page_id`: Associated page ID (nullable if workspace-level)
- `attachment_id`: Docmost attachment ID
- `filename`: Original filename
- `mime_type`: Detected MIME type
- `size_bytes`: File size
- `download_url`: Relative URL for Bridge download API

#### Scenario: Attachment upload triggers webhook
- **WHEN** a user uploads an attachment in Docmost
- **THEN** Cherry API receives POST /api/internal/docmost/events/attachment-created with download_url pointing to /api/internal/bridge/attachments/{id}/download

### Requirement: Attachment deleted webhook notification

The system SHALL POST to `{CHERRY_API_INTERNAL_URL}/api/internal/docmost/events/attachment-deleted` after attachment deletion.

Payload SHALL include:
- `event_id`: UUID v4
- `event_type`: "attachment.deleted"
- `timestamp`: Unix seconds
- `space_id`: Docmost space ID
- `page_id`: Associated page ID (nullable)
- `attachment_id`: Docmost attachment ID
- `deleted_by`: User ID who deleted

#### Scenario: Attachment deletion triggers webhook
- **WHEN** a user deletes an attachment in Docmost
- **THEN** Cherry API receives POST /api/internal/docmost/events/attachment-deleted with attachment_id and space_id

### Requirement: Space updated webhook notification

The system SHALL POST to `{CHERRY_API_INTERNAL_URL}/api/internal/docmost/events/space-updated` when a Docmost space's properties or membership changes.

Payload SHALL include:
- `event_id`: UUID v4
- `event_type`: "space.updated"
- `timestamp`: Unix seconds
- `space_id`: Docmost space ID
- `change_type`: One of "properties" | "membership" | "permissions"
- `updated_by`: User ID who made the change

#### Scenario: Space property change triggers webhook
- **WHEN** a space name or settings are modified in Docmost
- **THEN** Cherry API receives POST /api/internal/docmost/events/space-updated with change_type="properties"

### Requirement: Webhook signature generation

All outbound webhooks from Docmost to Cherry API SHALL include HMAC-SHA256 signature headers using the same algorithm as BridgeAuthGuard:
- X-Bridge-Signature: `sha256=<hex>`
- X-Bridge-Timestamp: `<unix_seconds>`
- X-Bridge-Nonce: `<uuid>`
- Authorization: `Bearer <DOCMOST_BRIDGE_SECRET>`

The HMAC payload SHALL be: `${timestamp}\n${nonce}\n${method}\n${path}\n${bodyHash}`.

#### Scenario: Cherry API can verify webhook authenticity
- **WHEN** Cherry API receives a webhook from Docmost
- **THEN** the X-Bridge-Signature can be verified using the shared DOCMOST_BRIDGE_SECRET, timestamp, nonce, and request body
