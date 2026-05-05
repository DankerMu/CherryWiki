## ADDED Requirements

### Requirement: Contract test suite for Bridge API

The system SHALL maintain a contract test suite using NestJS Testing Module + supertest that validates all Bridge API behaviors. These tests SHALL run in CI on every push to the cherrygraph-bridge branch and MUST pass before updating the submodule reference.

#### Scenario: All contract tests pass on fresh build
- **WHEN** `pnpm test:bridge` runs in the Docmost Fork CI
- **THEN** all contract test scenarios pass (exit code 0)

### Requirement: Page export contract test

The test suite SHALL verify page export API behavior.

#### Scenario: Export returns Markdown with hash
- **WHEN** test calls GET /api/internal/bridge/pages/{docmost_page_id}/export?format=markdown
- **THEN** response contains content (string), content_hash (hex SHA256), title, space_id, updated_at

#### Scenario: Export 404 for missing page
- **WHEN** test calls export with non-existent page ID
- **THEN** response is 404 with BRIDGE_PAGE_NOT_FOUND error code

#### Scenario: Export preserves graphify managed markers (P2-E3)
- **WHEN** test exports a page containing `<!-- graphify:managed:section_abc -->` HTML comments
- **THEN** response content includes the comment verbatim in correct position

### Requirement: Page import contract test

The test suite SHALL verify page import API behavior.

#### Scenario: Import creates page (create_only)
- **WHEN** test calls PUT /api/internal/bridge/pages/{new_id}/import with overwrite_policy=create_only
- **THEN** response is 201 and subsequent export returns the imported content

#### Scenario: Import conflict on hash mismatch
- **WHEN** test calls PUT with overwrite_policy=update and stale expected_hash
- **THEN** response is 409 with BRIDGE_HASH_CONFLICT and current_hash in body

#### Scenario: Import preserves graphify managed markers (P2-E3)
- **WHEN** test imports Markdown containing `<!-- graphify:managed:* -->` then exports
- **THEN** the markers survive the round-trip (export content matches import on marker positions)

### Requirement: HMAC authentication contract tests

The test suite SHALL verify authentication edge cases.

#### Scenario: Valid signature passes
- **WHEN** test sends request with correctly computed HMAC signature (including nonce) and fresh timestamp
- **THEN** response status is not 401

#### Scenario: Wrong signature rejected
- **WHEN** test sends request with tampered HMAC signature
- **THEN** response is 401 with BRIDGE_HMAC_INVALID

#### Scenario: Missing Bearer rejected
- **WHEN** test sends request without Authorization header
- **THEN** response is 401 with BRIDGE_AUTH_MISSING

#### Scenario: Timestamp replay rejected
- **WHEN** test sends request with X-Bridge-Timestamp set to 6 minutes ago
- **THEN** response is 401 with BRIDGE_TIMESTAMP_EXPIRED

#### Scenario: Nonce replay rejected
- **WHEN** test sends two requests with the same X-Bridge-Nonce value
- **THEN** second request returns 401 with BRIDGE_NONCE_REUSED

#### Scenario: Dual-key rotation accepted
- **WHEN** DOCMOST_BRIDGE_SECRET_NEXT is configured AND test signs with next key
- **THEN** response status is not 401

### Requirement: Webhook event delivery contract test

The test suite SHALL verify that page save/delete/attachment events trigger correct webhook calls using a mock Cherry API HTTP server.

#### Scenario: Page save event delivered to mock
- **WHEN** test triggers a page save through Docmost's PageService
- **THEN** mock Cherry API server receives POST /api/internal/docmost/events/page-saved with valid HMAC (including nonce) and correct payload schema

#### Scenario: Page delete event delivered to mock
- **WHEN** test triggers a page delete
- **THEN** mock receives POST /api/internal/docmost/events/page-deleted with page_id and event_id

#### Scenario: Attachment created event contains download_url
- **WHEN** test triggers an attachment upload
- **THEN** mock receives POST /api/internal/docmost/events/attachment-created with download_url matching /api/internal/bridge/attachments/{id}/download

#### Scenario: Attachment deleted event delivered
- **WHEN** test triggers an attachment deletion
- **THEN** mock receives POST /api/internal/docmost/events/attachment-deleted with attachment_id

#### Scenario: Space updated event delivered
- **WHEN** test triggers a space property change
- **THEN** mock receives POST /api/internal/docmost/events/space-updated with change_type

#### Scenario: Webhook retry on 503
- **WHEN** mock Cherry API returns 503 on first call then 200 on second
- **THEN** the event is delivered successfully on retry (mock receives exactly 2 calls)

#### Scenario: Rapid saves debounced (P2-E10)
- **WHEN** test saves the same page twice within 1 second
- **THEN** mock receives only one page-saved event (the latest)

### Requirement: Sync status and health contract test

The test suite SHALL verify sync status and health endpoints.

#### Scenario: Health endpoint returns status
- **WHEN** test calls GET /api/internal/bridge/health
- **THEN** response contains status, version, uptime_seconds, cherry_api_reachable fields

#### Scenario: Sync status for known space
- **WHEN** test calls GET /api/internal/bridge/spaces/{known_space_id}/sync-status
- **THEN** response contains status, page_count, last_event_at, pending_events fields

#### Scenario: Sync status 404 for unknown space
- **WHEN** test calls sync-status with non-existent space ID
- **THEN** response is 404 with BRIDGE_SPACE_NOT_FOUND

### Requirement: Permission endpoint contract test

The test suite SHALL verify the permission projection endpoint.

#### Scenario: Permission update accepted
- **WHEN** test calls PUT /api/internal/bridge/spaces/{id}/permissions with valid payload
- **THEN** response is 200 with accepted=true

#### Scenario: Permission update 404 for unknown space
- **WHEN** test calls permission update for non-existent space
- **THEN** response is 404 with BRIDGE_SPACE_NOT_FOUND

### Requirement: Idempotency contract test

The test suite SHALL verify webhook idempotency behavior on the Cherry API receiver side.

#### Scenario: Duplicate event_id returns deduplicated
- **WHEN** test sends the same event_id twice to Cherry API mock receiver
- **THEN** first response has deduplicated=false, second response has deduplicated=true, and only one record exists

### Requirement: Rebase CI integration

The contract test suite SHALL be configured to run automatically on every push to the cherrygraph-bridge branch via GitHub Actions. The workflow SHALL:
1. Build Docmost from source
2. Start test database + Redis (for nonce dedup)
3. Start mock Cherry API server
4. Run full contract test suite (HMAC + export/import + webhooks + idempotency + permissions)
5. Report pass/fail status on the commit

#### Scenario: CI blocks broken rebase
- **WHEN** an upstream rebase breaks a Bridge controller
- **THEN** CI fails and the PR/push is marked as failing, preventing submodule update
