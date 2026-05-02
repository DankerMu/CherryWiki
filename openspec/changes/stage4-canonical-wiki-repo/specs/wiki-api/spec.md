## ADDED Requirements

### Requirement: List wiki pages endpoint
The API SHALL expose `GET /api/spaces/{space_id}/wiki/pages` that returns a paginated list of wiki pages for the given space. Requires `space:view` permission.

#### Scenario: List pages with default pagination
- **WHEN** authenticated user with `space:view` sends GET to `/api/spaces/{space_id}/wiki/pages`
- **THEN** response SHALL return `{ data: WikiPage[], meta: { pagination } }` with status 200. WikiPage fields per openapi.yaml: page_id, space_id, title, status, source, current_version_id, indexed_version_id, sync_status, docmost_page_id, tags, citations_count, related_nodes_count, updated_at

#### Scenario: Filter pages by status
- **WHEN** query parameter `status=published` is provided
- **THEN** only pages with status `published` SHALL be returned

#### Scenario: Search pages by title
- **WHEN** query parameter `search=database` is provided
- **THEN** pages with title matching the search term SHALL be returned (case-insensitive partial match)

#### Scenario: No permission
- **WHEN** user without `space:view` permission sends the request
- **THEN** response SHALL return 403 PERMISSION_DENIED

#### Scenario: Cross-space isolation
- **WHEN** user has `space:view` on Space A but not Space B
- **THEN** requesting pages from Space B SHALL return 403, not an empty list

### Requirement: Get wiki page endpoint
The API SHALL expose `GET /api/spaces/{space_id}/wiki/pages/{page_id}` that returns a single wiki page with its metadata. Requires `space:view` permission.

#### Scenario: Get existing page
- **WHEN** page exists in the space
- **THEN** response SHALL return `{ data: WikiPage }` with status 200, fields matching openapi.yaml WikiPage schema

#### Scenario: Page not found
- **WHEN** page_id does not exist
- **THEN** response SHALL return 404 with error code `WIKI_PAGE_NOT_FOUND`

### Requirement: Get wiki page content endpoint
The API SHALL expose `GET /api/spaces/{space_id}/wiki/pages/{page_id}/content` that returns the markdown content of a wiki page version. Requires `space:view` permission. Response SHALL match openapi.yaml WikiPageContent schema: page_id, version_id, title, content_markdown, content_hash, blocks[].

#### Scenario: Get current version content
- **WHEN** no version_id query parameter is provided
- **THEN** response SHALL return the content of the `current_version_id` version

#### Scenario: Get specific version content
- **WHEN** `version_id` query parameter is provided
- **THEN** response SHALL return the content of that specific version

#### Scenario: Version not found
- **WHEN** specified version_id does not exist for this page
- **THEN** response SHALL return 404 with error code `VERSION_NOT_FOUND`

#### Scenario: Content response matches OpenAPI WikiPageContent schema
- **WHEN** page content is returned
- **THEN** response `data` SHALL match openapi.yaml `WikiPageContent` schema exactly: page_id, version_id, title, content_markdown, content_hash, blocks[{block_id, owner, editable}]. No `source_links` field in this response (source_links are queried separately via wiki-core internal API)

### Requirement: List page versions endpoint
The API SHALL expose `GET /api/spaces/{space_id}/wiki/pages/{page_id}/versions` that returns a paginated list of all versions for a page. Requires `space:view` permission. Each version SHALL match openapi.yaml WikiPageVersion schema: version_id, content_hash, author, source_run_id, status (current/archived), created_at.

#### Scenario: List versions
- **WHEN** request is made for a page with 3 versions
- **THEN** response SHALL return all 3 versions ordered by created_at descending

### Requirement: Publish wiki page endpoint
The API SHALL expose `POST /api/spaces/{space_id}/wiki/pages/{page_id}/publish` that publishes a specific version. Requires `wiki:publish` permission. SHALL write `wiki.page.publish` audit event.

#### Scenario: Publish a draft version
- **WHEN** request body contains `{ version_id: "v1" }` and version v1 has status `draft`
- **THEN** version status SHALL become `published`, page's `current_version_id` SHALL be updated, response SHALL return 200 with page_id, version_id, status, published_at (derived from audit timestamp), published_by

#### Scenario: Publish already published version
- **WHEN** version already has status `published`
- **THEN** response SHALL return 409 with error code `VERSION_ALREADY_PUBLISHED`

#### Scenario: Publish with idempotency key
- **WHEN** same `X-Idempotency-Key` is sent twice
- **THEN** second request SHALL return the same response without side effects

#### Scenario: Insufficient permission
- **WHEN** user lacks `wiki:publish` permission
- **THEN** response SHALL return 403 PERMISSION_DENIED

### Requirement: Rollback wiki page endpoint
The API SHALL expose `POST /api/spaces/{space_id}/wiki/pages/{page_id}/rollback` that creates a new version from a target version and publishes it. Requires `wiki:rollback` permission. SHALL write `wiki.page.rollback` audit event.

#### Scenario: Rollback to previous version
- **WHEN** request body contains `{ target_version_id: "v2" }` and current version is v3
- **THEN** a new version v4 SHALL be created with content copied from v2, source='rollback', status='published'. Page's current_version_id SHALL be updated to v4.

#### Scenario: Rollback target not found
- **WHEN** target_version_id does not exist
- **THEN** response SHALL return 404 with error code `VERSION_NOT_FOUND`

#### Scenario: Rollback with idempotency key
- **WHEN** same `X-Idempotency-Key` is sent twice for rollback
- **THEN** second request SHALL return the same response without side effects

### Requirement: Wiki API audit events
All mutating wiki endpoints SHALL write audit events to `audit_logs` with action names matching Doc 11 conventions.

#### Scenario: Publish writes audit
- **WHEN** a page version is published
- **THEN** an audit log entry SHALL be created with action=`wiki.page.publish`, resource_type='wiki_page', resource_id=page_id, space_id, and metadata containing version_id and publish_note

#### Scenario: Rollback writes audit
- **WHEN** a page is rolled back
- **THEN** an audit log entry SHALL be created with action=`wiki.page.rollback`, resource_type='wiki_page', resource_id=page_id, and metadata containing target_version_id and new_version_id

### Requirement: Wiki permission isolation
All wiki endpoints SHALL enforce Space-level permission isolation. Users SHALL only access wiki pages within spaces they have permission to view.

#### Scenario: Cross-space page access denied
- **WHEN** user requests a page from a space they have no permission for
- **THEN** response SHALL return 403 PERMISSION_DENIED

#### Scenario: Cross-space version listing denied
- **WHEN** user requests versions of a page in an unauthorized space
- **THEN** response SHALL return 403 PERMISSION_DENIED

#### Scenario: Cross-space content access denied
- **WHEN** user requests content of a page in an unauthorized space
- **THEN** response SHALL return 403 PERMISSION_DENIED
