## ADDED Requirements

### Requirement: Role-based access control with 6 roles
The system SHALL support 6 roles: Owner, Admin, Space Admin, Editor, Viewer, Auditor. Each role SHALL have a fixed set of permissions.

#### Scenario: Role permission mapping
- **WHEN** a user has role "Owner"
- **THEN** the user has all 14 permission points

#### Scenario: Viewer role restrictions
- **WHEN** a user has role "Viewer"
- **THEN** the user has only `space:view`, `chat:use`, `model:use` permissions
- **THEN** the user MUST NOT have `upload:create`, `wiki:publish`, `admin:*` permissions

#### Scenario: Auditor role
- **WHEN** a user has role "Auditor"
- **THEN** the user has `space:view`, `admin:audit_view` permissions
- **THEN** the user MUST NOT have `admin:user_manage`, `admin:model_manage` permissions

### Requirement: 14 permission points
The system SHALL enforce the following permission points: `space:view`, `space:edit`, `space:admin`, `upload:create`, `upload:read`, `wiki:publish`, `wiki:rollback`, `graphify:run`, `graphify:view`, `chat:use`, `model:use`, `admin:user_manage`, `admin:model_manage`, `admin:audit_view`.

#### Scenario: Permission check on API endpoint
- **WHEN** a request arrives at an endpoint requiring `space:admin` permission
- **THEN** the system checks if the user's role or group grants `space:admin` for the target Space
- **THEN** returns `403 PERMISSION_DENIED` if not authorized

### Requirement: Space-scoped permissions via Groups
Users SHALL gain Space-level permissions through Group membership. A Group is assigned permissions on a Space via space_permissions. A user inherits all permissions from all Groups they belong to.

#### Scenario: User gains Space access through Group
- **WHEN** user belongs to Group "RD" and Group "RD" has `space:view` + `space:edit` on Space "RD知识库"
- **THEN** user can access Space "RD知识库" with `space:view` and `space:edit` permissions

#### Scenario: User in multiple Groups
- **WHEN** user belongs to Group "RD" (has `space:view` on Space A) and Group "Admin" (has `space:admin` on Space A)
- **THEN** user's effective permissions on Space A are the union: `space:view` + `space:admin`

#### Scenario: User with no Group for a Space
- **WHEN** user has no Group membership granting any permission on Space B
- **THEN** user MUST NOT see Space B in any API response (spaces list, search, chat scope)

### Requirement: Permission version cache invalidation
The system SHALL maintain a `permission_version` counter on users, groups, and spaces tables. Any permission change SHALL increment the relevant counters and publish a Redis event to invalidate caches.

#### Scenario: Space permission change increments version
- **WHEN** admin adds Group "Product" to Space "产品知识库" with `space:view`
- **THEN** spaces.permission_version for "产品知识库" increments by 1
- **THEN** system publishes Redis event `permission_changed:{space_id}`
- **THEN** all API instances clear cached permissions for that Space

#### Scenario: User removed from Group
- **WHEN** admin removes user A from Group "RD"
- **THEN** users.permission_version for user A increments by 1
- **THEN** groups.permission_version for Group "RD" increments by 1
- **THEN** system publishes Redis event `user_permission_changed:{user_id}`
- **THEN** all cached permission data for user A is cleared

#### Scenario: Revoked permission effective within 5 seconds
- **WHEN** admin removes user A's access to Space "RD知识库"
- **THEN** within 5 seconds, user A's subsequent API requests MUST NOT return data from Space "RD知识库"

### Requirement: Permission cache with version key
The system SHALL cache user permissions in Redis with a cache key that includes permission_version values. Cache TTL MUST NOT exceed 5 minutes.

#### Scenario: Cache miss on version change
- **WHEN** permission_version changes after a cached entry was stored
- **THEN** the next request generates a cache miss (due to version mismatch in key)
- **THEN** system queries the DB for fresh permissions and caches the result

### Requirement: NestJS Guard decorator for permission enforcement
The system SHALL provide a `@Permissions()` decorator and corresponding NestJS Guard. Every protected endpoint MUST declare required permissions via this decorator.

#### Scenario: Endpoint with permission decorator
- **WHEN** a Controller method has `@Permissions('space:admin')`
- **THEN** the RbacGuard checks the authenticated user has `space:admin` for the target Space
- **THEN** unauthenticated requests receive `401 UNAUTHENTICATED`
- **THEN** unauthorized requests receive `403 PERMISSION_DENIED`

### Requirement: Permission audit trail
The system SHALL record all permission changes in the `permission_versions` table with actor, change_type, subject, old/new permissions, and reason.

#### Scenario: Permission change recorded
- **WHEN** admin grants `space:edit` to Group "Product" on Space "产品知识库"
- **THEN** a row is inserted into permission_versions with change_type='grant', subject_type='group', subject_id=group_id, new_permissions_json containing 'space:edit'
