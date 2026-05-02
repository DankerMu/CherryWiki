# RBAC Permission Model

The RBAC Permission Model is the foundational access control framework for CherryGraph Studio. It defines role hierarchies, group-based permission assignment, and space-scoped authorization.

## Role Hierarchy

| Role | Description |
|---|---|
| viewer | Read-only access to assigned Spaces |
| editor | Upload documents and trigger Graphify runs |
| admin | Full access including user and system management |

## Group-Based Assignment

Users are assigned to Groups, and Groups hold permissions on Spaces. This indirection allows:

- One user to access multiple Spaces through different Groups
- Bulk permission changes by modifying Group assignments
- Clear audit trail of who granted what access

## Permission Resolution

The effective permission for a user on a Space is the maximum level across all their group memberships for that Space:

```
effective_level = MAX(group.level for group in user.groups if group.has_space(space_id))
```

## Connected Concepts

- Defines **Space Permissions** structure
- Enforced by **Session Management** (ambiguous relationship)
- Integrated with **JWT Authentication** (inferred)

## Sources

- parsed-rbac-permissions.md (L1, L13)
