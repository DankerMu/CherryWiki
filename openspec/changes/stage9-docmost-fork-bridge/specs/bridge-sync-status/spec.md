## ADDED Requirements

### Requirement: Space sync status query

The system SHALL expose GET /api/internal/bridge/spaces/{docmost_space_id}/sync-status that returns the current synchronization health of a Docmost space.

Response SHALL include:
- `space_id`: Docmost space ID
- `status`: One of `healthy` | `degraded` | `error` | `not_configured`
- `page_count`: Total pages in the space
- `last_event_at`: Timestamp of last webhook event sent for this space (nullable)
- `last_import_at`: Timestamp of last successful page import (nullable)
- `pending_events`: Count of events that failed delivery (tracked via in-memory counter, reset on Bridge restart)

#### Scenario: Healthy space status
- **WHEN** Cherry API queries sync status for a space with no pending failures
- **THEN** response is 200 with status=healthy and accurate counts

#### Scenario: Degraded status on pending events
- **WHEN** a space has > 0 events that failed delivery and are pending retry
- **THEN** response shows status=degraded with pending_events count

#### Scenario: Unknown space
- **WHEN** Cherry API queries sync status for a non-existent space ID
- **THEN** response is 404 with error code BRIDGE_SPACE_NOT_FOUND

### Requirement: Bridge health endpoint

The system SHALL expose GET /api/internal/bridge/health that returns the overall Bridge module health.

Response SHALL include:
- `status`: `healthy` | `unhealthy`
- `version`: Bridge module version string
- `uptime_seconds`: Time since module initialization
- `cherry_api_reachable`: Boolean indicating if Cherry API internal URL is reachable (last check within 60s)

#### Scenario: Bridge healthy
- **WHEN** Bridge module is running and Cherry API is reachable
- **THEN** response is 200 with status=healthy and cherry_api_reachable=true

#### Scenario: Bridge unhealthy (Cherry API unreachable)
- **WHEN** Bridge module is running but Cherry API internal URL is not reachable
- **THEN** response is 200 with status=unhealthy and cherry_api_reachable=false

### Requirement: Attachment download proxy

The system SHALL expose GET /api/internal/bridge/attachments/{attachment_id}/download that streams the attachment binary content for Cherry API to pull.

#### Scenario: Download attachment
- **WHEN** Cherry API requests GET /api/internal/bridge/attachments/{attachment_id}/download with valid auth
- **THEN** response streams the attachment file with correct Content-Type and Content-Disposition headers

#### Scenario: Attachment not found
- **WHEN** Cherry API requests download for non-existent attachment ID
- **THEN** response is 404 with error code BRIDGE_ATTACHMENT_NOT_FOUND

### Requirement: Permission projection endpoint

The system SHALL expose PUT /api/internal/bridge/spaces/{docmost_space_id}/permissions that receives permission updates from Cherry API and applies them to the Docmost space member visibility.

Request body SHALL include:
- `groups`: Array of `{group_id, permissions: ["view"|"edit"|"admin"]}` 
- `version`: permission_version from Cherry (for consistency tracking)
- `source`: "cherry_api"

This endpoint enables Cherry API (the sole permission authority) to push permission state to Docmost. The implementation of reconciliation logic is in Stage 10; this Stage provides the receiving endpoint only.

#### Scenario: Permission update accepted
- **WHEN** Cherry API sends PUT with valid auth and well-formed permission payload
- **THEN** response is 200 with `{accepted: true, version: <received_version>}`, Docmost space membership is updated

#### Scenario: Invalid permission payload rejected
- **WHEN** Cherry API sends PUT with malformed groups array
- **THEN** response is 400 with error code BRIDGE_INVALID_PAYLOAD

#### Scenario: Space not found for permissions
- **WHEN** Cherry API sends PUT to a non-existent Docmost space ID
- **THEN** response is 404 with error code BRIDGE_SPACE_NOT_FOUND
