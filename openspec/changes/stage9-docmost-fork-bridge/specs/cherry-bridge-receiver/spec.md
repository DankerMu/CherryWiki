## ADDED Requirements

### Requirement: Webhook event reception

The Cherry API SHALL expose internal endpoints to receive Docmost Bridge events:
- POST /api/internal/docmost/events/page-saved
- POST /api/internal/docmost/events/page-deleted
- POST /api/internal/docmost/events/attachment-created
- POST /api/internal/docmost/events/attachment-deleted
- POST /api/internal/docmost/events/space-updated

These endpoints SHALL validate the incoming HMAC signature (including nonce) using the shared DOCMOST_BRIDGE_SECRET before processing. The system SHALL support dual-key rotation: if DOCMOST_BRIDGE_SECRET_NEXT is set, signatures computed with either key SHALL be accepted.

#### Scenario: Valid event received and persisted
- **WHEN** Docmost sends a webhook with valid HMAC signature, fresh nonce, and new event_id
- **THEN** the event is persisted to bridge_events table with status=received, response is 200 with `{accepted: true, event_id: "..."}`

#### Scenario: Invalid HMAC rejected
- **WHEN** a request arrives at /api/internal/docmost/events/* with invalid signature
- **THEN** response is 401, event is NOT persisted, audit log records bridge.hmac_rejected

#### Scenario: Expired timestamp rejected
- **WHEN** a request arrives with X-Bridge-Timestamp older than 5 minutes
- **THEN** response is 401 with error code BRIDGE_TIMESTAMP_EXPIRED

#### Scenario: Duplicate nonce rejected
- **WHEN** a request arrives with an X-Bridge-Nonce that was already seen within 10 minutes
- **THEN** response is 401 with error code BRIDGE_NONCE_REUSED

### Requirement: Event idempotency

The Cherry API SHALL enforce idempotent event processing using the event_id field. Duplicate event_id submissions SHALL NOT create new records or trigger new processing.

#### Scenario: First submission accepted
- **WHEN** an event with new event_id arrives
- **THEN** event is persisted and response includes `{accepted: true, deduplicated: false}`

#### Scenario: Duplicate submission deduplicated
- **WHEN** an event with an already-processed event_id arrives
- **THEN** no new record is created, response is 200 with `{accepted: true, deduplicated: true}`

#### Scenario: Concurrent duplicate handled
- **WHEN** two requests with the same event_id arrive simultaneously
- **THEN** exactly one record is persisted (UNIQUE constraint), both requests return 200

### Requirement: Rate limiting for Bridge endpoints

The Cherry API SHALL enforce rate limiting on Bridge webhook endpoints to provide defense-in-depth against key compromise or misconfigured clients:
- Per-source IP: 100 requests/minute
- Per-space_id: 200 requests/minute
- Global: 1000 requests/minute

Rate limit exceeded SHALL return 429 Too Many Requests.

#### Scenario: Normal traffic within limits
- **WHEN** Docmost sends events at normal pace (< 100/min per IP)
- **THEN** all requests are processed normally

#### Scenario: Rate limit exceeded
- **WHEN** a source sends > 100 requests/minute from the same IP
- **THEN** response is 429 with Retry-After header, event NOT persisted

### Requirement: Webhook delivery tracking

The Cherry API SHALL record each inbound webhook delivery in the webhook_deliveries table for observability and debugging.

Each delivery record SHALL include:
- bridge_event_id (FK to bridge_events)
- direction: "inbound"
- attempt: sequence number (always 1 for inbound)
- status_code: HTTP status returned to caller
- response_time_ms: processing duration
- created_at: receipt timestamp

#### Scenario: Successful delivery recorded
- **WHEN** a valid webhook is processed successfully
- **THEN** webhook_deliveries has a record with status_code=200 and response_time_ms populated

#### Scenario: Failed delivery recorded
- **WHEN** a webhook is rejected (401 or 500)
- **THEN** webhook_deliveries has a record with the actual status_code and error details

### Requirement: Bridge event audit logging

The Cherry API SHALL emit audit events for Bridge operations:
- `bridge.event_received`: Event accepted and persisted (includes event_id, event_type, space_id)
- `bridge.event_processed`: Event fully processed by downstream consumer
- `bridge.hmac_rejected`: Authentication failure (includes source IP, failure reason)
- `bridge.nonce_reused`: Nonce replay attempt detected
- `bridge.rate_limited`: Rate limit triggered (includes source IP, space_id)
- `bridge.outbound_call`: Cherry → Docmost API call (export/import/permissions)

#### Scenario: Successful event audited
- **WHEN** a valid webhook event is received
- **THEN** audit_logs contains a bridge.event_received entry with event_id, event_type, space_id

#### Scenario: Rejected request audited
- **WHEN** an HMAC validation fails
- **THEN** audit_logs contains a bridge.hmac_rejected entry with source IP and failure reason

#### Scenario: Outbound call audited
- **WHEN** Cherry API calls Docmost Bridge (export/import/permissions)
- **THEN** audit_logs contains a bridge.outbound_call entry with target endpoint and response status
