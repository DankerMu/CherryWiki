# Graph Report

## Summary

- **Nodes**: 10
- **Edges**: 9
- **Communities**: 4
- **Ambiguous edges**: 1

## Communities

### auth_system (3 nodes)
Core authentication subsystem including JWT tokens, refresh rotation, and session lifecycle.

### permission_system (3 nodes)
RBAC-based permission model with space-level granularity and version-tracked cache invalidation.

### ingestion (2 nodes)
Document upload and URL fetching pipeline with security hardening.

### operations (2 nodes)
Deployment and operational health monitoring infrastructure.

## God Nodes

- **JWT Authentication** — central authentication mechanism, connected to 3 other nodes
- **RBAC Permission Model** — foundational access control, connected to 2 other nodes

## Ambiguous Edges

| Source | Target | Relation | Score |
|---|---|---|---|
| Session Management | RBAC Model | enforces | 0.2 |

## Knowledge Gaps

- No explicit connection between ingestion pipeline and permission checks
- Health check failure recovery procedures not documented
