## ADDED Requirements

### Requirement: node-worker-template
MUST 3 个 Node.js Worker 空壳：ingestion-worker、url-fetcher-worker、indexer-worker。

#### Scenario: Worker 启动
- **WHEN** 执行 Worker 启动命令
- **THEN** Worker 进程启动，连接 Redis，注册 BullMQ Worker（空 processor）

#### Scenario: health 端点
- **WHEN** GET http://localhost:9090/health
- **THEN** 返回 `{ status: "healthy", worker: "<worker-name>", uptime: <seconds> }`

#### Scenario: 空 processor
- **WHEN** BullMQ 队列收到 job
- **THEN** 空 processor 记录日志 "job received, no-op" 并 complete

#### Scenario: 优雅关闭
- **WHEN** 收到 SIGTERM
- **THEN** Worker 完成当前 job 后退出（graceful shutdown）

> **参考文档**: docs/engineering/13_开发规范.md §3（BullMQ）§8（任务状态机）、docs/ops/docker-compose.skeleton.yml 各 worker 的 WORKER_HEALTH_PORT
