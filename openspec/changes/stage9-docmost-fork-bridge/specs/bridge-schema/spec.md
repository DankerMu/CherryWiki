## ADDED Requirements

### Requirement: bridge_events table definition

The system SHALL define a `bridge_events` table in Drizzle ORM with the following columns:
- `id`: UUID primary key (default gen_random_uuid())
- `event_id`: VARCHAR(64) NOT NULL UNIQUE — external idempotency key from webhook
- `event_type`: VARCHAR(50) NOT NULL — e.g., "page.saved", "page.deleted", "attachment.created", "attachment.deleted", "space.updated"
- `source`: VARCHAR(20) NOT NULL DEFAULT 'docmost' — origin system
- `space_id`: VARCHAR(64) — Docmost space ID (nullable for system events)
- `page_id`: VARCHAR(64) — Docmost page ID (nullable)
- `payload`: JSONB NOT NULL — full event payload
- `status`: VARCHAR(20) NOT NULL DEFAULT 'received' — received | processing | processed | failed
- `error_json`: JSONB — error details if status=failed
- `received_at`: TIMESTAMP NOT NULL DEFAULT now()
- `processed_at`: TIMESTAMP — when status transitioned to processed/failed
- `created_at`: TIMESTAMP NOT NULL DEFAULT now()

Indexes:
- UNIQUE on event_id
- INDEX on (space_id, event_type, received_at DESC)
- INDEX on (status) WHERE status IN ('received', 'processing')

#### Scenario: Schema matches Drizzle definition
- **WHEN** migration runs on a clean database
- **THEN** bridge_events table exists with all columns, types, defaults, and indexes as specified

#### Scenario: Unique constraint prevents duplicate events
- **WHEN** two INSERT statements with the same event_id execute
- **THEN** the second INSERT fails with unique violation (application catches and returns deduplicated=true)

### Requirement: webhook_deliveries table definition

The system SHALL define a `webhook_deliveries` table in Drizzle ORM with the following columns:
- `id`: UUID primary key (default gen_random_uuid())
- `bridge_event_id`: UUID NOT NULL FK → bridge_events.id ON DELETE CASCADE
- `direction`: VARCHAR(10) NOT NULL — 'inbound' | 'outbound'
- `attempt`: INTEGER NOT NULL DEFAULT 1
- `status_code`: INTEGER — HTTP status code (nullable for pending outbound)
- `response_time_ms`: INTEGER — duration in milliseconds
- `error`: TEXT — error message if failed
- `created_at`: TIMESTAMP NOT NULL DEFAULT now()

Indexes:
- INDEX on (bridge_event_id, attempt)
- INDEX on (direction, created_at DESC)

#### Scenario: Delivery record created on webhook receipt
- **WHEN** Cherry API receives an inbound webhook
- **THEN** a webhook_deliveries record is created with direction='inbound', attempt=1, and status_code

#### Scenario: Cascade delete on event removal
- **WHEN** a bridge_event record is deleted
- **THEN** all associated webhook_deliveries records are also deleted

### Requirement: page_block_metadata table definition

The system SHALL define a `page_block_metadata` table in Drizzle ORM to support Stage 10 block ownership tracking. The table is created in Stage 9 (schema only); merge logic is implemented in Stage 10.

Columns:
- `id`: UUID primary key (default gen_random_uuid())
- `page_id`: UUID NOT NULL FK → wiki_pages.id ON DELETE CASCADE
- `section_id`: VARCHAR(128) NOT NULL — matches graphify:managed marker section ID
- `owner`: VARCHAR(20) NOT NULL DEFAULT 'graphify' — 'graphify' | 'human' | 'locked'
- `last_modified_by`: UUID — user ID who last modified this block (nullable for graphify-owned)
- `last_modified_at`: TIMESTAMP
- `graphify_run_id`: UUID — which Graphify run produced this block (nullable for human-owned)
- `created_at`: TIMESTAMP NOT NULL DEFAULT now()
- `updated_at`: TIMESTAMP NOT NULL DEFAULT now()

Indexes:
- UNIQUE on (page_id, section_id)
- INDEX on (page_id, owner)

#### Scenario: Schema created for Stage 10 consumption
- **WHEN** migration runs
- **THEN** page_block_metadata table exists with all columns and indexes, ready for Stage 10 to write data

#### Scenario: Unique constraint per page section
- **WHEN** two INSERT statements with the same (page_id, section_id) execute
- **THEN** the second INSERT fails with unique violation

### Requirement: bridge_nonces Redis key pattern

The system SHALL use Redis SETNX with key pattern `bridge:nonce:{nonce_value}` and TTL=600s (10 minutes) for nonce deduplication. This is NOT a database table but a Redis-based transient store.

#### Scenario: Fresh nonce stored in Redis
- **WHEN** a new nonce arrives and SETNX succeeds
- **THEN** the nonce is stored with 600s TTL and request proceeds

#### Scenario: Duplicate nonce detected via Redis
- **WHEN** SETNX fails (key already exists)
- **THEN** request is rejected with BRIDGE_NONCE_REUSED

### Requirement: Zod validation schemas

The system SHALL define Zod schemas for:
- `bridgeEventSchema`: validates bridge_events insert/select shapes
- `webhookDeliverySchema`: validates webhook_deliveries insert/select shapes
- `pageBlockMetadataSchema`: validates page_block_metadata insert/select shapes
- `bridgeWebhookPayloadSchema`: validates inbound webhook request body (event_id, event_type, timestamp, nonce, space_id, page_id, plus type-specific fields)
- `bridgeEventStatusSchema`: enum of valid status values ('received', 'processing', 'processed', 'failed')
- `bridgeEventTypeSchema`: enum of valid event types ('page.saved', 'page.deleted', 'attachment.created', 'attachment.deleted', 'space.updated')
- `blockOwnerSchema`: enum of valid owner values ('graphify', 'human', 'locked')

#### Scenario: Valid webhook payload passes validation
- **WHEN** a well-formed page.saved payload is validated against bridgeWebhookPayloadSchema
- **THEN** validation succeeds and returns typed object

#### Scenario: Invalid payload rejected
- **WHEN** a payload missing required event_id field is validated
- **THEN** Zod throws ZodError with path pointing to missing field

#### Scenario: Invalid event_type rejected
- **WHEN** a payload with event_type="unknown.event" is validated
- **THEN** Zod throws ZodError for invalid enum value
