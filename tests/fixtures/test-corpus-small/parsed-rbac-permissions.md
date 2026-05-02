# RBAC and Permission Model

## Role Hierarchy

CherryGraph defines three roles with increasing privilege:

1. **viewer** — read-only access to assigned Spaces
2. **editor** — can upload documents and trigger Graphify runs
3. **admin** — full access including user management and system configuration

## Space Permissions

Permissions are granted at the Space level through Groups. A user belongs to one or more Groups, and each Group has a permission level per Space.

### Permission Levels

| Level | Capabilities |
|---|---|
| `space:read` | View wiki pages, search, chat |
| `space:write` | Upload documents, trigger graphify |
| `space:admin` | Manage space settings, permissions |

## Permission Version Mechanism

Each Space maintains a `permission_version` counter. When permissions change:

1. The counter increments
2. Redis cache keys containing the old version are invalidated
3. All subsequent requests fetch fresh permissions from the database

This ensures permission revocation takes effect within 5 seconds.

## Group Management

Groups serve as the intermediary between users and spaces. A group can be assigned permissions on multiple spaces, and a user can belong to multiple groups. The effective permission is the highest level granted by any group membership.
