## ADDED Requirements

### Requirement: Wiki page list view
Cherry Web SHALL display a paginated list of wiki pages within a space at route `/spaces/:spaceId/wiki`. The list SHALL show page title, status badge (draft/published/archived), last updated time, and created_by.

#### Scenario: View page list
- **WHEN** user navigates to `/spaces/:spaceId/wiki`
- **THEN** a list of wiki pages SHALL be displayed with pagination, sorted by updated_at descending

#### Scenario: Filter by status
- **WHEN** user selects a status filter (draft/published/archived)
- **THEN** the list SHALL show only pages matching the selected status

#### Scenario: Search pages
- **WHEN** user enters text in the search field
- **THEN** the list SHALL filter to pages whose title matches the search term

#### Scenario: Empty state
- **WHEN** space has no wiki pages
- **THEN** an empty state message SHALL be shown indicating no pages exist yet

### Requirement: Wiki page detail view
Cherry Web SHALL display a single wiki page with rendered Markdown content at route `/spaces/:spaceId/wiki/:pageId`.

#### Scenario: View published page
- **WHEN** user navigates to a published wiki page
- **THEN** the page title, status, last updated time, and rendered Markdown content SHALL be displayed

#### Scenario: Markdown rendering
- **WHEN** page content contains GFM features (tables, task lists, code blocks)
- **THEN** they SHALL be rendered correctly with syntax highlighting for code blocks

#### Scenario: Page not found
- **WHEN** user navigates to a non-existent page_id
- **THEN** a 404 page SHALL be displayed

### Requirement: Wiki version history view
Cherry Web SHALL display version history for a wiki page at route `/spaces/:spaceId/wiki/:pageId/history`.

#### Scenario: View version list
- **WHEN** user navigates to version history
- **THEN** a list of all versions SHALL be shown with version_no, source (manual/graphify/rollback), status, created_by, created_at

#### Scenario: View specific version content
- **WHEN** user clicks on a version entry
- **THEN** the content of that specific version SHALL be displayed (read-only)

### Requirement: Wiki navigation integration
The Space detail layout SHALL include a "Wiki" navigation entry in the sidebar.

#### Scenario: Navigate to wiki from space
- **WHEN** user is viewing a space
- **THEN** the sidebar SHALL include a "Wiki" link that navigates to `/spaces/:spaceId/wiki`

#### Scenario: Active state
- **WHEN** user is on any wiki route
- **THEN** the "Wiki" sidebar link SHALL be visually highlighted as active

### Requirement: Wiki publish/rollback actions (permission-gated)
The wiki page detail view SHALL display publish and rollback action buttons for users with the corresponding `wiki:publish` or `wiki:rollback` permissions (not tied to role name).

#### Scenario: Publish button for draft page
- **WHEN** user with `wiki:publish` permission views a page with unpublished draft version
- **THEN** a "Publish" button SHALL be visible and functional

#### Scenario: Rollback button for published page
- **WHEN** user with `wiki:rollback` permission views a published page with more than one version
- **THEN** a "Rollback" option SHALL be available in version history, allowing selection of a target version

#### Scenario: No action buttons without permission
- **WHEN** user lacks `wiki:publish` and `wiki:rollback` permissions
- **THEN** publish and rollback buttons SHALL NOT be displayed
