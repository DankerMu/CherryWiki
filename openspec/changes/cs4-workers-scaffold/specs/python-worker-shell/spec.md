## ADDED Requirements

### Requirement: graphify-worker-skeleton
MUST python graphify-worker 骨架，含 Job API polling 和 Redis lock。

#### Scenario: health 端点
- **WHEN** GET http://localhost:9090/health
- **THEN** 返回 `{ "status": "healthy", "worker": "graphify-worker", "uptime": <seconds> }`

#### Scenario: Job polling
- **WHEN** Worker 运行
- **THEN** 定时轮询 GET /internal/jobs/pending?type=graphify（间隔可配置，默认 5s）

#### Scenario: Redis lock
- **WHEN** 获取到 pending job
- **THEN** 使用 Redis SETNX 获取分布式锁 lock:job:{job_id}（TTL=10min）

#### Scenario: 空 run
- **WHEN** 获取锁成功
- **THEN** 调用空 run() 函数（日志记录 "job received, no-op"），PATCH /internal/jobs/{job_id}/complete

#### Scenario: 锁已占用
- **WHEN** Redis SETNX 返回 false
- **THEN** 跳过该 job，继续 polling

> **参考文档**: docs/engineering/13_开发规范.md §3.1（Python Worker 与 Node.js 协同完整流程）§5（Python Worker 规范）
