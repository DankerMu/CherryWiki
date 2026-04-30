## ADDED Requirements

### Requirement: List spaces (permission-filtered)
The system SHALL return only Spaces the authenticated user has `space:view` permission for.

#### Scenario: User sees only permitted spaces
- **WHEN** user with access to Space A and Space B GETs `/api/spaces`
- **THEN** response contains only Space A and Space B, not Space C which user has no permission for

#### Scenario: Filter and search
- **WHEN** user GETs `/api/spaces?status=active&search=研发`
- **THEN** response contains only spaces matching the filter among those the user has access to

### Requirement: Create space
The system SHALL allow users with `space:admin` or Admin role to create new spaces.

#### Scenario: Successful space creation
- **WHEN** admin POSTs to `/api/spaces` with name, slug, and description
- **THEN** system creates the space with wiki_repo_path auto-generated, strict_knowledge_only=true (default), permission_version=1
- **THEN** system records `space.create` audit event

#### Scenario: Slug conflict
- **WHEN** admin POSTs with a slug that already exists for the tenant
- **THEN** system returns `409` with error code `SPACE_SLUG_CONFLICT`

#### Scenario: Idempotent creation
- **WHEN** admin POSTs with the same `X-Idempotency-Key` twice
- **THEN** the second request returns `200` with the same space object

### Requirement: Get space details
The system SHALL return detailed space information including configuration and stats placeholders.

#### Scenario: Get space by ID
- **WHEN** user with `space:view` GETs `/api/spaces/{space_id}`
- **THEN** system returns space with id, name, slug, description, status, wiki_repo_path, index_consistency_status, strict_knowledge_only, graphify_config, stats (page_count=0, source_count=0 for Stage 1), timestamps

#### Scenario: Space not found
- **WHEN** user GETs `/api/spaces/{nonexistent_id}`
- **THEN** system returns `404` with error code `SPACE_NOT_FOUND`

#### Scenario: No permission
- **WHEN** user without `space:view` on the Space GETs `/api/spaces/{space_id}`
- **THEN** system returns `404` (not `403`, to avoid leaking Space existence)

### Requirement: Update space
The system SHALL allow users with `space:admin` to update space name, description, config fields.

#### Scenario: Update space config
- **WHEN** space admin PATCHes `/api/spaces/{space_id}` with `{ "strict_knowledge_only": false }`
- **THEN** system updates the field and records `space.update` audit event

#### Scenario: Update slug with conflict
- **WHEN** admin PATCHes with a slug that conflicts with another space
- **THEN** system returns `409` with error code `SPACE_SLUG_CONFLICT`

### Requirement: Space strict_knowledge_only configuration
Each Space SHALL have a `strict_knowledge_only` boolean defaulting to `true`. This controls Chat behavior when no Wiki content matches (enforced in Stage 7).

#### Scenario: Default configuration
- **WHEN** a new Space is created without specifying strict_knowledge_only
- **THEN** strict_knowledge_only defaults to `true`

#### Scenario: Admin can toggle
- **WHEN** space admin PATCHes the Space with `strict_knowledge_only: false`
- **THEN** the setting is persisted and returned in subsequent GET requests

### Requirement: Space wiki_repo_path auto-generation
The system SHALL auto-generate wiki_repo_path as `/data/wiki/{space_id}` on Space creation. This field MUST NOT be user-modifiable via API.

#### Scenario: Auto-generated path
- **WHEN** a Space is created with id "space_rd"
- **THEN** wiki_repo_path is set to `/data/wiki/space_rd`

#### Scenario: wiki_repo_path not modifiable
- **WHEN** admin PATCHes Space with `{ "wiki_repo_path": "/custom/path" }`
- **THEN** the field is ignored and wiki_repo_path remains unchanged

### Requirement: Space statistics endpoint
The system SHALL provide GET `/api/spaces/{space_id}/stats` returning space statistics. In Stage 1, counters return 0 as placeholders for later stages.

#### Scenario: Get space stats
- **WHEN** user with `space:view` GETs `/api/spaces/{space_id}/stats`
- **THEN** system returns space_id, page_count (0), source_count (0), node_count (0), edge_count (0), index_consistency status

### Requirement: System health endpoint
The system SHALL provide GET `/api/admin/system/health` reporting health of all infrastructure components. Stage 1 checks: database, Redis, object storage (MinIO). Components not yet deployed (vector_store, graph_store, docmost_bridge) SHALL return status "not_configured".

#### Scenario: All components healthy
- **WHEN** admin GETs `/api/admin/system/health` and all services are running
- **THEN** system returns status="healthy", each component with status and latency_ms
- **THEN** not-yet-deployed components return status="not_configured"

#### Scenario: Component unhealthy
- **WHEN** Redis is unreachable
- **THEN** system returns overall status="degraded", redis component status="unhealthy" with error message
