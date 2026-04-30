## 1. 前置：阅读文档

- [x] 1.1 阅读 `docs/engineering/13_开发规范.md` §3（BullMQ）§3.1（Python Worker 与 Node.js 协同完整流程）
- [x] 1.2 阅读 `docs/engineering/13_开发规范.md` §5（Python Worker 规范）§8（任务状态机）
- [x] 1.3 阅读 `docs/ops/docker-compose.skeleton.yml` 各 worker 服务定义（环境变量、安全配置、WORKER_HEALTH_PORT）
- [x] 1.4 阅读 `docs/requirements/07_模块需求_资料上传归档解析.md` §6.2A（url-fetcher-worker 独立容器要求）

## 2. packages/job-core

- [x] 2.1 创建 `packages/job-core/package.json`（name: @cherrygraph/job-core）
- [x] 2.2 创建 `packages/job-core/src/queues.ts`：队列名常量 QUEUE_INGESTION、QUEUE_URL_FETCH、QUEUE_INDEXING、QUEUE_GRAPHIFY_NOTIFY
- [x] 2.3 创建 `packages/job-core/src/status.ts`：JobStatus 枚举 pending | running | succeeded | failed | cancelled
- [x] 2.4 创建 `packages/job-core/src/connection.ts`：createBullMQConnection(redisUrl) 工厂函数
- [x] 2.5 创建 `packages/job-core/src/index.ts`：统一导出

## 3. Node.js Workers

- [x] 3.1 创建 `apps/ingestion-worker/package.json`（依赖 bullmq、@cherrygraph/job-core）
- [x] 3.2 创建 `apps/ingestion-worker/src/main.ts`：启动 BullMQ Worker（QUEUE_INGESTION，空 processor）+ HTTP health server（端口 9090）
- [x] 3.3 创建 `apps/ingestion-worker/src/health.ts`：GET /health → { status, worker, uptime }
- [x] 3.4 复制模式创建 `apps/url-fetcher-worker/`（QUEUE_URL_FETCH）
- [x] 3.5 复制模式创建 `apps/indexer-worker/`（QUEUE_INDEXING）
- [x] 3.6 每个 Worker 添加 SIGTERM graceful shutdown 处理

## 4. Python Worker (graphify-worker)

- [x] 4.1 创建 `apps/graphify-worker/pyproject.toml`（Python 3.11+，依赖 redis、httpx、uvicorn 或 aiohttp）
- [x] 4.2 创建 `apps/graphify-worker/requirements.txt`
- [x] 4.3 创建 `apps/graphify-worker/src/main.py`：入口，启动 health server + job polling loop
- [x] 4.4 创建 `apps/graphify-worker/src/health.py`：HTTP health server（端口 9090，返回 { status, worker, uptime }）
- [x] 4.5 创建 `apps/graphify-worker/src/job_client.py`：轮询 GET /internal/jobs/pending?type=graphify（间隔 5s）
- [x] 4.6 创建 `apps/graphify-worker/src/lock.py`：Redis SETNX lock:job:{job_id}（worker_id, TTL=10min）
- [x] 4.7 创建 `apps/graphify-worker/src/runner.py`：空 run() 函数，日志 "job received, no-op"

## 5. 自动化测试

### 5.1 job-core 测试 (`packages/job-core/src/__tests__/`)
- [x] 5.1.1 队列名常量 QUEUE_INGESTION/QUEUE_URL_FETCH/QUEUE_INDEXING/QUEUE_GRAPHIFY_NOTIFY 已导出
- [x] 5.1.2 JobStatus 枚举包含 pending/running/succeeded/failed/cancelled
- [x] 5.1.3 createBullMQConnection 返回有效连接配置对象

### 5.2 Node Worker 测试 (`apps/ingestion-worker/src/__tests__/` 等)
- [x] 5.2.1 health server 响应 200 + { status, worker, uptime }
- [x] 5.2.2 SIGTERM 处理函数已注册

### 5.3 Python Worker 测试 (`apps/graphify-worker/tests/`)
- [x] 5.3.1 health endpoint 返回 200 + { status, worker, uptime }
- [x] 5.3.2 Redis lock SETNX 成功/失败行为

## 6. 集成验证（手动）

- [x] 6.1 ingestion-worker 启动 + /health 200
- [x] 6.2 url-fetcher-worker 启动 + /health 200
- [x] 6.3 indexer-worker 启动 + /health 200
- [x] 6.4 graphify-worker 启动 + /health 200
