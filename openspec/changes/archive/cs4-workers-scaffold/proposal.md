## Why

CherryGraph Studio 有 4 个后台 Worker：ingestion-worker（文件解析）、url-fetcher-worker（URL 抓取 SSRF 沙箱）、graphify-worker（Python Graphify CLI）、indexer-worker（向量/全文索引）。Stage 0 需要建立这些 Worker 的空壳 + 健康检查端点，后续 Stage 3-6 在此基础上填充业务逻辑。

## What Changes

- 创建 3 个 Node.js Worker：apps/ingestion-worker、apps/url-fetcher-worker、apps/indexer-worker
  - 每个含 BullMQ 空 processor + HTTP health 端点（端口 9090）
- 创建 1 个 Python Worker：apps/graphify-worker
  - Job API polling 骨架（GET /internal/jobs/pending?type=graphify）
  - Redis distributed lock 骨架（SETNX）
  - HTTP health 端点（端口 9090）
- 创建 `packages/job-core`：Job 状态枚举、队列名常量、BullMQ 连接工厂

## Capabilities

### New Capabilities
- `node-worker-shell`: Node.js Worker 空壳模板（BullMQ + health）
- `python-worker-shell`: Python graphify-worker 骨架（Job API polling + Redis lock + health）
- `job-core-package`: packages/job-core 公共包（状态枚举、队列名、BullMQ 工厂）

### Modified Capabilities

## Impact

- 新建 apps/ingestion-worker、apps/url-fetcher-worker、apps/indexer-worker、apps/graphify-worker
- 新建 packages/job-core
- 依赖 CS-0（monorepo workspace）
- 可与 CS-1、CS-2、CS-3 并行开发
- Python Worker 需要 Python 3.11+ 环境

### 实现前必读文档

| 文档路径 | 读取重点 |
|---|---|
| `docs/engineering/13_开发规范.md` §3 | 技术栈：Redis + BullMQ（Node.js Worker）、Python 3.11+（graphify-worker） |
| `docs/engineering/13_开发规范.md` §3.1 | **Python Worker 与 Node.js 协同**：轮询 Job API + Redis SETNX lock + PATCH complete |
| `docs/engineering/13_开发规范.md` §5 | Python Worker 规范：JSON 输入输出、timeout、幂等 |
| `docs/engineering/13_开发规范.md` §8 | 任务状态机：pending → running → succeeded/failed/cancelled |
| `docs/ops/docker-compose.skeleton.yml` 各 worker | Worker 环境变量、安全配置（read_only/cap_drop/tmpfs）、health 端口 9090 |
| `docs/requirements/07_模块需求_资料上传归档解析.md` §6.2A | url-fetcher-worker 独立容器要求（SSRF 防护架构保障） |
