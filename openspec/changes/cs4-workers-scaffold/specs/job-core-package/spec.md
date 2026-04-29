## ADDED Requirements

### Requirement: job-constants
MUST packages/job-core 提供 Job 系统公共常量和工厂。

#### Scenario: 队列名常量
- **WHEN** 导入 job-core
- **THEN** 可使用 QUEUE_INGESTION、QUEUE_URL_FETCH、QUEUE_INDEXING、QUEUE_GRAPHIFY_NOTIFY 常量

#### Scenario: Job 状态枚举
- **WHEN** 导入 JobStatus
- **THEN** 枚举含 pending、running、succeeded、failed、cancelled

#### Scenario: BullMQ 连接工厂
- **WHEN** 调用 createBullMQConnection(redisUrl)
- **THEN** 返回可用的 BullMQ IORedis 连接

> **参考文档**: docs/engineering/13_开发规范.md §8（任务状态机）、docs/engineering/13_开发规范.md §3（BullMQ）
