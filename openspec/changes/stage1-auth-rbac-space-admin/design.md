## Context

Stage 0 已建立 NestJS + Fastify monorepo 骨架（apps/api, apps/web, packages/*）、Drizzle ORM migration、Docker Compose 开发环境和基础 CI。数据库 schema 草案（docs/schemas/schema.sql）已定义全部表结构。API 规范（docs/design/11_API规范.md）已定义完整的 Auth/Space/Admin 端点契约。

Stage 1 需要在此骨架上实现第一批可运行的业务模块。这些模块是所有后续 Stage 的前置依赖——没有 Auth 就没有 API 调用者身份，没有 Space 就没有知识隔离，没有 RBAC 就没有权限过滤。

约束：
- 技术栈已锁定：NestJS + Fastify、Drizzle ORM、PostgreSQL 16、Redis、React + Vite
- 多租户 tenant_id 必须贯穿所有表，即使当前单租户
- Cherry API 是权限唯一主数据源（Phase 2 Docmost 权限只是投影）
- API 统一响应格式、错误码、分页已在 Stage 0 建立

## Goals / Non-Goals

**Goals:**

- 实现完整的 JWT 认证链路（login → access_token → refresh → logout）
- 实现 6 角色 14 权限点的 RBAC 模型，通过 NestJS Guard 统一拦截
- 实现 Space 作为知识隔离和权限隔离的基本单位
- 实现 permission_version 撤权缓存失效机制，5s 内生效
- 实现模型配置管理（CRUD + 连通性测试），为后续 Chat/Embedding 做准备
- 实现结构化审计日志，覆盖 auth/user/space/model 所有关键操作
- 实现 Admin Console 基础页面，管理员可以操作所有管理功能
- 为 Stage 2+ 的 Job、Upload、Wiki、Chat 提供稳固的认证和权限基础

**Non-Goals:**

- 不实现 OAuth2/OIDC/LDAP 等外部身份源集成（Phase 1 只支持邮箱密码登录）
- 不实现 Job 系统（Stage 2）
- 不实现文件上传和解析（Stage 3）
- 不实现 Wiki 页面和 Canonical Wiki Repo（Stage 4）
- 不实现 Graphify、索引、Chat（Stage 5-7）
- 不接入 Docmost（Phase 2）
- 不实现 MCP Gateway 和 API Token（Phase 4）
- 不做多 embedding 模型并存（Phase 2+ 方向）

## Decisions

### D1: JWT 签发与存储策略

**选择**：access_token 短期（1h）签在 Authorization header，refresh_token 长期（7d）存 httpOnly cookie + DB sessions 表

**原因**：
- httpOnly cookie 防止 XSS 窃取 refresh_token
- access_token 在 header 方便 API 调用和 SSE 连接
- sessions 表支持服务端主动撤销和多设备管理
- 备选方案：纯 cookie 方案（access_token 也存 cookie）——但不利于后续 MCP Gateway 的 Bearer token 场景

### D2: 密码哈希算法

**选择**：argon2id（首选），fallback 到 bcrypt

**原因**：
- argon2id 是 OWASP 推荐的内存硬哈希，抗 GPU/ASIC 暴力
- argon2 的 Node.js binding（node-argon2）成熟稳定
- bcrypt 作为 fallback 保证兼容性
- 备选方案：纯 bcrypt——安全性略低但生态更广，权衡后选 argon2

### D3: RBAC 实现方式

**选择**：NestJS Custom Guard + Decorator（`@Permissions('space:view')`），权限通过 Group → space_permissions 查询，结果缓存到 Redis（TTL 60s）

**原因**：
- NestJS Guard 是框架原生的权限拦截点，与 Controller 解耦
- Decorator 声明式权限比硬编码检查更清晰、更不容易遗漏
- Redis 缓存避免每次请求都查 DB，但 TTL 短（60s）+ permission_version 机制保证一致性
- 备选方案：CASL 库——功能更丰富但引入额外抽象，Stage 1 的 14 个权限点用 Guard 足够

### D4: permission_version 撤权缓存失效

**选择**：三表（users/groups/spaces）各自 permission_version 计数器 + Redis Pub/Sub 事件 + 主动缓存清理

**原因**：
- 权限变更时 increment permission_version → 发布 Redis event → 所有 API 实例订阅并清理本地 + Redis 缓存
- 缓存 key 包含 permission_version，版本不匹配自动 miss
- 5 分钟 TTL 兜底，即使事件丢失也能自愈
- 实现细节见 docs/engineering/12_权限安全审计.md §4A

### D5: 模型 API Key 存储

**选择**：encrypted_api_key_ref 字段存储引用（如 `secret:anthropic_key`），实际密钥存环境变量或 secret manager，不落 DB

**原因**：
- API key 不落数据库，避免 DB dump 泄露
- 环境变量方案简单，Phase 1 足够；后续可平滑切换到 Vault/KMS
- 模型连通性测试时从环境变量解引用
- 备选方案：DB 加密存储——增加 key rotation 复杂度，Phase 1 无此需求

### D6: 审计日志写入策略

**选择**：异步写入（NestJS Interceptor 捕获 → 推入内存队列 → 批量 flush 到 DB），不阻塞请求

**原因**：
- 审计日志不应影响请求延迟
- 内存队列 + 定时 flush（每 1s 或满 50 条）平衡吞吐和延迟
- 进程退出时 graceful drain
- 备选方案：同步写入——简单但增加 P95 延迟；Kafka/消息队列——Phase 1 过重

### D7: Admin Console 技术方案

**选择**：与 Cherry Web 合并在 apps/web 中，通过路由和角色控制 Admin 页面可见性

**原因**：
- 减少一个独立 app 的维护成本
- 共享登录状态和组件库
- Admin 路由 `/admin/*` 由前端 RBAC guard 控制渲染
- 备选方案：独立 admin app——部署隔离更好但 Stage 1 不需要

### D8: 初始 Tenant 和 Admin 用户

**选择**：DB migration 中 seed 默认 tenant + admin 用户（邮箱/密码从环境变量读取），首次启动即可使用

**原因**：
- Docker Compose 一键启动后无需手动创建初始用户
- 环境变量控制初始 admin 凭证，不硬编码
- seed 幂等，重复运行不产生重复数据

### D9: 权限变更 API 模型

**选择**：双入口——Group 维度 `PUT /api/admin/groups/{group_id}`（全量覆盖成员和 space_permissions）+ Space 维度 `PUT /api/spaces/{space_id}/permissions`（全量覆盖该 Space 的 Group 权限列表）

**原因**：
- Group 维度适合"管理一个团队的所有权限"场景
- Space 维度适合"管理一个知识空间的所有授权"场景
- 全量覆盖（PUT）比增量（PATCH add/remove）更不容易出现并发不一致，且天然幂等
- 两个入口都必须 increment permission_version + 写 permission_versions 行 + 发布 Redis 事件 + 审计
- 备选方案：只有 Group 入口——Space Admin 无法直接管理自己 Space 的权限

### D10: User CRUD 端点设计

**选择**：`GET /api/admin/users` + `POST /api/admin/users` + `PATCH /api/admin/users/{user_id}`，disable 通过 PATCH status=disabled 实现

**原因**：
- PATCH 比 dedicated disable endpoint 更通用，同一端点可更新 role/display_name/status
- disable 触发副作用（session 撤销）在 service 层判断 status 变更方向
- 不做物理删除（软删除），符合审计和合规需求

### D11: 通用 API Rate Limit

**选择**：Stage 1 实现三档 rate limit——login 10 req/min/IP、public API 600 req/min/user、Admin API 300 req/min/user，通过可配置 NestJS Guard 实现

**原因**：
- API 规范 §3.2 已定义限制，Stage 1 需落地
- Redis 滑动窗口算法，key 前缀区分类型
- 返回标准 `X-RateLimit-*` header

### D12: Health API 降级策略

**选择**：Stage 1 的 health endpoint 检查 DB/Redis/MinIO，未部署组件（vector_store/graph_store/docmost_bridge）返回 `"not_configured"` 而非 error

**原因**：
- 避免 Stage 1 因后续 Stage 组件未就绪而报错
- Phase 2+ 随组件部署自动变为 healthy/unhealthy

### D13: Schema 字段与 API 响应映射

**选择**：DB 字段名与 API 响应字段名允许映射——`users.display_name` → API `name`、`model_configs.display_name` → API `name`、`model_configs.enabled` → API `status`（true→"active", false→"disabled"）

**原因**：
- DB 字段名遵循精确语义（display_name 区别于 email 中的 name）
- API 响应遵循简洁用户体验（前端直接用 `name`）
- 映射在 DTO/serializer 层完成，不污染 DB schema

## Risks / Trade-offs

- **[单点 Redis 依赖]** → Stage 1 Redis 为单实例，故障时 permission_version 事件丢失。缓解：5 分钟 TTL 兜底 + 健康检查告警。Phase 2+ 可引入 Redis Sentinel。
- **[JWT 泄露风险]** → access_token 泄露后 1h 内有效。缓解：短 TTL + 后续可加黑名单机制。Phase 1 可接受。
- **[审计日志异步丢失]** → 进程异常退出可能丢失内存队列中的日志。缓解：graceful shutdown drain + crash 日志记录 pending count。
- **[初始 admin 密码安全]** → 环境变量中的初始密码可能被容器 inspect 看到。缓解：文档提示首次登录后立即修改密码。
- **[前后端合并部署]** → Admin Console 和 Cherry Web 同一 build，Admin 代码对所有用户可见（通过前端路由控制）。缓解：Admin API 有后端 Guard 保护，前端只是 UX 控制。
