## Context

Stage 1 交付了 Auth/RBAC/Space/Admin 基础模块。当前 `packages/job-core` 仅有 4 个队列名常量、1 个状态枚举和 1 个 Redis 连接工厂，不具备生产可用的 Job 调度能力。

Stage 3-7 的所有 Worker（ingestion、url-fetcher、graphify、indexer）都依赖统一 Job 系统来：创建任务、分发到 Worker、追踪进度、处理失败重试、支持取消。同时文件上传和 Graphify 输出需要对象存储（MinIO）。

约束：
- NestJS + Fastify + Drizzle ORM（技术栈已锁定）
- Python Worker 不直接操作 BullMQ，通过 HTTP API + Redis lock 协同
- Node.js Worker 直接消费 BullMQ
- 单租户模式下仍保留 tenant_id 字段（为多租户预留）
- jobs 表 schema 已在 `docs/schemas/schema.sql:165-189` 定义

## Goals / Non-Goals

**Goals:**

- 实现 Job 完整生命周期（创建 → 分发 → 执行 → 完成/失败/取消）
- 支持双协议 Worker：Node.js（BullMQ 直连）+ Python（HTTP poll + Redis lock）
- 提供 MinIO S3 兼容存储的统一封装
- 提供管理后台任务中心 UI
- 保证崩溃安全：Worker 死亡后任务可被重新拉取

**Non-Goals:**

- 不实现具体业务 Worker 逻辑（ingestion/graphify/indexer 在 Stage 3/5/6）
- 不实现任务编排/DAG（当前阶段任务之间的依赖由业务层触发，非 Job 系统管理）
- 不实现 Worker 自动扩缩容
- 不实现跨租户任务调度
- 不实现 MinIO 生命周期策略（Phase 4 运维）

## Decisions

### D1: 双协议 Worker 模型

**选择**: Node.js Worker 直连 BullMQ；Python Worker 通过 HTTP Internal API + Redis SETNX lock。

**备选**: 
- (A) 全部走 BullMQ → Python 缺少稳定的 BullMQ 客户端，跨语言兼容风险大
- (B) 全部走 HTTP poll → Node.js Worker 失去 BullMQ 的自动重试/并发控制/优先级队列优势

**理由**: 开发规范 §3.1 已确定此方案。Python Worker 轮询频率 5s，Redis lock TTL 10min，心跳续约 30s。

### D2: Job 状态机

```
pending ──→ running ──→ succeeded
   │            │
   │            ├──→ failed ──→ (retry) ──→ pending
   │            │
   │            └──→ cancelled
   │
   └──→ cancelled
```

**合法转换**:
- `pending → running`: Worker claim（BullMQ dequeue 或 HTTP poll + lock）
- `pending → cancelled`: 用户取消未开始的任务
- `running → succeeded`: Worker 上报完成
- `running → failed`: Worker 上报失败或超时扫描器标记
- `running → cancelled`: 用户取消 + Worker 检测 cancel_requested
- `failed → pending`: 自动重试（attempt_count < max_attempts）

**非法转换一律拒绝**，返回 409。

### D3: 分布式锁策略

**选择**: Redis SETNX + TTL（单 key `job:lock:{job_id}`）。

**操作**:
- claim: `SET job:lock:{job_id} {worker_id} NX EX 600`（10min TTL）
- renew: `SET job:lock:{job_id} {worker_id} XX EX 600`（仅 owner 可续约）
- release: `DEL job:lock:{job_id}`（仅 owner，用 Lua 脚本保证原子性）
- 超时扫描: 定时任务每 60s 扫描 `locked_at + timeout_seconds < now()` 的任务，标记 failed

**备选**: Redlock 多节点 → Phase 1 单 Redis 不需要，过度设计。

### D4: 对象存储封装

**选择**: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`，封装为 `StorageService`。

**bucket 命名**: `{tenant_id}-{purpose}`，purpose 枚举 = `uploads` | `archives` | `graphify-output` | `wiki-repo`。

**初始化**: 应用启动时检查 bucket 是否存在，不存在则创建（dev 环境自动，prod 需配置）。

**理由**: MinIO 完全兼容 S3 API，使用官方 SDK 确保生产环境可直接切换到 AWS S3 / R2。

### D5: BullMQ 队列分离

4 个独立队列（已在 `packages/job-core/src/queues.ts` 定义）：

| 队列 | 消费者 | 用途 |
|------|--------|------|
| `ingestion` | ingestion-worker (Node.js) | 文件解析 |
| `url-fetch` | url-fetcher-worker (Node.js) | URL 抓取 |
| `indexer` | indexer-worker (Node.js) | 索引构建 |
| `graphify-notify` | cherry-api (Node.js) | Graphify 完成后触发后续流水线 |

**Graphify 任务分发不走 BullMQ**。Python Worker 通过 HTTP poll `GET /internal/jobs/pending?type=graphify` 拉取。创建 Graphify run 时 cherry-api 写入 jobs 记录（status=pending），可选发送 `graphify-notify` 消息作为唤醒通知（降低 poll 延迟），但 Python Worker 的权威任务来源是 HTTP poll 端点，不是 BullMQ。`graphify-notify` 队列的主要用途是 Python Worker 上报完成后 cherry-api 触发 wiki-core 导入和 indexer。

### D5b: Job Events 持久化

新增 `job_events` 表（`schema.sql`），记录每次状态变更和进度上报：

```sql
CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,       -- status_changed | progress_updated | cancel_requested | timeout_detected
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_events_job ON job_events(job_id, created_at);
```

Job progress 不存储在 jobs 表（避免高频更新），而是通过最新 `progress_updated` 事件计算当前进度。`GET /api/jobs/{job_id}/events` 直接查询此表。

### D6: 模块分层

```
packages/job-core/
  ├── src/
  │   ├── schema.ts          # Drizzle schema for jobs table
  │   ├── repository.ts       # JobRepository (CRUD)
  │   ├── state-machine.ts    # transition validation
  │   ├── lock.ts             # Redis distributed lock
  │   ├── queue-factory.ts    # BullMQ queue/worker factory
  │   ├── timeout-scanner.ts  # stale job detector
  │   ├── queues.ts           # queue name constants (existing)
  │   ├── status.ts           # JobStatus enum (existing)
  │   ├── connection.ts       # Redis connection (existing)
  │   └── index.ts            # re-exports

apps/api/src/
  ├── jobs/
  │   ├── jobs.module.ts
  │   ├── jobs.controller.ts      # user-facing: GET /jobs/{id}, POST /jobs/{id}/cancel
  │   ├── jobs.service.ts
  │   └── __tests__/
  ├── internal/
  │   ├── internal.module.ts
  │   ├── internal-jobs.controller.ts  # worker-facing: /internal/jobs/*
  │   ├── internal-workers.controller.ts # worker-facing: /internal/workers/heartbeat
  │   ├── worker-api-key.guard.ts
  │   └── __tests__/
  ├── storage/
  │   ├── storage.module.ts
  │   ├── storage.service.ts      # MinIO S3 wrapper
  │   └── __tests__/
  └── admin/
      └── admin-jobs.controller.ts  # GET /admin/jobs (追加到现有 admin 模块)

apps/web/src/
  └── pages/admin/
      └── jobs/
          ├── index.tsx        # 任务列表
          └── [jobId].tsx      # 任务详情
```

### D7: Internal API 认证

**选择**: `X-Worker-Key` header，值为 `WORKER_API_KEY` 环境变量。通过 NestJS Guard 统一校验。

**备选**: mTLS → Phase 1 复杂度过高。JWT service token → Worker 需要管理 token 刷新，Python Worker 更复杂。

**约束**: Internal API 仅在 Docker 内网可达（Nginx 不代理 `/api/internal/*`）。

## Risks / Trade-offs

- **[Redis 单点]** → Phase 1 单 Redis 实例，宕机影响所有 Worker 锁和 BullMQ。缓解：Redis AOF 持久化 + Docker 自动重启。Phase 4 可升级 Sentinel/Cluster。
- **[HTTP poll 延迟]** → Python Worker 5s 轮询间隔意味着最大 5s 任务分发延迟。对 Graphify（本身运行几分钟）可接受。
- **[锁续约竞态]** → Worker 长时间 GC 暂停可能导致锁过期被其他 Worker 接管。缓解：Worker 执行前检查自己是否仍持有锁；结果上报时用 Lua 脚本原子校验 owner。
- **[MinIO 启动顺序]** → API 启动时 MinIO 可能未就绪。缓解：健康检查已在 Docker Compose 配置，API depends_on MinIO healthy。
