## 1. Docmost Fork Setup

- [ ] 1.1 Fork docmost/docmost v0.80.1 到 DankerMu/docmost，创建 cherrygraph-bridge 分支（基于 tag v0.80.1 / commit 980521f）
- [ ] 1.2 在主仓库添加 git submodule：`git submodule add -b cherrygraph-bridge <fork-url> external/docmost`
- [ ] 1.3 验证 Docmost 本地构建通过（pnpm install + pnpm build）
- [ ] 1.4 在 .env.example 中添加 DOCMOST_BRIDGE_SECRET、DOCMOST_BRIDGE_SECRET_NEXT（可选）和 CHERRY_API_INTERNAL_URL 环境变量

## 2. Bridge Module Skeleton (Docmost Fork)

- [ ] 2.1 创建 `apps/server/src/integrations/bridge/bridge.module.ts`，注册所有 controllers 和 guards；实现 secret 未配置时 503 降级逻辑
- [ ] 2.2 创建 `apps/server/src/integrations/bridge/bridge-signature.ts`，实现 HMAC-SHA256 签名计算与验证（payload 包含 timestamp + nonce + method + path + bodyHash）
- [ ] 2.3 创建 `apps/server/src/integrations/bridge/bridge-auth.guard.ts`，实现 BridgeAuthGuard（Bearer + HMAC + timestamp + nonce Redis SETNX 去重 + 双 key 轮换支持）
- [ ] 2.4 修改 `apps/server/src/app.module.ts` 添加 BridgeModule import（一行）
- [ ] 2.5 修改 `apps/server/src/main.ts` excludedPaths 添加 `/api/internal/bridge`
- [ ] 2.6 创建 `apps/server/src/integrations/bridge/dto/` 目录，定义 Bridge 请求/响应 DTO
- [ ] 2.7 创建 `apps/server/src/integrations/bridge/README.md` 说明 Fork 改动范围、红线约束（§5A-1~4）和 rebase 流程
- [ ] 2.8 验证红线合规：确认所有引用的 Docmost service 均为 public export（PageService/AttachmentService/SpaceService），无私有 API 依赖

## 3. Page Export API (Docmost Fork)

- [ ] 3.1 创建 `page-export.controller.ts`，实现 GET /api/internal/bridge/pages/{docmost_page_id}/export?format=markdown
- [ ] 3.2 实现 Tiptap JSON → GFM Markdown 转换（利用 Docmost 现有 prosemirror/tiptap 工具，不引入新依赖）
- [ ] 3.3 确保转换保留 HTML comments（特别是 `<!-- graphify:managed:* -->` 标记）——P2-E3 要求
- [ ] 3.4 实现 content_hash 计算（SHA256 of Markdown content）
- [ ] 3.5 处理 page not found（404 + BRIDGE_PAGE_NOT_FOUND）

## 4. Page Import API (Docmost Fork)

- [ ] 4.1 创建 `page-import.controller.ts`，实现 PUT /api/internal/bridge/pages/{docmost_page_id}/import
- [ ] 4.2 实现 GFM Markdown → Tiptap JSON 转换（复用/适配 Docmost 内部 parser）
- [ ] 4.3 确保转换保留 HTML comments（`<!-- graphify:managed:* -->` 标记在 Tiptap 中作为 HTML comment node 存储）——P2-E3 要求
- [ ] 4.4 实现 overwrite_policy 逻辑：create_only（409 if exists）/ update（hash check）/ force
- [ ] 4.5 实现 optimistic lock：expected_hash 校验，不匹配返回 409 + BRIDGE_HASH_CONFLICT + current_hash
- [ ] 4.6 实现 frontmatter 解析（提取 metadata，不渲染到 Tiptap body）

## 5. Webhook Event Emitters (Docmost Fork)

- [ ] 5.1 在 page service 保存逻辑后追加 EventEmitter.emit('bridge:page.saved', payload)，不改变原保存流程
- [ ] 5.2 在 page service 删除逻辑后追加 EventEmitter.emit('bridge:page.deleted', payload)
- [ ] 5.3 在 attachment service 上传逻辑后追加 EventEmitter.emit('bridge:attachment.created', payload)
- [ ] 5.4 在 attachment service 删除逻辑后追加 EventEmitter.emit('bridge:attachment.deleted', payload)
- [ ] 5.5 在 space service 属性/成员变更后追加 EventEmitter.emit('bridge:space.updated', payload)
- [ ] 5.6 创建 Bridge event listener service：监听 EventEmitter 事件，异步 POST Cherry API（fire-and-forget）
- [ ] 5.7 实现 webhook HTTP 客户端：带 HMAC+Nonce 签名的 POST 请求、3 次指数退避重试（1s/5s/25s）、失败日志
- [ ] 5.8 实现 event_id 生成（UUID v4）和 payload 组装
- [ ] 5.9 实现同页快速保存去重（2s debounce window，仅发送最新 save 事件）——P2-E10 要求

## 6. Sync Status, Health & Permissions (Docmost Fork)

- [ ] 6.1 创建 `sync-status.controller.ts`，实现 GET /api/internal/bridge/spaces/{docmost_space_id}/sync-status
- [ ] 6.2 创建 GET /api/internal/bridge/health 端点（version + uptime + cherry_api_reachable）
- [ ] 6.3 创建 GET /api/internal/bridge/attachments/{attachment_id}/download 附件下载代理
- [ ] 6.4 实现 cherry_api_reachable 定时探测（60s 间隔 HEAD 请求）
- [ ] 6.5 创建 `permissions.controller.ts`，实现 PUT /api/internal/bridge/spaces/{docmost_space_id}/permissions（接收 Cherry 权限推送，更新 Docmost space 成员可见性）
- [ ] 6.6 实现 pending_events 内存计数器（按 space 统计失败投递数，Bridge 重启归零）

## 7. Cherry API Bridge Schema & Migration

- [ ] 7.1 在 `packages/shared/src/schema/core.ts` 定义 bridge_events 表（Drizzle ORM，event_type 支持 5 种事件）
- [ ] 7.2 在 `packages/shared/src/schema/core.ts` 定义 webhook_deliveries 表（Drizzle ORM + FK cascade）
- [ ] 7.3 在 `packages/shared/src/schema/core.ts` 定义 page_block_metadata 表（Drizzle ORM，为 Stage 10 预建 schema）
- [ ] 7.4 在 `packages/shared/src/schema/validation.ts` 定义 Zod schemas：bridgeEventSchema / webhookDeliverySchema / pageBlockMetadataSchema / bridgeWebhookPayloadSchema / bridgeEventStatusSchema / bridgeEventTypeSchema / blockOwnerSchema
- [ ] 7.5 生成并验证 Drizzle migration 文件（bridge_events + webhook_deliveries + page_block_metadata）
- [ ] 7.6 编写 schema 单元测试（Zod validation round-trip、status/event_type enum、nonce 字段、payload 校验）

## 8. Cherry API Bridge Receiver Module

- [ ] 8.1 创建 `apps/api/src/bridge/bridge.module.ts` 模块结构
- [ ] 8.2 创建 `apps/api/src/bridge/bridge-auth.guard.ts`：验证 Docmost 发来请求的 HMAC 签名（含 nonce 校验 via Redis SETNX + 双 key 轮换）
- [ ] 8.3 创建 `apps/api/src/bridge/bridge-event.service.ts`：event_id 幂等去重（UNIQUE 约束 catch）、事件持久化、delivery 记录
- [ ] 8.4 创建 `apps/api/src/bridge/bridge-event.controller.ts`：POST /api/internal/docmost/events/page-saved
- [ ] 8.5 添加 POST /api/internal/docmost/events/page-deleted 端点
- [ ] 8.6 添加 POST /api/internal/docmost/events/attachment-created 端点
- [ ] 8.7 添加 POST /api/internal/docmost/events/attachment-deleted 端点
- [ ] 8.8 添加 POST /api/internal/docmost/events/space-updated 端点
- [ ] 8.9 实现 webhook_deliveries 记录（direction=inbound, status_code, response_time_ms）
- [ ] 8.10 实现 rate limiting（per-IP 100/min、per-space 200/min、global 1000/min，超限返回 429）
- [ ] 8.11 实现审计日志：bridge.event_received / bridge.event_processed / bridge.hmac_rejected / bridge.nonce_reused / bridge.rate_limited / bridge.outbound_call
- [ ] 8.12 编写 Cherry 侧 Bridge service 单元测试（幂等去重、HMAC+nonce 验证、双 key 轮换、delivery 记录、rate limit、审计）

## 9. Infrastructure

- [x] 9.1 Docker Compose 添加 docmost 服务定义（profile=docmost，cherry-net 网络，依赖 postgres + redis；**不映射 Bridge 端口到宿主机**）
- [x] 9.2 创建 `docs/ops/nginx.phase2.conf.example` 添加 Docmost 用户面代理（/docmost/ → docmost:3000），**显式 deny /api/internal/bridge/ 外部访问**
- [x] 9.3 更新 `docs/ops/env.example` 添加 DOCMOST_BRIDGE_SECRET、DOCMOST_BRIDGE_SECRET_NEXT 和相关配置
- [x] 9.4 更新 `docs/ops/docker-compose.skeleton.yml` 或主 compose 文件
- [x] 9.5 验证 Docker 网络隔离：Bridge 端口不出现在 docker-compose ports 映射中（添加检查脚本或 CI lint）

## 10. Contract Tests

- [ ] 10.1 在 Docmost Fork 创建 `apps/server/src/integrations/bridge/__tests__/` 测试目录
- [ ] 10.2 编写 HMAC 鉴权契约测试（valid/invalid/missing Bearer/expired timestamp/nonce reused/nonce missing/dual-key rotation — 7 个场景）
- [ ] 10.3 编写 page export 契约测试（成功导出 + 404 + hash 稳定性 + graphify:managed marker 保留）
- [ ] 10.4 编写 page import 契约测试（create_only/update/force/conflict + graphify:managed marker round-trip）
- [ ] 10.5 编写 webhook 投递契约测试（mock Cherry API，验证 page.saved/page.deleted/attachment.created/attachment.deleted/space.updated 5 种事件 payload）
- [ ] 10.6 编写 webhook 重试契约测试（mock 先返回 503 再返回 200，验证重试行为）
- [ ] 10.7 编写快速保存去重契约测试（同页 1s 内保存两次，mock 只收到 1 个事件）——P2-E10
- [ ] 10.8 编写幂等契约测试（重复 event_id 验证）
- [ ] 10.9 编写 sync-status + health 契约测试（健康/降级/404 场景）
- [ ] 10.10 编写 permissions 端点契约测试（成功/400/404 场景）
- [x] 10.11 在 Cherry API 侧编写 bridge receiver 集成测试（`apps/api/src/bridge/__tests__/`，含 rate limit 测试）
- [x] 10.12 创建 `.github/workflows/bridge-contract-tests.yml` CI 配置（cherrygraph-bridge 分支推送触发，含 Redis + PostgreSQL + Cherry receiver 契约测试）

## 11. Documentation & Alignment

- [x] 11.1 更新 `docs/project/26_需求追踪矩阵.md` Phase 2 追踪表，填充 Stage 9 测试列（P2-E5/E6/E7 部分覆盖，标注 Stage 归属）
- [x] 11.2 更新 `docs/schemas/openapi-bridge.yaml` 添加 Bridge internal API 定义（5 种 webhook 事件）
- [x] 11.3 更新 `docs/schemas/schema.sql` 添加 bridge_events / webhook_deliveries / page_block_metadata DDL
- [x] 11.4 验证 Stage 9 开工门禁：需求/API/Schema/测试四列无空
- [x] 11.5 创建 rebase 手动验收 checklist（Doc 22 §7.3：Docmost 前端 CRUD、附件上传、Cherry Chat 端到端同步、权限变更可见性）
- [x] 11.6 创建 Stage 9 回滚方案文档（Doc 22 §8 五步流程：回退 submodule → Docmost 只读 → 暂停回写 → 用旧索引 → reconcile）
