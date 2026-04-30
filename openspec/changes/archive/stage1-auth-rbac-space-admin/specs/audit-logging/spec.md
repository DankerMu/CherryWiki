## ADDED Requirements

### Requirement: Structured audit log entries
The system SHALL write structured audit log entries for all critical operations. Each entry MUST contain: audit_id, tenant_id, actor_user_id, action, resource_type, resource_id, space_id (if applicable), ip, user_agent, request_id, metadata_json, created_at.

#### Scenario: Auth event logged
- **WHEN** user logs in successfully
- **THEN** audit_logs contains entry with action=`auth.login`, actor_user_id=user's id, ip=client IP, request_id=current request ID

#### Scenario: Permission change logged
- **WHEN** admin adds a Group to a Space
- **THEN** audit_logs contains entry with action=`space.permission_change`, resource_type=`space`, resource_id=space_id, metadata_json containing old/new permission details

### Requirement: Mandatory audit events
The system SHALL audit the following events: auth.login, auth.logout, auth.token_refresh, auth.failed_login, auth.password_change, auth.session_revoke, admin.user.create, admin.user.disable, admin.group.create, space.create, space.update, space.permission_change, admin.model.create, admin.model.update, admin.model.test, admin.config.change.

#### Scenario: Failed login audited
- **WHEN** a login attempt fails
- **THEN** audit_logs contains entry with action=`auth.failed_login`, metadata_json containing email attempted (but NOT the password)

#### Scenario: Model change audited
- **WHEN** admin creates a model configuration
- **THEN** audit_logs contains entry with action=`admin.model.create`, resource_type=`model_config`, resource_id=model_id

#### Scenario: Token refresh audited
- **WHEN** user refreshes an access_token
- **THEN** audit_logs contains entry with action=`auth.token_refresh`, actor_user_id=user's id

#### Scenario: User group change audited
- **WHEN** admin adds or removes a user from a Group
- **THEN** audit_logs contains entry with action=`user.group_change`, resource_type=`group`, metadata_json containing user_id and group_id

#### Scenario: Space permission change audited
- **WHEN** admin grants or revokes a Group's permission on a Space
- **THEN** audit_logs contains entry with action=`space.permission_change`, resource_type=`space`, resource_id=space_id, metadata_json containing group_id and old/new permissions

#### Scenario: Model test audited
- **WHEN** admin runs a model connectivity test
- **THEN** audit_logs contains entry with action=`admin.model.test`, resource_type=`model_config`, resource_id=model_id

#### Scenario: User disable audited
- **WHEN** admin disables a user
- **THEN** audit_logs contains entry with action=`admin.user.disable`, resource_type=`user`, resource_id=user_id

### Requirement: Query audit logs (Admin)
The system SHALL allow users with `admin:audit_view` permission to query audit logs with filtering by actor, action, space, time range, and pagination.

#### Scenario: Filter by action and time range
- **WHEN** admin GETs `/api/admin/audit-logs?action=auth.login&from=2026-04-01&to=2026-04-28&sort=-created_at`
- **THEN** system returns paginated audit entries matching the filter, sorted newest first

#### Scenario: Filter by space
- **WHEN** admin GETs `/api/admin/audit-logs?space_id=space_rd`
- **THEN** system returns only audit entries related to that space

### Requirement: Async non-blocking audit writes
The system SHALL write audit logs asynchronously to avoid impacting API response latency. Audit writes MUST NOT block the request-response cycle.

#### Scenario: Audit write does not affect response time
- **WHEN** an audited API call is made
- **THEN** the API response is returned before the audit log entry is persisted
- **THEN** the audit entry appears in the database within 2 seconds

### Requirement: No sensitive data in audit logs
Audit logs MUST NOT contain passwords, API keys, access tokens, or refresh tokens. Email addresses and user IDs are permitted.

#### Scenario: Failed login audit sanitized
- **WHEN** a failed login attempt is audited
- **THEN** the audit entry contains the attempted email but NOT the attempted password

#### Scenario: Model config audit sanitized
- **WHEN** a model config change is audited
- **THEN** the audit entry references encrypted_api_key_ref but NOT the actual API key value

### Requirement: Request ID correlation
Every audit log entry SHALL include the `request_id` from the originating HTTP request, enabling correlation between audit events and access logs.

#### Scenario: Correlated audit entry
- **WHEN** a request with request_id "req_abc123" triggers a space creation
- **THEN** the audit log entry has request_id="req_abc123"
