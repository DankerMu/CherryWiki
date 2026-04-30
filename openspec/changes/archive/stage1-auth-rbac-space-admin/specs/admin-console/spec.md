## ADDED Requirements

### Requirement: Admin route protection
The Admin Console pages SHALL be accessible only to users with Admin or Owner role. The frontend SHALL hide admin navigation for non-admin users. The backend SHALL enforce permission checks on all admin API endpoints independently.

#### Scenario: Admin user sees admin nav
- **WHEN** a user with Admin role logs in
- **THEN** the sidebar/navigation shows Admin Console links (Users, Groups, Spaces, Models, Audit Logs, System Health)

#### Scenario: Non-admin user cannot see admin nav
- **WHEN** a user with Viewer role logs in
- **THEN** the sidebar/navigation does NOT show Admin Console links
- **THEN** navigating directly to `/admin/*` routes shows an access denied page

### Requirement: User management page
The Admin Console SHALL provide a page to list, search, filter, and create users. The page SHALL display user email, name, role, status, groups, and last login time.

#### Scenario: List and search users
- **WHEN** admin navigates to the Users page
- **THEN** a paginated table of users is displayed with search and role/status filters

#### Scenario: Create user form
- **WHEN** admin clicks "Create User"
- **THEN** a form appears with fields: email, name, role (select), groups (multi-select)
- **THEN** on submit, the user is created via POST `/api/admin/users`

### Requirement: Group management page
The Admin Console SHALL provide a page to list, create, and manage groups including member assignment and space permission mapping.

#### Scenario: View group with members and spaces
- **WHEN** admin views a group detail
- **THEN** the page shows group name, member list, and space permission assignments

#### Scenario: Create group with permissions
- **WHEN** admin creates a group with members and space permissions
- **THEN** the group is created via POST `/api/admin/groups`
- **THEN** the page refreshes to show the new group

### Requirement: Space management page
The Admin Console SHALL provide a page to list, create, and configure spaces including strict_knowledge_only toggle and graphify_config.

#### Scenario: Create space
- **WHEN** admin fills out the create space form with name, slug, description
- **THEN** space is created via POST `/api/spaces`

#### Scenario: Toggle strict_knowledge_only
- **WHEN** admin toggles strict_knowledge_only on a space detail page
- **THEN** space is updated via PATCH `/api/spaces/{space_id}`

### Requirement: Model management page
The Admin Console SHALL provide a page to list, create, update, and test model configurations.

#### Scenario: Add model
- **WHEN** admin fills out the add model form with provider, model_id, model_type, display_name, base_url, api_key_ref
- **THEN** model is created via POST `/api/admin/models`

#### Scenario: Test model connectivity
- **WHEN** admin clicks "Test" on a model row
- **THEN** system calls POST `/api/admin/models/{model_id}/test`
- **THEN** result (reachable/unreachable, latency) is displayed

### Requirement: Audit log viewer page
The Admin Console SHALL provide a page to browse audit logs with filters for actor, action, space, and time range.

#### Scenario: Browse audit logs
- **WHEN** admin navigates to Audit Logs page
- **THEN** a paginated table shows recent audit entries with timestamp, actor, action, resource, space

#### Scenario: Filter audit logs
- **WHEN** admin selects action filter "auth.login" and date range
- **THEN** the table updates to show only matching entries

### Requirement: System health page
The Admin Console SHALL provide a page showing system component health status (database, Redis, object storage).

#### Scenario: View system health
- **WHEN** admin navigates to System Health page
- **THEN** page displays component status from GET `/api/admin/system/health`
- **THEN** each component shows status (healthy/unhealthy) and latency

### Requirement: Login page
The system SHALL provide a login page at `/login` with email and password fields.

#### Scenario: Successful login redirect
- **WHEN** user enters valid credentials on the login page
- **THEN** user is redirected to the home page
- **THEN** access_token is stored for subsequent API calls

#### Scenario: Login error display
- **WHEN** user enters invalid credentials
- **THEN** an error message is displayed (e.g., "邮箱或密码错误")
- **THEN** no sensitive information is exposed in the error
