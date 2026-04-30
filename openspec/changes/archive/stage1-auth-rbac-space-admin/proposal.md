## Why

Stage 0 建立了 monorepo 骨架和工程基线，但系统尚无用户身份、权限隔离和知识空间概念。Stage 1 是所有业务功能的地基——后续的上传（Stage 2-3）、Wiki（Stage 4）、Graphify（Stage 5）、索引（Stage 6）、Chat（Stage 7）全部依赖用户认证、Space 隔离和 RBAC 权限。没有这层地基，任何业务模块都无法安全运行。

## What Changes

- **认证系统**：实现 JWT access_token / refresh_token 登录、刷新、登出、会话管理，包括登录失败锁定（5次/15min）和 rate limit（10 req/min/IP）
- **用户与分组管理**：Admin 可 CRUD 用户（创建/列表/更新/disable）和 Group（创建/列表/更新含成员增删和权限变更），用户通过 Group 获得 Space 权限
- **Space 管理**：知识空间 CRUD + Space 权限管理（GET/PUT permissions）+ Space 统计端点，含 strict_knowledge_only 配置、graphify_config、description、status
- **RBAC 权限模型**：6 种角色（Owner/Admin/Space Admin/Editor/Viewer/Auditor）、14 个权限点、space_permissions 表、权限 grant/revoke API
- **撤权缓存失效**：permission_version 机制 + Redis 事件驱动 + permission_versions 审计表，确保撤权 5s 内生效
- **模型配置管理**：Chat/Embedding/Rerank 模型 CRUD + API key 安全存储 + 连通性测试
- **审计日志**：记录所有关键操作（auth/user/space/model/config），支持管理员查询
- **系统健康检查**：API 暴露各组件（DB/Redis/MinIO）健康状态
- **Admin Console 基础页面**：React 管理后台，包含用户管理、Group 管理、Space 管理、模型管理、审计日志查看

## Capabilities

### New Capabilities

- `auth`: 用户认证（登录/登出/刷新/会话管理/密码变更）、JWT 签发与校验、登录锁定、rate limit
- `rbac`: 角色权限模型（6 角色 14 权限点）、space_permissions、permission_version 撤权缓存失效、ACL 信封机制
- `user-group-management`: 用户完整 CRUD（创建/列表/更新/disable）、Group 完整 CRUD（创建/列表/更新含成员增删和权限变更）、Space 权限管理 API（GET/PUT permissions）
- `space-management`: Space CRUD + stats + 健康检查、strict_knowledge_only 配置、graphify_config、Space 统计端点
- `model-config`: 模型配置 CRUD、API key 安全引用、连通性测试、按角色可见性控制
- `audit-logging`: 审计日志写入和查询、结构化字段（actor/action/resource/space/ip/request_id）
- `admin-console`: React Admin 后台基础页面（用户/Group/Space/模型/审计日志/系统健康）

### Modified Capabilities

（无已有 capability，Stage 0 未建立 spec）

## Impact

- **API（apps/api）**：新增 AuthModule、UserModule、GroupModule、SpaceModule、ModelConfigModule、AuditModule、HealthModule；新增 JWT Guard、RBAC Guard、RateLimitGuard
- **前端（apps/web）**：新增登录页、Admin Console 路由和页面组件
- **共享包（packages/auth-core）**：JWT 工具、密码哈希、ACL 检查、permission_version 缓存逻辑
- **数据库**：需要 Stage 1 migration，创建 tenants/users/groups/group_members/spaces/space_permissions/model_configs/sessions/audit_logs/permission_versions/system_settings 表
- **依赖新增**：@nestjs/jwt、argon2、ioredis（如未引入）、class-validator、class-transformer
- **基础设施**：Redis 用于 session 缓存、permission_version 事件发布、rate limit 计数器
