## 1. 前置：阅读文档

- [ ] 1.1 阅读 `docs/engineering/13_开发规范.md` §3（BullMQ）§3.1（Python Worker 与 Node.js 协同完整流程）
- [ ] 1.2 阅读 `docs/engineering/13_开发规范.md` §5（Python Worker 规范）§8（任务状态机）
- [ ] 1.3 阅读 `docs/ops/docker-compose.skeleton.yml` 各 worker 服务定义（环境变量、安全配置、WORKER_HEALTH_PORT）
- [ ] 1.4 阅读 `docs/requirements/07_模块需求_资料上传归档解析.md` §6.2A（url-fetcher-worker 独立容器要求）

## 2. packages/job-core

- [ ] 2.1 创建 `packages/job-core/package.json`（name: @cherrygraph/job-core）
- [ ] 2.2 创建 `packages/job-core/src/queues.ts`：队列名常量 QUEUE_INGESTION、QUEUE_URL_FETCH、QUEUE_INDEXING、QUEUE_GRAPHIFY_NOTIFY
- [ ] 2.3 创建 `packages/job-core/src/status.ts`：JobStatus 枚举 pending | running | succeeded | failed | cancelled
- [ ] 2.4 创建 `packages/job-core/src/connection.ts`：createBullMQConnection(redisUrl) 工厂函数
- [ ] 2.5 创建 `packages/job-core/src/index.ts`：统一导出

## 3. Node.js Workers

- [ ] 3.1 创建 `apps/ingestion-worker/package.json`（依赖 bullmq、@cherrygraph/job-core）
- [ ] 3.2 创建 `apps/ingestion-worker/src/main.ts`：启动 BullMQ Worker（QUEUE_INGESTION，空 processor）+ HTTP health server（端口 9090）
- [ ] 3.3 创建 `apps/ingestion-worker/src/health.ts`：GET /health → { status, worker, uptime }
- [ ] 3.4 复制模式创建 `apps/url-fetcher-worker/`（QUEUE_URL_FETCH）
- [ ] 3.5 复制模式创建 `apps/indexer-worker/`（QUEUE_INDEXING）
- [ ] 3.6 每个 Worker 添加 SIGTERM graceful shutdown 处理

## 4. Python Worker (graphify-worker)

- [ ] 4.1 创建 `apps/graphify-worker/pyproject.toml`（Python 3.11+，依赖 redis、httpx、uvicorn 或 aiohttp）
- [ ] 4.2 创建 `apps/graphify-worker/requirements.txt`
- [ ] 4.3 创建 `apps/graphify-worker/src/main.py`：入口，启动 health server + job polling loop
- [ ] 4.4 创建 `apps/graphify-worker/src/health.py`：HTTP health server（端口 9090，返回 { status, worker, uptime }）
- [ ] 4.5 创建 `apps/graphify-worker/src/job_client.py`：轮询 GET /internal/jobs/pending?type=graphify（间隔 5s）
- [ ] 4.6 创建 `apps/graphify-worker/src/lock.py`：Redis SETNX lock:job:{job_id}（worker_id, TTL=10min）
- [ ] 4.7 创建 `apps/graphify-worker/src/runner.py`：空 run() 函数，日志 "job received, no-op"

## 5. 验证

- [ ] 5.1 `pnpm --filter ingestion-worker dev` 启动成功，/health 返回 200
- [ ] 5.2 `pnpm --filter url-fetcher-worker dev` 启动成功，/health 返回 200
- [ ] 5.3 `pnpm --filter indexer-worker dev` 启动成功，/health 返回 200
- [ ] 5.4 `python apps/graphify-worker/src/main.py` 启动成功，/health 返回 200
- [ ] 5.5 BullMQ 连接 Redis 日志确认成功
