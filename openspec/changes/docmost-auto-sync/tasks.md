# Tasks: Docmost Auto Sync

## docmost-workspace-bootstrap

- [ ] 1.1 Docmost Fork: 新增 `workspace-bootstrap.controller.ts`，实现 `POST /api/internal/bridge/bootstrap`，接受 `{ workspaceName, name, email, password }`（与 `CreateAdminUserDto` 对齐），调用 `SignupService.initialSetup()`
- [ ] 1.2 Docmost Fork: `bridge.module.ts` 注册 WorkspaceBootstrapController + `imports: [AuthModule]`（提供 SignupService）
- [ ] 1.3 Docmost Fork: bridge/health 端点返回值增加 `workspace_initialized: boolean` 字段
- [ ] 1.4 Cherry API: 新增 `apps/api/src/bridge/docmost-bootstrap.service.ts`，实现 `bootstrapIfNeeded()`：检查 bridge/health 的 workspace_initialized → 为 false 时调用 bootstrap 端点；失败时 warn 日志，不阻塞启动
- [ ] 1.5 Cherry API: 在 `BridgeModule.onApplicationBootstrap()` 中调用 `bootstrapIfNeeded()`（catch 全部错误）；同时注册定时重试（如 Docmost 启动后）
- [ ] 1.6 `.env.example` 增加 `DOCMOST_ADMIN_EMAIL` 和 `DOCMOST_ADMIN_PASSWORD` 变量说明
- [ ] 1.7 测试（Docmost Fork 端）：
  - [ ] 1.7.1 POST /api/internal/bridge/bootstrap 成功创建 workspace + admin user（验证返回 201 + workspace_id/user_id）
  - [ ] 1.7.2 POST /api/internal/bridge/bootstrap 在 workspace 已存在时返回 409（幂等性）
  - [ ] 1.7.3 POST /api/internal/bridge/bootstrap 缺少必填字段返回 400
  - [ ] 1.7.4 GET /api/internal/bridge/health 返回 workspace_initialized: true/false
  - [ ] 1.7.5 BridgeAuthGuard 拒绝无签名请求
- [ ] 1.8 测试（Cherry API 端）：
  - [ ] 1.8.1 bootstrapIfNeeded() 当 health 返回 workspace_initialized=false 时调用 bootstrap 端点
  - [ ] 1.8.2 bootstrapIfNeeded() 当 health 返回 workspace_initialized=true 时跳过（无调用）
  - [ ] 1.8.3 bootstrapIfNeeded() 当 Docmost 不可达时 warn 日志不抛异常
  - [ ] 1.8.4 onApplicationBootstrap 调用 bootstrapIfNeeded 并 catch 全部错误
  - [ ] 1.8.5 定时重试：首次失败后在下次定时触发时重新尝试

## space-auto-provision

- [ ] 2.1 Docmost Fork: 新增 `space-provision.controller.ts`，实现 `POST /api/internal/bridge/spaces`，接受 `{ name, slug, cherry_space_id }`，使用 SpaceService 创建或查找 Space
- [ ] 2.2 Docmost Fork: `bridge.module.ts` 注册 SpaceProvisionController + `imports: [SpaceModule]`（提供 SpaceService）
- [ ] 2.3 Cherry API: `BridgeQueueService` 增加 `enqueueSpaceProvisionJob({ spaceId, tenantId })` 方法 + `bridge-space-provision` 队列常量
- [ ] 2.4 Cherry API: `SpaceModule` 添加 `imports: [BridgeModule]`，使 BridgeQueueService 可在 SpaceService 中注入
- [ ] 2.5 Cherry API: `SpaceService.createSpace()` 成功后调用 `bridgeQueueService.enqueueSpaceProvisionJob()`
- [ ] 2.6 Wiki-sync worker: `main.ts` 注册 `bridge-space-provision` 队列常量、Queue 实例、Worker 实例，加入 health/shutdown 流程
- [ ] 2.7 Wiki-sync worker: 新增 `space-provision.processor.ts`，消费队列：调用 Docmost Bridge 创建 Space → 更新 `spaces.docmost_space_id`
- [ ] 2.8 Wiki-sync worker: `reconcileOnStartup` 增加 Space 对账：查找 `docmost_space_id = null` 的 active Space → 逐个入队
- [ ] 2.9 测试（Docmost Fork 端）：
  - [ ] 2.9.1 POST /api/internal/bridge/spaces 成功创建 Space（返回 201 + docmost_space_id）
  - [ ] 2.9.2 POST /api/internal/bridge/spaces 已存在 slug 时返回现有 Space（幂等性）
  - [ ] 2.9.3 POST /api/internal/bridge/spaces 缺少必填字段返回 400
- [ ] 2.10 测试（Cherry API 端）：
  - [ ] 2.10.1 SpaceService.createSpace() 成功后 enqueue space-provision job
  - [ ] 2.10.2 BridgeQueueService.enqueueSpaceProvisionJob() 正确入队
- [ ] 2.11 测试（Wiki-sync worker 端）：
  - [ ] 2.11.1 space-provision processor 调用 Bridge 创建 Space → 更新 docmost_space_id
  - [ ] 2.11.2 space-provision processor Bridge 不可达时重试
  - [ ] 2.11.3 reconcileOnStartup 查找 unmapped spaces 并逐个入队

## graphify-docmost-push-trigger

- [ ] 3.1 在 `InternalJobsService.handleGraphifyCompletion()` 中（已有 enqueue 调用处），增加 `spaces.docmost_space_id` 检查：仅在非 null 时 enqueue docmost-push
- [ ] 3.2 确保 InternalJobsService 已注入 SpaceService 或可查询 spaces 表获取 docmost_space_id
- [ ] 3.3 测试：
  - [ ] 3.3.1 Graphify 完成 + docmost_space_id 非 null → enqueueDocmostPushJob 被调用
  - [ ] 3.3.2 Graphify 完成 + docmost_space_id 为 null → enqueueDocmostPushJob 不被调用
  - [ ] 3.3.3 Graphify 失败 → 不 enqueue（无论 docmost_space_id 状态）

## user-permission-sync

- [ ] 4.1 Docmost Fork: 新增 `user-sync.controller.ts`，实现 `POST /api/internal/bridge/users`，接受 `{ email, name, cherry_user_id }`，使用 UserService 查找/创建用户（生成随机密码，关联默认 workspace+group）
- [ ] 4.2 Docmost Fork: `bridge.module.ts` 注册 UserSyncController + `imports: [UserModule, WorkspaceModule]`
- [ ] 4.3 Cherry API: 在用户创建后通过 BridgeQueueService 推入 `bridge-user-sync` 队列；UserModule 添加 `imports: [BridgeModule]`
- [ ] 4.4 Wiki-sync worker: `main.ts` 注册 `bridge-user-sync` 队列 + Worker + health/shutdown
- [ ] 4.5 Wiki-sync worker: 新增 `user-sync.processor.ts`，消费队列调用 Docmost Bridge 创建用户
- [ ] 4.6 **修复权限同步契约不匹配**：Cherry worker 发送 `{ members: [...] }` 格式（admin|writer|reader），Docmost 端点期望 `{ groups: [...], version, source }` 格式（view|edit|admin）。统一为一方：要么 Cherry 侧 `bridge-client.ts` 改为 Docmost 期望的格式，要么 Docmost `permissions.controller.ts` 适配 Cherry 格式
- [ ] 4.7 Cherry API: `bridge-permission-hooks.ts` 当前仅是 helper 函数，未接入任何 mutation 路径。在 `GroupService` 成员变更和 `SpaceService` 权限变更的 commit 后显式调用 `BridgeQueueService.enqueuePermissionSyncJob()`
- [ ] 4.8 Cherry API: `GroupModule` 和 `SpaceModule` 添加 `imports: [BridgeModule]`
- [ ] 4.9 Wiki-sync worker: 修改 `reconcilePermissions` 在 worker 启动时立即执行一次（当前仅 hourly timer）
- [ ] 4.10 测试（Docmost Fork 端）：
  - [ ] 4.10.1 POST /api/internal/bridge/users 创建新用户（返回 201 + docmost_user_id）
  - [ ] 4.10.2 POST /api/internal/bridge/users 已存在 email → 返回现有用户（幂等）
  - [ ] 4.10.3 POST /api/internal/bridge/users 缺少 email → 400
- [ ] 4.11 测试（Cherry API 端）：
  - [ ] 4.11.1 用户创建后 enqueue user-sync job
  - [ ] 4.11.2 GroupService 成员变更后 enqueue permission-sync job
  - [ ] 4.11.3 SpaceService 权限变更后 enqueue permission-sync job
- [ ] 4.12 测试（Wiki-sync worker 端）：
  - [ ] 4.12.1 user-sync processor 调用 Bridge 创建用户
  - [ ] 4.12.2 reconcilePermissions 在启动时立即执行
