## Context

Phase 1（Stage 0-8）已交付完整的知识生产和消费闭环。Phase 2 引入 Docmost 作为协作编辑层。Stage 9 的任务是建立 Cherry API ↔ Docmost Fork 之间的双向通信通道（Bridge），Stage 10 在此基础上实现双向同步和人工编辑。

当前状态：
- Cherry API 已有完整的 Space/权限/审计/Job 基础设施
- wiki-core 已有 Canonical Wiki Repo、页面版本、发布状态机
- Docmost v0.80.1 是 NestJS + Fastify + Drizzle ORM + React 技术栈（与 Cherry API 同栈）
- Docmost 模块注册在 `apps/server/src/app.module.ts`，非核心集成放 `integrations/`

约束：
- Fork 红线：不改 Docmost 核心编辑器/权限/存储/UI
- 不新增 Docmost Drizzle migration
- 不引入新 npm 依赖到 Docmost Fork
- Cherry API 是权限唯一主数据源

## Goals / Non-Goals

**Goals:**
- Docmost Fork 暴露 Bridge API 供 Cherry 拉取/推送页面
- Docmost 页面/附件生命周期事件可通知 Cherry API
- 双向通信受 HMAC-SHA256 签名保护，防重放
- Cherry 侧 webhook 接收幂等可追踪
- Bridge 契约测试覆盖所有场景，确保 rebase 后可回归

**Non-Goals:**
- 双向同步逻辑（Stage 10）
- 权限映射同步（Stage 10）
- 人工区块保护/候选更新（Stage 10）
- Docmost UI 增强（Cherry Web 旁路面板）
- wiki-sync-worker 实现（Stage 10）
- Markdown ↔ Tiptap round-trip（Stage 10）

## Decisions

### D1: Bridge 模块位置 — `integrations/bridge/`

**选择**: 放在 Docmost 的 `apps/server/src/integrations/bridge/`。

**理由**:
- Docmost 现有非核心集成（如 health）已在 `integrations/` 下
- 独立目录，rebase 冲突风险最低
- 不触及 core/ 目录

**替代方案**:
- 放在 `core/bridge/` — 语义不对，Bridge 不是 Docmost 核心功能
- 独立微服务 — 增加部署复杂度，且需要直接读 Docmost DB

### D2: 事件通知机制 — EventEmitter + HTTP POST

**选择**: Docmost 页面/附件 service 在保存/删除后 emit 内部事件，Bridge 模块监听事件后异步 HTTP POST 到 Cherry API。

**理由**:
- 不改变原保存逻辑，仅追加旁路通知
- 异步 POST 不阻塞用户操作
- 失败不影响 Docmost 本身功能
- NestJS 原生 EventEmitter 无需额外依赖

**替代方案**:
- 同步 POST 在保存链路中 — 阻塞用户体验，Cherry API 不可用时 Docmost 保存失败
- 消息队列（BullMQ）— Docmost 侧不引入 Redis 依赖，过度设计
- 数据库 outbox pattern — 违反"不新增 migration"红线

### D3: 鉴权方案 — HMAC-SHA256 + Bearer + Timestamp + Nonce（三重防护）

**选择**: 双向通信均使用 HMAC-SHA256 签名 + Bearer token + 请求 timestamp + 唯一 nonce（Doc 12 §4B.2 要求的三重防护）。

**理由**:
- HMAC 验证请求完整性和来源身份
- timestamp 窗口（5 分钟）防粗粒度重放
- nonce（UUID）+ Redis SETNX（TTL=10min）防窗口内精确重放
- Bearer token 作为快速预检，HMAC 作为深度验证
- event_id 幂等作为最终兜底
- 无需 mTLS 或 OAuth 复杂度

**签名算法**:
```
payload = timestamp + "\n" + nonce + "\n" + method + "\n" + path + "\n" + body_hash
signature = HMAC-SHA256(secret, payload)
Header: X-Bridge-Signature: sha256=<hex>
Header: X-Bridge-Timestamp: <unix_seconds>
Header: X-Bridge-Nonce: <uuid>
Header: Authorization: Bearer <DOCMOST_BRIDGE_SECRET>
```

**Secret 轮换**: 支持 `DOCMOST_BRIDGE_SECRET_NEXT` 环境变量。验签时先尝试当前 key，失败再尝试 next key。轮换窗口 24h，过渡期内新旧 key 均可验证。

**替代方案**:
- mTLS — 运维复杂度高，内网场景过度
- API Key only — 无重放防护
- JWT — 增加 token 管理复杂度
- 仅 timestamp 无 nonce — Doc 12 §4B.2 明确要求三重防护，5 分钟窗口内仍可重放

### D4: 幂等策略 — event_id 唯一约束

**选择**: 每个 webhook 事件携带 UUID `event_id`，Cherry 侧 bridge_events 表对 event_id 建 UNIQUE 约束，重复插入返回 `deduplicated=true`。

**理由**:
- 简单可靠，利用数据库唯一约束
- 无需分布式锁或 Redis
- 重复请求幂等返回 200，不产生副作用

**替代方案**:
- Redis SET NX 去重 — 额外依赖，TTL 过期后仍可能重复
- 应用层 SELECT + INSERT — 并发竞态

### D5: Cherry 侧 bridge_events 存储 — 独立表 + delivery 追踪

**选择**: Cherry API 侧新增 bridge_events（事件主表）+ webhook_deliveries（投递记录）两张表。

**理由**:
- 事件和投递分离，支持重试追踪
- 可审计每次投递的状态码和延迟
- 为 Stage 10 wiki-sync-worker 提供事件队列

**表结构要点**:
- bridge_events: id, event_id(unique), event_type, source(docmost/cherry), space_id, page_id, payload(jsonb), status(received/processing/processed/failed), received_at, processed_at
- webhook_deliveries: id, bridge_event_id(fk), direction(inbound/outbound), attempt, status_code, response_time_ms, error, created_at

### D6: Docker 网络隔离 — cherry-net 内网通信

**选择**: Docmost 服务加入 cherry-net Docker 网络，Bridge 端口不映射到宿主机。

**理由**:
- Bridge API 仅允许 Cherry API 调用
- 外部无法直接访问 /api/internal/bridge/*
- Nginx 只代理 Docmost 的用户面路由

### D7: Git Submodule 管理

**选择**: `external/docmost/` 作为 git submodule 引用 Fork repo 的 `cherrygraph-bridge` 分支。

**理由**:
- 独立版本控制，rebase 独立于主仓库
- CI 可独立运行 Bridge 契约测试
- 主仓库不包含 Docmost 完整代码

### D8: 快速保存去重 — 2s Debounce Window

**选择**: 同一页面 2 秒内多次保存只发送最后一次的 webhook 事件。

**理由**:
- Docmost 富文本编辑器可能触发高频自动保存
- 避免 Cherry 侧收到大量冗余事件（P2-E10 要求）
- 使用内存 debounce map（pageId → timer），不依赖外部存储

**替代方案**:
- 全部发送让 Cherry 侧去重 — 增加 Cherry 负担和网络流量
- 更长窗口（5s/10s） — 延迟过大，用户感知不到同步

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| Docmost upstream 更新导致 page service 钩子点失效 | Bridge 契约测试 CI 在每次 rebase 后自动运行；钩子点尽量用 EventEmitter 解耦 |
| EventEmitter 异步通知丢失（Docmost 进程崩溃） | Cherry 侧定时 reconcile（Stage 10 实现），本 Stage 容忍短暂丢失 |
| HMAC secret 泄露 | Docker 网络隔离兜底 + rate limiting 纵深防御；secret 从环境变量注入，不入代码；支持双 key 快速轮换 |
| Nonce Redis 不可用 | 降级为仅 timestamp 校验（日志告警），不阻断请求；Redis 恢复后自动恢复三重防护 |
| Docmost 页面 ID 与 Cherry wiki_pages ID 映射 | bridge_events.payload 携带 docmost_page_id，Stage 10 建立映射表 |
| Fork 维护长期成本 | 最小改动原则（仅 integrations/bridge/ + 3 处极小改动），每月 rebase + 手动验收 checklist |
| page_block_metadata 表 Stage 9 预建但无数据写入 | 仅 DDL，无运行时影响；Stage 10 负责写入逻辑 |

## Migration Plan

1. Fork docmost/docmost v0.80.1 到 DankerMu/docmost，创建 cherrygraph-bridge 分支
2. 在 Fork 中开发 Bridge 模块，通过契约测试
3. 主仓库添加 git submodule 引用
4. Cherry API 侧添加 bridge_events/webhook_deliveries migration
5. Docker Compose 添加 docmost profile（默认不启动，`--profile docmost` 启用）
6. Nginx 添加 phase2 配置文件（不影响 phase1 配置）

**回滚**: 移除 submodule 引用，Docker Compose 不启动 docmost profile，Cherry API bridge 模块可独立禁用（环境变量开关）。

## Open Questions

1. Docmost v0.80.1 的 page service 保存钩子点具体在哪个函数？需要读源码确认 EventEmitter 注入位置。
2. Docmost 的 Tiptap JSON 转 Markdown 是否有现成工具函数可复用？特别是 HTML comment node 的处理（graphify:managed markers）。
3. 附件存储是否需要与 Cherry MinIO 统一 bucket，还是 Docmost 自管附件、Bridge 只同步元数据？
4. Redis 连接：Docmost Fork 的 Bridge 是否可复用 Docmost 已有的 Redis 连接（如有），还是需要独立配置 BRIDGE_REDIS_URL？
5. Space service 的 "membership change" 钩子点在哪？需确认 Docmost 是否有 space member 变更事件可供订阅。
