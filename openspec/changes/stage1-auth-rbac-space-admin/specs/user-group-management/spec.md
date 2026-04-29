## ADDED Requirements

### Requirement: List users (Admin)
The system SHALL allow users with `admin:user_manage` permission to list all users with filtering and pagination.

#### Scenario: List users with filter
- **WHEN** admin GETs `/api/admin/users?role=editor&status=active&search=alice`
- **THEN** system returns paginated list of users matching filters, each with id, email, name, role, status, groups, last_login_at, created_at

#### Scenario: Non-admin access denied
- **WHEN** a user without `admin:user_manage` GETs `/api/admin/users`
- **THEN** system returns `403 PERMISSION_DENIED`

### Requirement: Create user (Admin)
The system SHALL allow admins to create new users with email, name, role, and optional group assignments.

#### Scenario: Successful user creation
- **WHEN** admin POSTs to `/api/admin/users` with valid email, name, role, and groups
- **THEN** system creates the user with status "invited" (or "active" if no invite flow)
- **THEN** system records `admin.user.create` audit event
- **THEN** system returns the created user object

#### Scenario: Duplicate email
- **WHEN** admin POSTs with an email that already exists for the tenant
- **THEN** system returns `409` with error code `USER_EMAIL_CONFLICT`

#### Scenario: Invalid group reference
- **WHEN** admin POSTs with a group_id that does not exist
- **THEN** system returns `422` with error code `GROUP_NOT_FOUND`

#### Scenario: Idempotent creation
- **WHEN** admin POSTs with the same `X-Idempotency-Key` twice
- **THEN** the second request returns `200` with the same user object, no duplicate created

### Requirement: List groups (Admin)
The system SHALL allow admins to list all groups with member counts and associated spaces.

#### Scenario: List groups
- **WHEN** admin GETs `/api/admin/groups`
- **THEN** system returns paginated list of groups, each with id, name, member_count, spaces (with permissions), created_at

### Requirement: Create group (Admin)
The system SHALL allow admins to create groups with members and space permissions.

#### Scenario: Successful group creation
- **WHEN** admin POSTs to `/api/admin/groups` with name, member_ids, and space_permissions
- **THEN** system creates the group, adds members, assigns space permissions
- **THEN** system increments permission_version for affected spaces
- **THEN** system records `admin.group.create` audit event

#### Scenario: Duplicate group name
- **WHEN** admin POSTs with a group name that already exists for the tenant
- **THEN** system returns `409` with error code `GROUP_NAME_CONFLICT`

### Requirement: Tenant-scoped user uniqueness
Users SHALL be unique by (tenant_id, email). The system MUST NOT allow two users with the same email in the same tenant.

#### Scenario: Cross-tenant email reuse
- **WHEN** tenant A has user alice@example.com and tenant B creates user alice@example.com
- **THEN** both creations succeed (different tenants)

### Requirement: Update user (Admin)
The system SHALL allow admins to update user profile (display_name, role) and status via PATCH `/api/admin/users/{user_id}`.

#### Scenario: Update user role
- **WHEN** admin PATCHes `/api/admin/users/{user_id}` with `{ "role": "editor" }`
- **THEN** system updates the user's role
- **THEN** system records `admin.user.update` audit event

#### Scenario: User not found
- **WHEN** admin PATCHes `/api/admin/users/{nonexistent_id}`
- **THEN** system returns `404` with error code `USER_NOT_FOUND`

### Requirement: Disable user (Admin)
The system SHALL allow admins to disable users via PATCH `/api/admin/users/{user_id}` with `{ "status": "disabled" }`. Disabled users MUST NOT be able to log in.

#### Scenario: Disable user
- **WHEN** admin PATCHes `/api/admin/users/{user_id}` with `{ "status": "disabled" }`
- **THEN** user's existing sessions are revoked
- **THEN** user cannot log in (receives `ACCOUNT_DISABLED`)
- **THEN** system records `admin.user.disable` audit event

#### Scenario: Re-enable user
- **WHEN** admin PATCHes `/api/admin/users/{user_id}` with `{ "status": "active" }`
- **THEN** user can log in again
- **THEN** system records `admin.user.update` audit event

### Requirement: Update group (Admin)
The system SHALL allow admins to update group name, add/remove members, and modify space permissions via PUT `/api/admin/groups/{group_id}`.

#### Scenario: Add member to group
- **WHEN** admin PUTs `/api/admin/groups/{group_id}` with updated member_ids including a new user
- **THEN** the user is added to the group
- **THEN** system increments users.permission_version for the added user
- **THEN** system publishes Redis event `user_permission_changed:{user_id}`
- **THEN** system records `user.group_change` audit event

#### Scenario: Remove member from group
- **WHEN** admin PUTs `/api/admin/groups/{group_id}` with member_ids excluding a user
- **THEN** the user is removed from the group
- **THEN** system increments users.permission_version for the removed user
- **THEN** system increments groups.permission_version for the group
- **THEN** system publishes Redis event `user_permission_changed:{user_id}`
- **THEN** within 5 seconds, the user MUST NOT see Spaces they only had access to via this group
- **THEN** system records `user.group_change` audit event

#### Scenario: Modify group space permissions
- **WHEN** admin PUTs `/api/admin/groups/{group_id}` with updated space_permissions granting `space:edit` on a new Space
- **THEN** system updates space_permissions for the group
- **THEN** system increments spaces.permission_version for affected Spaces
- **THEN** system publishes Redis event `permission_changed:{space_id}`
- **THEN** system inserts row into permission_versions table
- **THEN** system records `space.permission_change` audit event

#### Scenario: Group not found
- **WHEN** admin PUTs `/api/admin/groups/{nonexistent_id}`
- **THEN** system returns `404` with error code `GROUP_NOT_FOUND`

### Requirement: Manage Space permissions
The system SHALL allow space admins to view and modify which Groups have access to a Space via GET/PUT `/api/spaces/{space_id}/permissions`.

#### Scenario: List Space permissions
- **WHEN** space admin GETs `/api/spaces/{space_id}/permissions`
- **THEN** system returns list of Groups with their permission sets for this Space

#### Scenario: Grant permission to Group on Space
- **WHEN** space admin PUTs `/api/spaces/{space_id}/permissions` adding Group "Product" with `space:view`
- **THEN** system creates space_permissions row
- **THEN** system increments spaces.permission_version
- **THEN** system inserts row into permission_versions table with change_type='grant'
- **THEN** system publishes Redis event `permission_changed:{space_id}`
- **THEN** system records `space.permission_change` audit event

#### Scenario: Revoke permission from Group on Space
- **WHEN** space admin PUTs `/api/spaces/{space_id}/permissions` removing Group "Product"
- **THEN** system deletes the space_permissions row
- **THEN** system increments spaces.permission_version
- **THEN** system inserts row into permission_versions table with change_type='revoke'
- **THEN** within 5 seconds, users of Group "Product" MUST NOT access this Space
- **THEN** system records `space.permission_change` audit event

### Requirement: User status management
Users SHALL have a status field: active, invited, disabled. Disabled users MUST NOT be able to log in.

#### Scenario: Status values
- **WHEN** a user is created
- **THEN** status is set to 'active' (or 'invited' if invitation flow is enabled)
- **THEN** only 'active' users can authenticate via `/api/auth/login`
