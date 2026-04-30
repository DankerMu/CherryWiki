# Stage 1 Change Alignment Review Report

## Summary

Overall alignment score: 7/10

Critical gaps: 4

Warnings: 9

The change covers the main Stage 1 areas: Auth, RBAC, Space CRUD basics, model configuration, audit logging, Admin Console pages, and `permission_version` cache invalidation. The largest alignment risks are not missing whole capabilities, but mismatches between the OpenSpec artifacts, `docs/schemas/schema.sql`, and the API/security requirements. In particular, password login and role-based users are specified but not supported by the current `users` table, permission changes lack a concrete mutation API, User/Group CRUD is incomplete, and several mandatory audit events are specified without corresponding implementation tasks.

The Phase 1 tracking matrix is broader than engineering Stage 1. Upload, Job, Graphify, Wiki, Index, Chat, SSRF, prompt-injection, and retrieval endpoints are intentionally later engineering stages per the implementation stage plan and are not counted as Stage 1 gaps here.

## A. API Endpoint Coverage

| Endpoint | In Specs? | In Tasks? | Gap? |
|---|---|---|---|
| POST `/api/auth/login` | Yes, `auth` login scenarios | Yes, 3.2 plus 3.3/3.4 | No |
| POST `/api/auth/refresh` | Yes, `auth` token refresh | Yes, 3.5 | Partial: task does not explicitly record `auth.token_refresh` audit event |
| POST `/api/auth/logout` | Yes, `auth` logout | Yes, 3.6 | No |
| GET `/api/auth/me` | Yes, current user profile | Yes, 3.7 | No |
| POST `/api/auth/password/change` | Yes, Auth supplement covered | Yes, 3.8 | No |
| GET `/api/auth/sessions` | Yes, Auth supplement covered | Yes, 3.9 | Partial: spec/API require `last_used_at`, but schema lacks this field |
| DELETE `/api/auth/sessions/{session_id}` | Yes, Auth supplement covered | Yes, 3.10 | No |
| GET `/api/spaces` | Yes, permission-filtered list | Yes, 5.2 | No |
| POST `/api/spaces` | Yes, create space | Yes, 5.3 | Partial: API error `SPACE_LIMIT_EXCEEDED` is not specified or tasked |
| GET `/api/spaces/{space_id}` | Yes, details and no-permission 404 | Yes, 5.4 | Partial: spec/API include fields not present in schema (`description`, `status`) |
| PATCH `/api/spaces/{space_id}` | Yes, update space | Yes, 5.5 | Partial: API says `X-Idempotency-Key`; endpoint task relies only on global infra |
| GET `/api/spaces/{space_id}/stats` | No dedicated backend API requirement | No dedicated task | Warning: listed in Space API §5 but only folded into space details as placeholders |
| GET `/api/admin/users` | Yes, list users | Yes, 4.2 | No |
| POST `/api/admin/users` | Yes, create user | Yes, 4.3 | Partial: schema lacks user `role` and password credential field needed by specs/API |
| User update/disable API | Partial: scenario says admin sets status, no endpoint | Partial: 4.6 has behavior, no route | Critical: Stage says User CRUD/status management, but no concrete endpoint contract |
| GET `/api/admin/groups` | Yes, list groups | Yes, 4.4 | No |
| POST `/api/admin/groups` | Yes, create group with members/permissions | Yes, 4.5 | No for create; insufficient for later permission changes |
| Group update/member/permission API | Partial: Admin Console says manage groups, no endpoint | No | Critical: no concrete API for add/remove members or grant/revoke `space_permissions` after creation |
| GET `/api/admin/models` | Yes, list model configs | Yes, 6.2 | Partial: response shape differs from API §11 examples |
| POST `/api/admin/models` | Yes, create model config | Yes, 6.3 | Partial: API idempotency and `SECRET_NOT_FOUND` are not explicitly specified |
| PATCH `/api/admin/models/{model_id}` | Yes, Admin Models supplement covered | Yes, 6.4 | Partial: `MODEL_NOT_FOUND` not specified in OpenSpec scenarios |
| POST `/api/admin/models/{model_id}/test` | Yes, connectivity test | Yes, 6.5 | Partial: task does not explicitly record `admin.model.test` audit event |
| GET `/api/admin/audit-logs` | Yes, query audit logs | Yes, 7.3 | No |
| GET `/api/admin/system/health` | Partial: Admin Console scenario references endpoint | Yes, 7.4 | Warning: no standalone backend spec for auth, response contract, or failure modes |
| Permission isolation for all APIs | Yes, `rbac` guard and filtered Space scenarios | Yes, 2.4 and endpoint tasks | No |
| `permission_version` cache key mechanism | Yes, `rbac` cache/version scenarios | Yes, 2.5/2.6 and 10.7 | No |
| Basic Admin Console pages | Yes, `admin-console` specs | Yes, 9.1-9.10 | No |

Missing or under-specified Stage 1 endpoints/workflows:

1. A concrete user update/disable endpoint, despite User CRUD and user status management being required.
2. A concrete group update endpoint for member changes.
3. A concrete permission grant/revoke endpoint for `space_permissions`, needed to prove `permission_version` increments and permission-change auditing beyond initial group creation.
4. Dedicated `GET /api/spaces/{space_id}/stats`, if Space API §5 is in Stage 1 scope.
5. A standalone backend health API spec for `GET /api/admin/system/health`.

Out-of-scope Phase 1 matrix endpoints correctly omitted for engineering Stage 1: uploads, jobs, graphify runs, Wiki pages, Chat completions, retrieval traces, and index rebuilds. These map to later stages in `cherrywiki_implementation_stage_plan.md`.

## B. Schema Coverage

| Table | In Migration Task? | Key Fields Covered In Specs? | Gap? |
|---|---|---|---|
| `tenants` | Yes, 1.1 and seed in 1.2 | `tenant_id` appears in JWT, audit, uniqueness, and model/user scopes | No lifecycle spec needed for Stage 1 |
| `users` | Yes, 1.1/1.3 | `permission_version`, `status`, tenant-scoped email uniqueness covered | Critical: schema lacks `role` and password credential field, but Auth/User specs require role and email/password login |
| `groups` | Yes, 1.1/1.3 | `permission_version`, name uniqueness, group permissions covered | No major gap |
| `group_members` | Yes, 1.1/1.3 | Membership inheritance and initial group creation covered | Critical workflow gap: no update/remove member endpoint or task |
| `spaces` | Yes, 1.1/1.3 | `permission_version`, `strict_knowledge_only`, `graphify_config`, `wiki_repo_path` covered | Critical: specs/API use `description` and `status`, but schema does not define them; API also exposes `docmost_space_id` while spec does not address it |
| `space_permissions` | Yes, 1.1/1.3 | Space-scoped group permissions covered | Critical workflow gap: no explicit grant/revoke/update API after initial group creation |
| `model_configs` | Yes, 1.1/1.3 | Provider, model id/type, display name, base URL, `encrypted_api_key_ref`, embedding dims, limits, enabled, visibility covered | Warning: OpenSpec follows schema fields, while API §11 uses `name/status/config/allowed_roles`; contract needs reconciliation |
| `sessions` | Yes, 1.1/1.3 | Refresh token hash, expiry, revocation, IP/user agent covered | Critical: spec/API require `last_used_at`, but schema does not define it |
| `audit_logs` | Yes, 1.1/1.3 | Required audit fields covered | Warning: action taxonomy and task coverage are incomplete for mandatory events |
| `permission_versions` | Yes, 1.1/1.3 | Actor, change type, subject, old/new permissions, reason covered | Warning: tasks do not explicitly insert rows for every permission mutation |
| `system_settings` | Yes, 1.1/1.3 | Not covered except `admin.config.change` audit event | Warning: table is migrated, but there is no config management spec/task |

Additional schema alignment notes:

1. `users.display_name` vs API/spec `name` should be normalized or mapped explicitly.
2. `audit_logs.id` vs API/spec `audit_id` is acceptable if `audit_id` is response naming, but should be stated.
3. `sessions.last_used_at` is required by API §14.1 and OpenSpec auth scenarios but missing from `schema.sql`.
4. If email/password auth remains Stage 1, `users.password_hash` or a separate credentials table must be added before implementation.

## C. Acceptance Criteria

| Acceptance Criterion | Covered? | Evidence | Gap? |
|---|---|---|---|
| 用户可登录 | Mostly | Auth spec login scenarios; tasks 2.1, 2.2, 3.2 | Critical schema gap: no password credential field in `users` or alternate table |
| 用户只看到有权限的 Space | Yes | `space-management` list/get scenarios; `rbac` Space-scoped permission scenarios; tasks 2.4, 5.2, 10.4 | No |
| 管理员可创建用户、Group、Space | Yes | User/group/space create specs; tasks 4.3, 4.5, 5.3 | No for create; broader CRUD remains incomplete |
| 权限变更后 `permission_version` 增加 | Partial | `rbac` permission-version scenarios; group creation task 4.5; cache tasks 2.5/2.6 | Critical: no concrete post-create permission mutation API/task, so revocation/update path is not implementable from API contract |
| 审计日志记录权限变更 | Partial | `audit-logging` has `space.permission_change`; `rbac` has `permission_versions` row scenario | Critical: no permission mutation endpoint/task and no explicit task to write `space.permission_change` for grant/revoke |

## D. Security Requirements

| Requirement | Covered? | Gap? |
|---|---|---|
| JWT contains no secrets | Yes in spec | Auth spec states JWT must not contain password hash or secret material; task 2.2 lists claims but should add an explicit negative test |
| Login lockout | Yes | Auth spec and task 3.3 cover 5 failures / 15 minutes |
| Rate limiting | Partial | Login 10 req/min/IP is covered; general API rate limits from API §3.2 (`600 req/min/user`, `300 req/min/user` for Admin) are not specified or tasked |
| Permission version cache invalidation | Yes | Specs/tasks cover `permission_version`, Redis events, versioned keys, and 5s revocation test |
| 5s revocation window | Yes | `rbac` scenario and task 10.7 cover "within 5 seconds" |
| Mandatory audit events from security doc §8.1 | Partial | Stage 1 auth/user/space/admin/model events are partially covered; `group_change`, `auth.token_refresh`, `auth.failed_login`, `space.permission_change`, `admin.model.test`, and `admin.config.change` need explicit endpoint/task coverage |
| No secrets in audit logs | Yes | `audit-logging` scenarios cover passwords, API keys, tokens |
| Space isolation | Yes | `rbac` and `space-management` cover Space-scoped permissions and hidden unauthorized Spaces |
| Cherry as permission source of truth | Mostly | Design context states Cherry API is the only permission source; Stage 1 correctly avoids Docmost sync | No Stage 1 conflict |

Mandatory audit event mapping for Stage 1:

| Security Doc Event | OpenSpec Equivalent | Task Coverage | Gap? |
|---|---|---|---|
| Auth `login` | `auth.login` | 3.2 | No |
| Auth `logout` | `auth.logout` | 3.6 | No |
| Auth `token_refresh` | `auth.token_refresh` | Not explicit in 3.5 | Warning |
| Auth `failed_login` | `auth.failed_login` | Not explicit in 3.2/3.3 | Warning |
| User `create_user` | `admin.user.create` | 4.3 | No |
| User `disable_user` | `admin.user.disable` | 4.6 | Partial: no endpoint |
| User `group_change` | Not explicit | No | Critical |
| Space `create_space` | `space.create` | 5.3 | No |
| Space `update_space` | `space.update` | 5.5 | No |
| Space `permission_change` | `space.permission_change` | No explicit mutation task | Critical |
| Admin `model_changed` | `admin.model.create/update/test` | 6.3/6.4 partial, 6.5 missing audit | Warning |
| Admin `config_changed` | `admin.config.change` | No config task/API | Warning |

## E. Design Decision Gaps

### Decisions That Contradict Or Drift From Docs

1. **Schema-dependent Auth is unresolved.** Design chooses email/password JWT auth with argon2id, but `schema.sql` has no `password_hash` or credentials table and no `role` column on `users`.
2. **Model API contract drift.** Design/specs use normalized `model_configs` fields (`display_name`, `model_type`, `enabled`, `visible_group_ids`, `encrypted_api_key_ref`), while API §11 examples use `name`, `status`, nested `config`, and `allowed_roles`. This must be reconciled before implementation.
3. **Space API/schema drift.** Space specs/API use `description` and `status`; `schema.sql` does not. Either the schema needs fields or the API/spec must stop requiring them.
4. **Audit write strategy is weaker than mandatory-audit semantics.** Asynchronous in-memory audit batching is not forbidden, but mandatory security audit events need a clear durability guarantee or fallback for process crashes.

### Project Requirements Without Corresponding Design Decision

1. **Concrete permission mutation model.** There is no design decision for how admins grant/revoke Space permissions after creation, how group membership changes are exposed, or which endpoint owns `space_permissions`.
2. **User/Group CRUD boundary.** Stage 1 says User/Group/Space CRUD, but design only decides high-level RBAC and Admin Console placement. It does not decide update/delete/disable routes for users/groups.
3. **General rate limiting.** API §3.2 defines public and Admin API limits, but design only mentions login rate limiting.
4. **System settings/config management.** `system_settings` and `admin.config.change` appear, but no design decision defines config categories, endpoints, or Admin Console behavior.
5. **Health API behavior.** Tasks include DB/Redis/MinIO health, but no design decision defines whether vector/graph/docmost components from API §11 are omitted in Stage 1 or returned as disabled/not_configured.

## F. Task Completeness

Tasks cover the broad implementation areas, but several spec requirements lack precise implementation tasks:

| Spec Requirement / Scenario | Task Coverage | Gap? |
|---|---|---|
| Login success/failure/lockout/rate limit | 3.2-3.4 | Mostly covered; failed-login audit not explicit |
| Successful login resets counter | 3.3 implied | Add explicit task/test assertion |
| Disabled account cannot login | 4.6 plus auth behavior implied | Add explicit auth task/test |
| JWT payload has no secrets | 2.2 claims listed | Add explicit negative test |
| Permission changes insert `permission_versions` rows | 1.1 table plus rbac spec | Missing implementation task on every grant/revoke/member mutation |
| User removed from Group increments user/group versions | `rbac` spec only | Missing concrete endpoint/task |
| Admin sets user status disabled | 4.6 behavior only | Missing concrete endpoint and API spec |
| Group member/space-permission updates after creation | Admin Console/spec wording only | Missing endpoint/task |
| Space `wiki_repo_path` not user-modifiable | 5.3/5.5 implied | Add explicit task/test |
| `GET /api/spaces/{id}/stats` | No dedicated task | Missing if Space API §5 is in scope |
| Model API key secret missing | Spec scenario partial | Add `SECRET_NOT_FOUND` task/test if following API §11 |
| Model not found on PATCH/test | Not explicit | Add error scenarios/tasks |
| `admin.model.test` audited | Audit spec lists event | Task 6.5 lacks audit |
| Audit `admin.config.change` | Spec lists event | No config task/API |
| System health endpoint | 7.4 task only | Add backend spec scenarios |
| General public/Admin rate limits | No | Add guard/spec/tasks or mark out of Stage 1 |

Task dependency concerns:

1. Request infrastructure tasks 8.1-8.4 should be prerequisites for API module work, because Auth/Space/Admin endpoints depend on `request_id`, error shape, pagination, and idempotency.
2. AuditModule tasks 7.1-7.2 should be prerequisites for endpoint tasks that say "record audit", or the endpoint tasks should explicitly depend on 7.1/7.2.
3. Permission mutation and `permission_versions` persistence should sit before the 10.7 revocation test; currently there is no concrete mutation task for that test to exercise.
4. Frontend Admin pages depend on API routes that are incomplete for user disable, group membership changes, and permission changes.

## G. Scope Boundary

Correctly excluded from Stage 1:

1. File upload, parsing, upload security, and source archive workflows.
2. Job system and task center implementation.
3. Graphify run execution, retry, reports, and graph output.
4. Wiki page generation, browsing, publication, and indexing.
5. Chat completions, retrieval traces, citations, and GraphRAG behavior.
6. Docmost Bridge/sync and permission projection.
7. MCP Gateway and API tokens.

Potential overreach or ambiguous scope:

1. `GET /api/admin/system/health` and the System Health Admin page are included. This is supported by the Phase 1 tracking matrix, but not listed in the Stage 1 deliverables. Keep it only if Stage 1 intentionally includes deployment health.
2. `system_settings` and `admin.config.change` are included by table/audit naming, but there is no config management requirement. Either add the missing spec/tasks or remove from Stage 1.
3. Auth supplement endpoints (`password/change`, `sessions`) are beyond the Stage 1 endpoint bullet list but align with "session 管理" and API §14.1, so they are acceptable.

Missing from Stage 1 "do" list:

1. Full User/Group CRUD is not complete; only list/create plus an unspecified disable behavior are present.
2. Explicit `space_permissions` management after initial group creation is missing.
3. Permission-change auditing and `permission_versions` persistence are not fully task-backed.
4. Schema support for password login and user roles is missing.

## Recommendations

1. Resolve schema/API/spec mismatches before implementation: add or define `users.role`, `users.password_hash` or a credentials table, `spaces.description`, `spaces.status`, and `sessions.last_used_at`, or update specs/API to stop requiring those fields.
2. Add a concrete permission management API, for example `PUT /api/admin/groups/{group_id}` for members and `PUT /api/spaces/{space_id}/permissions` or `PATCH /api/admin/groups/{group_id}/space-permissions`, with scenarios for grant, revoke, version increments, Redis invalidation, `permission_versions` insert, and `space.permission_change` audit.
3. Complete User/Group CRUD scope or explicitly narrow Stage 1 to list/create. If CRUD remains required, add update/disable/delete endpoints and tasks for users and groups.
4. Expand audit tasks so every Stage 1 mandatory event is explicitly produced and tested: `auth.token_refresh`, `auth.failed_login`, `admin.user.disable`, `user.group_change`, `space.permission_change`, `admin.model.test`, and `admin.config.change` if config management stays in scope.
5. Add standalone backend specs for `GET /api/admin/system/health` and either add or intentionally defer `GET /api/spaces/{space_id}/stats`.
6. Reconcile model API payload/response naming across OpenSpec, `schema.sql`, and API §11/§14.4.
7. Add general public/Admin API rate-limit requirements or document that Stage 1 implements only login rate limiting.
8. Reorder or annotate task dependencies so request infrastructure and audit infrastructure come before API endpoint implementation.
9. Add focused tests for no-secret JWT payloads, no-secret audit metadata, permission-version row insertion, cache invalidation within 5 seconds, and no-permission Space invisibility.
