## Why

Phase 1 已交付完整的"上传 → Graphify → Canonical Wiki → 索引 → Chat 引用"闭环，但系统缺少协作编辑能力——Wiki 页面只能由 Graphify 自动生成，无法人工修改。Stage 9 将 Fork Docmost 开源版，在其中新增最小化的 Bridge 模块（`/api/internal/bridge/*`），使 Cherry API 可以与 Docmost 互通页面数据和事件通知，为 Stage 10 的双向同步奠定通信基础。

## What Changes

### Docmost Fork 侧（external/docmost/）

- Fork docmost/docmost v0.80.1（commit `980521f`），创建 `cherrygraph-bridge` 分支，以 git submodule 形式引入
- 新增 `apps/server/src/integrations/bridge/` 模块（Bridge NestJS Module）：
  - BridgeAuthGuard：HMAC-SHA256 + Bearer token + timestamp 重放防护
  - Page export controller：GET /api/internal/bridge/pages/{id}/export?format=markdown
  - Page import controller：PUT /api/internal/bridge/pages/{id}/import（overwrite_policy: create_only/update/force）
  - Page events controller：页面保存/删除后 POST Cherry API webhook
  - Attachment events controller：附件创建/删除后 POST Cherry API webhook
  - Sync status controller：GET /api/internal/bridge/spaces/{id}/sync-status + /health
- 修改 app.module.ts 添加 BridgeModule import（仅一行）
- 修改 main.ts excludedPaths 添加 `/api/internal/bridge`（跳过 workspaceId 检查）
- page service 追加 EventEmitter 通知（page.saved / page.deleted，不改原保存逻辑）
- attachment service 追加 EventEmitter 通知（attachment.created / attachment.deleted，不改存储层）
- space service 追加 EventEmitter 通知（space.updated，属性/成员变更时触发）
- Permission projection controller：PUT /api/internal/bridge/spaces/{id}/permissions（接收 Cherry 权限推送）

### Cherry API 侧

- 新增 `apps/api/src/bridge/` 模块：
  - POST /api/internal/docmost/events/page-saved
  - POST /api/internal/docmost/events/page-deleted
  - POST /api/internal/docmost/events/attachment-created
  - POST /api/internal/docmost/events/attachment-deleted
  - POST /api/internal/docmost/events/space-updated
- 新增 Drizzle schema：bridge_events + webhook_deliveries + page_block_metadata（预建 Schema，为 Stage 10 准备）
- BridgeEventService：event_id 幂等去重、事件持久化、delivery 追踪、rate limiting
- Nonce 防重放：Redis SETNX（TTL=10min）+ 双 key 轮换支持
- Cherry 侧 BridgeAuthGuard：验证 Docmost 发来请求的 HMAC 签名

### 基础设施

- Docker Compose 新增 docmost profile 服务（cherry-net 网络内）
- Nginx Phase 2 配置代理 Docmost
- CI 新增 bridge-contract-tests job

## Capabilities

### New Capabilities

- `bridge-docmost-module`: Docmost Fork 内 Bridge NestJS 模块——路由注册、HMAC+Bearer+timestamp+nonce 四重鉴权、excludedPaths 配置、签名工具、双 key 轮换、Docker 网络隔离约束、Fork 红线验收条件
- `bridge-page-export`: Docmost 页面 Markdown 导出——返回 frontmatter + content + content_hash，保留 graphify:managed HTML comment 标记（P2-E3）
- `bridge-page-import`: Docmost 页面 Markdown 导入——支持 overwrite_policy，保留 graphify:managed 标记 round-trip fidelity（P2-E3）
- `bridge-webhooks`: Docmost 生命周期 webhook——5 种事件（page.saved/deleted + attachment.created/deleted + space.updated）POST Cherry API，含 HMAC+nonce 签��� + 快速保存去重（P2-E10）
- `bridge-sync-status`: Bridge 健康状态、同步状态查询、附件下载代理、权限推送端点（PUT permissions）
- `cherry-bridge-receiver`: Cherry API 侧 webhook 接收——HMAC+nonce 验签、event_id 幂等去重、rate limiting、bridge_events 持久化、webhook_deliveries 追踪、完整审计
- `bridge-schema`: Drizzle ORM 表定义——bridge_events + webhook_deliveries + page_block_metadata（预建）+ bridge_nonces（Redis）+ Zod validation + migration
- `bridge-contract-tests`: Bridge 契约测试套件——覆盖 HMAC/nonce/dual-key/导出/导入/marker 保留/5 种事件/重试/去重/sync-status/permissions 共 20+ 场景

### Modified Capabilities

（无——本 Stage 不修改已有 spec 的需求定义）

## Impact

- **Schema**: `packages/shared/src/schema/core.ts` 新增 bridge_events、webhook_deliveries、page_block_metadata 三张表 + 索引 + Zod schema
- **API**: Cherry API 新增 `/api/internal/docmost/events/*`（5 种事件）；Docmost Fork 新增 `/api/internal/bridge/*` 路由组（含 permissions 端点）
- **Web**: 本 Stage 无前端变更
- **依赖**: Docmost Fork 不引入新 npm 依赖（crypto 内置）；Cherry API 侧无新依赖；两侧复用已有 Redis 连接（nonce 存储）
- **权限**: Bridge 接口仅内网服务调用，不经过用户权限系统，由 HMAC+nonce secret 保护 + rate limiting
- **审计**: 新增 bridge.event_received / bridge.event_processed / bridge.hmac_rejected / bridge.nonce_reused / bridge.rate_limited / bridge.outbound_call 审计事件
- **安全**: HMAC-SHA256 + nonce（Redis SETNX）+ timestamp 三重防护、双 key 轮换（24h 窗口）、Docker 网络隔离（cherry-net only，Nginx deny Bridge path）、rate limiting
- **Docker**: docker-compose.yml 新增 docmost profile 服务（不映射 Bridge 端口），Nginx phase2 配置
