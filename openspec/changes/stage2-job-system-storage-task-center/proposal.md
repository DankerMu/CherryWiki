## Why

Stage 1 交付了 Auth/RBAC/Space/Admin 基础，但后续所有核心功能（上传解析 Stage 3、Graphify Stage 5、索引 Stage 6）都需要一个统一的异步任务系统来调度 Worker。当前 `packages/job-core` 仅有队列名常量和状态枚举，缺少完整的 Job 生命周期管理、Worker 协同协议和对象存储封装。Stage 2 是 Phase 1 关键路径上的基础设施层，必须在进入业务 Worker 开发前完成。

## What Changes

- 新增 `jobs` 模块：基于 Drizzle ORM 的 Job CRUD、状态机（pending → running → succeeded/failed/cancelled）、idempotency_key 去重
- 新增 Internal Worker API：5 个内部端点供 Python/Node Worker 拉取任务、上报进度/完成/失败、心跳
- 新增 Worker 分布式锁：Redis SETNX + TTL，崩溃后锁自动过期，任务可重取
- 新增 Worker 心跳机制：超时检测、离线标记、死 Worker 锁释放
- 新增 MinIO StorageService：bucket 自动创建、文件上传/下载、presigned URL、健康检查
- 扩展 `packages/job-core`：完整状态机、BullMQ 队列工厂、Worker 基类
- 新增 User-facing Job API 实现：GET/POST /api/jobs/{id}、GET /admin/jobs
- 新增 Task Center UI：任务列表（按 type/status/space 筛选）、任务详情、取消操作、进度展示

## Capabilities

### New Capabilities

- `job-lifecycle`: Job CRUD、状态机、idempotency_key 去重、retry/timeout/cancel 机制
- `worker-protocol`: Internal Worker API（poll/progress/complete/fail）、Redis 分布式锁、心跳与死 Worker 检测
- `object-storage`: MinIO S3 兼容存储封装，bucket 管理、文件操作、presigned URL、健康检查
- `task-center-ui`: 管理后台任务中心页面，任务列表/筛选/详情/取消/进度

### Modified Capabilities

(无已有 spec 需要修改)

## Impact

- **packages/job-core/**: 从 3 个常量文件扩展为完整 Job 服务层（状态机、队列工厂、Worker 基类）
- **apps/api/**: 新增 `jobs` 模块（controller/service/repository）+ `storage` 模块 + `internal` 模块（Worker API）
- **apps/web/**: 新增 Task Center 页面（列表 + 详情）
- **数据库**: jobs 表 migration（schema.sql 已定义，需生成 Drizzle migration）
- **依赖**: 新增 `@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner`；`bullmq`/`ioredis` 已在 job-core
- **CI**: 已补齐 Redis service（`.github/workflows/ci.yml`）
- **Docker Compose**: Redis/MinIO 服务已存在，无需修改
