## Context

CherryGraph Studio 有两类 Worker：Node.js Worker（BullMQ 直接消费）和 Python Worker（通过 HTTP Job API + Redis lock 协同）。协同方式在 docs/engineering/13_开发规范.md §3.1 明确定义。所有 Worker 容器必须有安全配置（read_only rootfs、cap_drop ALL），见 docs/engineering/12_权限安全审计.md §5.1。

## Goals / Non-Goals

**Goals:**
- 3 个 Node.js Worker 空壳各自可独立启动
- 1 个 Python Worker 空壳可独立启动
- 每个 Worker 有 /health HTTP 端点（端口 9090）
- packages/job-core 提供队列名常量和 BullMQ 连接工厂
- Python Worker 有 Job API polling + Redis lock 骨架

**Non-Goals:**
- 不实现任何 processor 业务逻辑——由 Stage 3-6 负责
- 不实现 Graphify CLI 调用——由 Stage 5 负责
- 不实现 SSRF 防护逻辑——由 Stage 3 负责
- Worker 容器安全配置（read_only 等）在 CS-5 Docker Compose 中实现

## Decisions

1. **Node.js Worker 框架**：轻量独立进程（非 NestJS），直接使用 bullmq Worker class + 简易 HTTP server（node:http 或 fastify 轻量版）
2. **队列命名**：packages/job-core 定义常量 QUEUE_INGESTION、QUEUE_URL_FETCH、QUEUE_INDEXING、QUEUE_GRAPHIFY_NOTIFY
3. **Python Worker 结构**：
   - main.py：入口，启动 health server + job loop
   - health.py：HTTP health server（端口 9090）
   - job_client.py：轮询 GET /internal/jobs/pending?type=graphify
   - lock.py：Redis SETNX lock(job_id, worker_id, TTL=10min)
   - runner.py：空 run() 占位
4. **Job 状态枚举**：packages/job-core 定义 JobStatus = pending | running | succeeded | failed | cancelled
5. **health 响应**：{ status: "healthy", worker: "<name>", uptime: <seconds> }

## Risks / Trade-offs

- Node.js Worker 不用 NestJS 减少启动时间和资源开销，但缺少 DI——Stage 3+ 如需 DI 可升级
- Python Worker 通过 HTTP 轮询 Job API 有延迟（1-5s poll interval），但避免了跨语言 BullMQ 兼容问题
