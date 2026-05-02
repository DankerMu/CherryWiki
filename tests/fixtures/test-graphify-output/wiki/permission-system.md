# Permission System

## Overview

CherryGraph uses a Role-Based Access Control model with Space-level permission granularity. Permissions are mediated through Groups, supporting flexible multi-tenant access patterns.

## Key Components

### RBAC Permission Model
Three roles (viewer, editor, admin) with hierarchical privileges. Groups serve as the permission assignment unit between users and spaces.

### Space Permissions
Permissions are scoped to individual Spaces with three levels: `space:read`, `space:write`, and `space:admin`. Effective permission is the highest level granted by any group membership.

### Permission Version Mechanism
A counter-based cache invalidation strategy ensures permission revocations take effect within 5 seconds. Each Space maintains its own version counter.

## Relationships

- RBAC Model **defines** Space Permissions
- Space Permissions **triggers** Permission Version updates
- Session Management **enforces** RBAC Model (ambiguous)

## Sources

- parsed-rbac-permissions.md
