# RBAC Permission Model

CherryWiki implements role-based access control with role hierarchies, group-based permission assignment, and space-scoped authorization.

## Role Hierarchy

Roles are ordered: `admin > editor > viewer > guest`. Higher roles inherit all permissions of lower roles.

- **admin**: Full system access including user management, space creation, and configuration
- **editor**: Can create/edit wiki pages, upload documents, and use chat within assigned spaces
- **viewer**: Read-only access to wiki pages and chat history
- **guest**: Limited access, cannot view unpublished content

## Group-Based Assignment

Users belong to groups. Groups are assigned space-level roles via `space_permissions`. This allows:
- One user in multiple groups with different space access
- Bulk permission management through group membership
- Tenant-scoped isolation (users only see their tenant's data)

## Space Permissions

Each space has an ACL (access control list) defined through group→role mappings:
- `space_permissions(space_id, group_id, role)` table
- Permission checks cascade: tenant → group membership → space role → action permission

## Integration with JWT

The JWT access token embeds `group_ids[]` for the authenticated user. Permission checks evaluate:
1. Extract group_ids from JWT
2. Query space_permissions for matching groups
3. Resolve highest role across all matching groups
4. Check if resolved role permits the requested action
