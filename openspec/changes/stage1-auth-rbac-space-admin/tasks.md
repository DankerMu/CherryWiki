## 0. Request Infrastructure（前置，所有 API 模块依赖）

- [ ] 0.1 实现 request_id 中间件：每个请求生成唯一 request_id，注入到 response header 和日志上下文
- [ ] 0.2 实现统一错误响应格式：全局 ExceptionFilter，输出 `{ error: { code, message, details }, meta: { request_id } }`
- [ ] 0.3 实现统一分页 DTO：page/per_page/sort 参数解析 + 响应 meta.pagination 格式
- [ ] 0.4 实现 X-Idempotency-Key 中间件：Redis 存储（TTL=24h），重复 key 返回 200 + X-Idempotent-Replayed: true
- [ ] 0.5 实现通用 API rate limit guard：支持按 user 和按 IP 两种模式，配置项：public API 600 req/min/user、Admin API 300 req/min/user（login 单独 10 req/min/IP 在 Auth 模块实现）

### 0.T Request Infrastructure Tests

- [ ] 0.T1 统一响应格式测试：成功响应 `{ data, meta: { request_id } }`，错误响应 `{ error: { code, message }, meta: { request_id } }`，request_id 从 AsyncLocalStorage 正确获取
- [ ] 0.T2 分页 DTO 测试：默认值（page=1, per_page=20, sort=-created_at），边界值（page=0 → 422, per_page > 100 → 422），排序方向解析（`-created_at` → DESC, `created_at` → ASC），响应 meta.pagination 含 page/per_page/total/has_next
- [ ] 0.T3 幂等性中间件测试：首次请求正常处理返回 200，重复 key 返回 200 + `X-Idempotent-Replayed: true` header，不同 key 独立处理，无 key 的请求跳过幂等检查，key 格式校验（UUID）
- [ ] 0.T4 Rate limit guard 测试：正常请求通过并返回 `X-RateLimit-Limit/Remaining/Reset` headers，超限返回 429 + RATE_LIMITED 错误码，不同用户独立计数（user 模式），不同 IP 独立计数（IP 模式），计数窗口滑动重置

## 1. Database Migration

- [ ] 1.1 创建 Stage 1 Drizzle migration：tenants, users（含 password_hash, role, last_login_at）, groups, group_members, spaces（含 description, status）, space_permissions, model_configs, sessions（含 last_used_at）, audit_logs, permission_versions, system_settings 表及所有索引
- [ ] 1.2 创建 seed 脚本：默认 tenant + admin 用户（邮箱/密码从环境变量 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 读取），幂等执行
- [ ] 1.3 在 packages/shared 中定义 Drizzle schema 文件（TypeScript schema-first），导出所有 Stage 1 表的 Drizzle table 定义和 Zod validation schema

### 1.T Database Migration Tests

- [ ] 1.T1 Schema 完整性测试：users 含 password_hash/role/last_login_at 列，spaces 含 description/status 列，sessions 含 last_used_at 列，permission_versions 和 system_settings 表存在
- [ ] 1.T2 Seed 幂等性测试：seed 脚本首次运行创建默认 tenant + admin 用户，第二次运行不报错且不创建重复数据
- [ ] 1.T3 Zod schema 验证测试：合法输入通过验证（完整 user/space/model_config 对象），非法输入被拒绝（空 email、缺少 tenant_id、无效 role 等），导出类型与 Drizzle table 定义一致
- [ ] 1.T4 tenant_id 覆盖测试：验证所有核心业务表的 Drizzle schema 都包含 notNull 的 tenant_id 字段

## 2. Audit Infrastructure（前置，所有审计依赖）

- [ ] 2.1 创建 AuditModule：实现 AuditService（内存队列 + 每 1s 或满 50 条 flush 到 DB + graceful drain）
- [ ] 2.2 创建 NestJS AuditInterceptor：自动捕获标记了 @Audited() 的请求，推入 AuditService 队列
- [ ] 2.3 定义审计事件常量枚举：auth.login, auth.logout, auth.token_refresh, auth.failed_login, auth.password_change, auth.session_revoke, admin.user.create, admin.user.update, admin.user.disable, admin.group.create, user.group_change, space.create, space.update, space.permission_change, admin.model.create, admin.model.update, admin.model.test

### 2.T Audit Infrastructure Tests

- [ ] 2.T1 AuditService 队列测试：push 事件到队列后 1s 内 flush 到 DB mock，满 50 条提前 flush，空队列不产生 DB 调用
- [ ] 2.T2 AuditService graceful drain 测试：onModuleDestroy 时 flush 队列中所有剩余事件
- [ ] 2.T3 @Audited() 装饰器 + AuditInterceptor 测试：标记了 @Audited('action') 的 controller 方法被拦截并推入审计队列，未标记的方法不触发审计
- [ ] 2.T4 审计事件枚举完整性测试：验证 17 种必记事件全部定义，枚举值无拼写错误
- [ ] 2.T5 审计日志 request_id 关联测试：审计条目包含来自 AsyncLocalStorage 的 request_id
- [ ] 2.T6 审计日志敏感信息排除测试：push 含 password/token 字段的 metadata 时，这些字段被 sanitize 或剥离

## 3. Auth Core (packages/auth-core)

- [ ] 3.1 实现 argon2id 密码哈希工具（hash / verify），fallback bcrypt 支持
- [ ] 3.2 实现 JWT 签发与校验工具（access_token 签发含 sub/tenant_id/email/role/group_ids/iat/exp，refresh_token 签发含 session_id）；JWT payload 显式排除 password_hash 等敏感字段
- [ ] 3.3 实现 NestJS JwtAuthGuard：从 Authorization header 解析 access_token，校验签名和过期，注入 user context 到 request
- [ ] 3.4 实现 NestJS RbacGuard + @Permissions() 装饰器：根据用户 role 和 Group → space_permissions 查询判断是否有指定权限
- [ ] 3.5 实现 permission_version 缓存逻辑：Redis 缓存 key = `tenant_id:user_id:user_pv:space_id:space_pv:query_hash`，TTL 60s，permission 变更时 increment + 发布 Redis Pub/Sub 事件
- [ ] 3.6 实现 Redis Pub/Sub 订阅端：API 实例启动时订阅 permission_changed / user_permission_changed 事件，收到后清理本地 + Redis 缓存

## 4. Auth Module (apps/api)（依赖 0.x, 1.x, 2.x, 3.x）

- [ ] 4.1 创建 AuthModule：注入 AuthService, SessionService, JwtService
- [ ] 4.2 实现 POST /api/auth/login：邮箱密码校验 → 创建 session → 签发 token pair → 更新 users.last_login_at → 记录 auth.login 审计；失败时记录 auth.failed_login 审计
- [ ] 4.3 实现登录失败锁定：Redis 计数器（key=`login_fail:{email}`，TTL=15min），达到 5 次返回 ACCOUNT_LOCKED；成功登录重置计数器
- [ ] 4.4 实现登录 rate limit：Redis 滑动窗口（key=`login_rate:{ip}`），10 req/min/IP，超限返回 429
- [ ] 4.5 实现 POST /api/auth/refresh：校验 refresh_token → 轮换 token pair → 失效旧 session → 更新 sessions.last_used_at → 记录 auth.token_refresh 审计
- [ ] 4.6 实现 POST /api/auth/logout：标记 session revoked_at → 记录 auth.logout 审计
- [ ] 4.7 实现 GET /api/auth/me：返回用户 profile 含 id/email/display_name/role/groups(id+name)/spaces(id+name+role)
- [ ] 4.8 实现 POST /api/auth/password/change：校验旧密码 → argon2id hash 新密码 → 强度校验（min 8 chars, letter+number+symbol） → 记录 auth.password_change 审计
- [ ] 4.9 实现 GET /api/auth/sessions：返回当前用户的活跃会话列表含 id/ip/user_agent/created_at/last_used_at/is_current
- [ ] 4.10 实现 DELETE /api/auth/sessions/{session_id}：校验归属（非本人返回 404） → 撤销会话 → 记录 auth.session_revoke 审计

## 5. User & Group Module (apps/api)（依赖 0.x, 1.x, 2.x, 3.x）

- [ ] 5.1 创建 UserModule + GroupModule：注入对应 Service 和 Repository
- [ ] 5.2 实现 GET /api/admin/users：分页 + 过滤（role/status/search），admin:user_manage Guard
- [ ] 5.3 实现 POST /api/admin/users：创建用户（password_hash via argon2id） + 关联 Groups + 幂等（X-Idempotency-Key） + 记录 admin.user.create 审计
- [ ] 5.4 实现 PATCH /api/admin/users/{user_id}：更新 display_name/role + 记录 admin.user.update 审计 + USER_NOT_FOUND 错误码
- [ ] 5.5 实现用户 disable：PATCH status=disabled → 撤销所有 sessions → 记录 admin.user.disable 审计；re-enable 记录 admin.user.update
- [ ] 5.6 实现 GET /api/admin/groups：分页列表含 member_count 和 space permissions
- [ ] 5.7 实现 POST /api/admin/groups：创建 Group + 添加成员 + 关联 space_permissions + increment permission_version + 写 permission_versions 行 + 记录 admin.group.create 审计
- [ ] 5.8 实现 PUT /api/admin/groups/{group_id}：更新 Group（name/成员增删/space_permissions 变更）+ increment 受影响的 users/groups/spaces permission_version + 发布 Redis 事件 + 写 permission_versions 行 + 记录 user.group_change 和 space.permission_change 审计
- [ ] 5.9 实现 GET /api/spaces/{space_id}/permissions：列出 Space 的 Group 权限列表，space:admin Guard
- [ ] 5.10 实现 PUT /api/spaces/{space_id}/permissions：全量覆盖 Space 的 Group 权限 → increment spaces.permission_version → 写 permission_versions 行 → 发布 Redis 事件 → 记录 space.permission_change 审计

## 6. Space Module (apps/api)（依赖 0.x, 1.x, 2.x, 3.x）

- [ ] 6.1 创建 SpaceModule：注入 SpaceService, SpaceRepository
- [ ] 6.2 实现 GET /api/spaces：基于当前用户 Group 权限过滤，仅返回有 space:view 的 Spaces + 分页 + 搜索
- [ ] 6.3 实现 POST /api/spaces：创建 Space + 自动生成 wiki_repo_path=/data/wiki/{space_id} + 设置默认 strict_knowledge_only=true, status=active + 幂等 + 记录 space.create 审计
- [ ] 6.4 实现 GET /api/spaces/{space_id}：权限校验（无权限返回 404 而非 403）+ 返回详情含 description/status/config + stats 占位（page_count=0 等）
- [ ] 6.5 实现 PATCH /api/spaces/{space_id}：space:admin 权限 + 更新 name/description/strict_knowledge_only/graphify_config + 忽略 wiki_repo_path 修改 + slug 冲突校验 + 记录 space.update 审计
- [ ] 6.6 实现 GET /api/spaces/{space_id}/stats：space:view 权限 + 返回占位统计（Stage 1 全部为 0）

## 7. Model Config Module (apps/api)（依赖 0.x, 1.x, 2.x, 3.x）

- [ ] 7.1 创建 ModelConfigModule：注入 ModelConfigService
- [ ] 7.2 实现 GET /api/admin/models：列表返回统一字段（id/name/provider/model_type/status/config/visible_group_ids），name 映射 display_name，status 映射 enabled
- [ ] 7.3 实现 POST /api/admin/models：创建 + unique(tenant_id, provider, model_id) 校验 + 单 embedding 模型约束 + SECRET_NOT_FOUND 校验 + 记录 admin.model.create 审计
- [ ] 7.4 实现 PATCH /api/admin/models/{model_id}：更新 + 启用第二个 embedding 模型时拒绝 + MODEL_NOT_FOUND 错误码 + 记录 admin.model.update 审计
- [ ] 7.5 实现 POST /api/admin/models/{model_id}/test：从 encrypted_api_key_ref 解引用（SECRET_NOT_FOUND 如解引用失败） → 发送探测请求 → 返回 reachable/latency/error → MODEL_NOT_FOUND 校验 → 记录 admin.model.test 审计

## 8. Health & Audit Query Module (apps/api)（依赖 2.x）

- [ ] 8.1 实现 GET /api/admin/audit-logs：分页 + 过滤（actor/action/space/time_range），admin:audit_view Guard
- [ ] 8.2 实现 GET /api/admin/system/health：检查 DB/Redis/MinIO 连通性 + 未部署组件（vector_store/graph_store/docmost_bridge）返回 not_configured + 返回各组件状态、延迟、队列深度占位

## 9. Admin Console Frontend (apps/web)（依赖 4-8 API 完成）

- [ ] 9.1 实现登录页（/login）：邮箱密码表单 + 错误提示（区分 INVALID_CREDENTIALS/ACCOUNT_LOCKED/ACCOUNT_DISABLED） + 登录成功后存储 token 并跳转首页
- [ ] 9.2 实现前端 Auth Context：access_token 管理、自动 refresh（token 过期前 5min 触发）、401 跳转登录
- [ ] 9.3 实现前端路由守卫：Admin 路由 /admin/* 仅 Admin/Owner 角色可访问，非授权跳转 403 页面
- [ ] 9.4 实现 Admin 布局框架：侧边栏导航（Users/Groups/Spaces/Models/Audit Logs/System Health）
- [ ] 9.5 实现用户管理页面：用户列表表格 + 搜索/过滤 + 创建用户 Modal + 编辑/disable 操作
- [ ] 9.6 实现 Group 管理页面：Group 列表 + 创建 Group（含成员选择和 Space 权限分配）+ 编辑 Group（增删成员/修改权限）
- [ ] 9.7 实现 Space 管理页面：Space 列表 + 创建 Space + Space 详情（含 strict_knowledge_only 开关）+ Space 权限管理（Group 授权/撤权）
- [ ] 9.8 实现模型管理页面：模型列表 + 添加模型 + 编辑模型 + enable/disable 切换 + Test 连通性按钮
- [ ] 9.9 实现审计日志页面：日志表格 + action/actor/space/时间范围 过滤器
- [ ] 9.10 实现系统健康页面：组件状态卡片（DB/Redis/MinIO + 未配置组件灰色显示），从 /api/admin/system/health 获取

## 10. Testing

- [ ] 10.1 auth-core 单元测试：argon2 hash/verify、JWT 签发/校验/过期、JWT payload 不含密码等敏感字段（负面测试）、RbacGuard 权限判断、permission_version 缓存 miss/hit
- [ ] 10.2 Auth API 集成测试：login 成功（含 last_login_at 更新）/失败（含 auth.failed_login 审计）/锁定（含计数重置）/rate_limit、refresh 成功（含 auth.token_refresh 审计）/过期/已撤销、logout、me、password change（含强度校验）、session CRUD
- [ ] 10.3 User/Group API 集成测试：用户 CRUD（create/list/update/disable）+ 幂等 + 重复邮箱 + 权限校验 + disable 联动 session 撤销；Group CRUD（create/list/update 含成员增删和权限变更）+ 重复 Group 名 + user.group_change 审计验证 + space.permission_change 审计验证
- [ ] 10.4 Space API 集成测试：创建/查询/更新/stats + 权限过滤（用户只看到有权限的 Space）+ slug 冲突 + 无权限返回 404 + wiki_repo_path 不可修改 + Space 权限 CRUD（GET/PUT /permissions）
- [ ] 10.5 Model Config API 集成测试：CRUD + 单 embedding 约束 + 连通性测试 mock + MODEL_NOT_FOUND/SECRET_NOT_FOUND 错误码 + admin.model.test 审计
- [ ] 10.6 Audit API 集成测试：写入和查询 + 过滤 + 异步写入验证（2s 内出现）+ 全部 17 种必记事件至少各出现一次
- [ ] 10.7 权限撤权即时生效测试：授权 → 查询成功 → 通过 PUT /api/spaces/{id}/permissions 撤权 → 5s 内查询失败 → permission_versions 行已插入
- [ ] 10.8 审计安全测试：验证审计日志中不含密码、API key、access_token、refresh_token
- [ ] 10.9 Admin Console E2E 冒烟测试：登录 → 访问各管理页面 → 用户/Group/Space 基本 CRUD → 权限变更 → 模型管理 → 审计日志查看

## 11. Documentation & Configuration

- [ ] 11.1 更新 docs/project/26_需求追踪矩阵.md：确认 Stage 1 所有行的 API/Schema/测试列已填写；补充新增端点（PATCH users、PUT groups、GET/PUT space permissions、GET space stats）
- [ ] 11.2 更新 Docker Compose：确保 Redis 服务配置正确，apps/api 环境变量含 JWT_SECRET/ADMIN_EMAIL/ADMIN_PASSWORD
- [ ] 11.3 更新 docs/todo.md：标记 I-01 为进行中/完成
- [ ] 11.4 在 docs/ops/env.example 中补充 Stage 1 新增环境变量：JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN, ADMIN_EMAIL, ADMIN_PASSWORD, REDIS_URL
