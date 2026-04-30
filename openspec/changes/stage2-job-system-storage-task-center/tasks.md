## 1. Job Core Package 扩展

- [ ] 1.1 在 packages/job-core/src/schema.ts 中定义 Drizzle schema（基于 schema.sql jobs 表 + job_events 表）
- [ ] 1.2 实现 JobRepository（CRUD: create/findById/findByFilter/updateStatus）
- [ ] 1.3 实现 JobEventRepository（create event, queryByJobId ordered by created_at ASC）
- [ ] 1.4 实现 JobStateMachine（transition validation，合法转换表，非法转换抛 409）
- [ ] 1.5 实现 Redis 分布式锁（RedisJobLock: acquire/renew/release，Lua 脚本原子性校验 owner）
- [ ] 1.6 实现 BullMQ QueueFactory（创建 Queue/Worker 实例，统一连接配置）
- [ ] 1.7 实现 Node.js Worker 基类（AbstractBullMQWorker: job claim → status sync → completion/failure → event recording）
- [ ] 1.8 实现 TimeoutScanner（定时扫描 locked_at + timeout_seconds 过期任务，标记 failed + 写 timeout_detected 事件）
- [ ] 1.9 更新 index.ts 导出所有新模块
- [ ] 1.10 编写 job-core 单元测试：状态机转换、锁获取/释放/续约/竞态（含 Lua 脚本 non-owner 拒绝）、idempotency_key 去重、timeout 扫描、事件写入

## 2. Drizzle Migration

- [ ] 2.1 生成 jobs + job_events 表 Drizzle migration 文件
- [ ] 2.2 验证 migration 与 schema.sql 定义一致（字段类型/约束/索引，含 idx_jobs_poll 只含 pending）
- [ ] 2.3 本地运行 migration 确认可执行

## 3. API — Jobs 模块（用户端）

- [ ] 3.1 创建 apps/api/src/jobs/ 模块结构（module/controller/service）
- [ ] 3.2 实现 GET /api/jobs/{job_id}（权限：job creator OR Space 有权限，返回含 created_by/payload_json/result_json/error_json 的完整 Job 对象）
- [ ] 3.3 实现 GET /api/jobs/{job_id}/events（查询 job_events 表，返回按 created_at ASC 排序的事件列表）
- [ ] 3.4 实现 POST /api/jobs/{job_id}/cancel（pending 直接 cancelled，running 设 cancel_requested_at 返回 status=running，已 cancelled 幂等返回 200，succeeded/failed 返回 409）
- [ ] 3.5 在 admin 模块追加 GET /api/admin/jobs（分页 + sort + type/status/space_id 筛选，状态词汇: pending/running/succeeded/failed/cancelled）
- [ ] 3.6 编写 jobs controller/service 单元测试

## 4. API — Internal Worker 模块

- [ ] 4.1 创建 apps/api/src/internal/ 模块结构（module/controllers/guard）
- [ ] 4.2 实现 WorkerApiKeyGuard（校验 X-Worker-Key header）
- [ ] 4.3 实现 GET /internal/jobs/pending（按 type 筛选，priority ASC + created_at ASC 排序，limit 参数 1-10）
- [ ] 4.4 实现 PATCH /internal/jobs/{job_id}/progress（校验 worker_id 与锁 owner 一致，写 progress_updated 事件）
- [ ] 4.5 实现 PATCH /internal/jobs/{job_id}/complete（校验 owner，存 result_json，Lua 原子释放锁，写 status_changed 事件，触发状态转换）
- [ ] 4.6 实现 PATCH /internal/jobs/{job_id}/fail（校验 owner，存 error_json，返回 will_retry，触发 retry 或标记 failed，写事件）
- [ ] 4.7 实现 POST /internal/workers/heartbeat（记录心跳时间，接受 system_info，返回 cancel_requested 列表）
- [ ] 4.8 实现死 Worker 检测定时任务（3 次心跳缺失 → 释放该 worker 所有锁，写 timeout_detected 事件）
- [ ] 4.9 编写 internal controller/guard 单元测试

## 5. Storage 模块（MinIO/S3）

- [ ] 5.1 添加 @aws-sdk/client-s3 和 @aws-sdk/s3-request-presigner 依赖
- [ ] 5.2 创建 apps/api/src/storage/ 模块结构
- [ ] 5.3 实现 StorageService（upload/download/delete/getPresignedDownloadUrl/getPresignedUploadUrl）
- [ ] 5.4 实现 bucket 启动时自动检查与创建（uploads/archives/graphify-output/wiki-repo）
- [ ] 5.5 实现 storage 健康检查（HEAD bucket probe）并集成到 admin-health
- [ ] 5.6 通过环境变量区分 MinIO（MINIO_ENDPOINT）和 S3（S3_REGION）配置
- [ ] 5.7 编写 storage service 单元测试（mock S3 client）

## 6. Task Center UI

- [ ] 6.1 在 admin 侧边栏添加"任务中心"导航项
- [ ] 6.2 实现任务列表页面（apps/web/src/pages/admin/jobs/index.tsx）：表格、分页、type/status/space 筛选
- [ ] 6.3 实现任务详情页面（apps/web/src/pages/admin/jobs/[jobId].tsx）：状态/进度/事件时间线/created_by/payload_json/result_json/error_json
- [ ] 6.4 实现取消按钮（pending/running 可见，running 时显示"取消中..."，terminal 状态隐藏）
- [ ] 6.5 实现进度条组件（percent + stage 标签，running 时 5s 轮询刷新）
- [ ] 6.6 编写 UI 组件单元测试

## 7. 集成测试

- [ ] 7.1 编写 Worker 完整生命周期集成测试：poll → lock → progress → complete → 事件记录验证 → 后续触发
- [ ] 7.2 编写 Worker 崩溃恢复集成测试：lock 过期 → 任务变 pending → 另一 Worker 可拉取
- [ ] 7.3 编写心跳超时集成测试：缺失 3 次 → Worker 离线 → 锁释放
- [ ] 7.4 编写 MinIO 连通性集成测试：bucket 创建 → 上传 → 下载 → presigned URL → 健康检查
- [ ] 7.5 编写 idempotency_key 去重集成测试
- [ ] 7.6 编写 P1-E9 任务取消集成测试（含 pending 直接取消 + running 异步取消 + 重复取消幂等）
- [ ] 7.7 编写 Lua 锁释放原子性测试：non-owner 释放被拒、owner 释放成功

## 8. CI 与部署验证

- [ ] 8.1 验证 CI Redis service 配置可运行 job-core 测试
- [ ] 8.2 验证 Docker Compose 启动后 Redis/MinIO/API healthcheck 全部通过
- [ ] 8.3 验证 Nginx 不代理 /api/internal/* 路径
- [ ] 8.4 更新 docs/ops/env.example 补充 WORKER_API_KEY 等新增环境变量
