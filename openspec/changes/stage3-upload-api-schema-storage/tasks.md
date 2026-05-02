## 1. Drizzle Schema & Migration

- [ ] 1.1 在 packages/db/src/schema/ 中定义 file_blobs 表 Drizzle schema（id, tenant_id, sha256, size_bytes, mime_type, storage_uri, created_at；UNIQUE(tenant_id, sha256)）
- [ ] 1.2 在 packages/db/src/schema/ 中定义 source_documents 表 Drizzle schema（id, tenant_id, space_id, file_blob_id NULLABLE, filename, uploader_id, source_type, classification, status, parsed_uri, metadata_json, created_at, updated_at；UNIQUE(space_id, file_blob_id) — PostgreSQL UNIQUE 允许多个 NULL）
- [ ] 1.3 更新 schema index.ts 导出新表定义
- [ ] 1.4 生成 Drizzle migration 文件并验证与 docs/schemas/schema.sql 一致
- [ ] 1.5 本地运行 migration 确认可执行

## 2. Upload Repository

- [ ] 2.1 创建 apps/api/src/uploads/ 模块目录结构（module/controller/service/repository）
- [ ] 2.2 实现 FileBlobRepository（create, findByTenantAndSha256, findById）
- [ ] 2.3 实现 SourceDocumentRepository（create, findById, findBySpaceAndBlob, updateStatus, findByFilter 分页查询）
- [ ] 2.4 编写 repository 单元测试

## 3. Upload Service — 核心逻辑

- [ ] 3.1 实现 UploadService.uploadFile：SHA256 计算 → file_blob 去重查询/创建 → quarantine 存储 → source_document 创建(status=uploaded) → Small 文件同步校验(ValidationPipeline) → promote archive → 创建 ingestion Job(type=ingestion, queue_name=ingestion)；Medium/Large 创建 validation Job(type=validation, queue_name=validation)
- [ ] 3.2 实现 UploadService.uploadUrl：URL 格式/协议校验 → source_document 创建（file_blob_id=NULL, source_type=url, status=uploaded）→ url_fetch Job 创建(type=url_fetch, queue_name=url-fetch)
- [ ] 3.3 实现 UploadService.getUpload：查询 source_document 元数据，校验 Space 读权限
- [ ] 3.4 实现 UploadService.getUploadStatus：查询 source_document status + 关联 Job 信息（job_status, progress_percent, error_json）
- [ ] 3.5 实现 UploadService.reprocess：校验 status=parse_failed → 重置 status=uploaded → 创建新 ingestion Job
- [ ] 3.6 实现文件大小分层逻辑：根据 size_bytes 决定 Job priority（≤5MB→50, 5-50MB→100, >50MB→200, >200MB→拒绝）
- [ ] 3.7 实现 UploadService.linkBlob：供 url-fetcher-worker 完成后回填 file_blob_id 到 source_document
- [ ] 3.8 编写 service 单元测试（去重、分层、URL 校验、reprocess 状态检查、竞态 fallback）

## 4. Upload Controller — REST API

- [ ] 4.1 实现 POST /api/spaces/:spaceId/uploads（FileInterceptor + multer，200MB limit，调用 uploadFile 或 uploadUrl）
- [ ] 4.2 实现 GET /api/uploads/:sourceDocumentId（调用 getUpload）
- [ ] 4.3 实现 GET /api/uploads/:sourceDocumentId/status（调用 getUploadStatus）
- [ ] 4.4 实现 POST /api/uploads/:sourceDocumentId/reprocess（调用 reprocess）
- [ ] 4.5 添加 UploadCreateGuard（校验 upload:create 权限）和 UploadReadGuard（校验 upload:read 权限），与 Doc 12 §2.2 权限点对齐
- [ ] 4.6 编写 controller 单元测试（权限校验、参数校验、错误响应码）

## 5. Storage Flow — Quarantine & Archive

- [ ] 5.1 在 StorageService 中添加 uploadToQuarantine 方法（路径: quarantine/{tenant_id}/{space_id}/{upload_id}_{filename}）
- [ ] 5.2 在 StorageService 中添加 promoteToArchive 方法（copy quarantine → archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}_{safe_filename}，delete quarantine）+ 统一 ArchivePathHelper 供 ingestion-worker 和 url-fetcher-worker 使用
- [ ] 5.3 在 StorageService 中添加 deleteQuarantineFile 方法（供清理使用）
- [ ] 5.4 编写 storage flow 单元测试（quarantine 路径生成、archive 路径生成、copy+delete 流程）

## 6. Upload Module 注册

- [ ] 6.1 创建 UploadsModule，注入 StorageService、JobService、FileBlobRepository、SourceDocumentRepository
- [ ] 6.2 在 AppModule 中注册 UploadsModule
- [ ] 6.3 验证模块启动无错误

## 7. 集成测试

- [ ] 7.1 编写文件上传完整流程集成测试：upload → quarantine 存储 → source_document 创建 → Job 创建
- [ ] 7.2 编写 SHA256 去重集成测试（P1-E6）：同文件二次上传返回已有 source_document_id
- [ ] 7.3 编写跨 Space 去重集成测试：同文件不同 Space 上传复用 file_blob，创建独立 source_document
- [ ] 7.4 编写文件大小分层集成测试（P1-E7）：>50MB 文件 Job priority=200
- [ ] 7.5 编写 URL 上传集成测试：URL 提交 → source_document(source_type=url, file_blob_id=NULL) → url_fetch Job
- [ ] 7.6 编写 reprocess 集成测试：parse_failed → reprocess → 新 Job 创建
- [ ] 7.7 编写权限拒绝集成测试：无 upload:create 权限返回 403，Viewer 可 upload:read
- [ ] 7.8 编写 200MB 超限拒绝集成测试：返回 413

## 8. Source Document 生命周期

- [ ] 8.1 实现 SourceDocumentStateMachine：定义状态枚举和合法转换表，非法转换抛 409
- [ ] 8.2 实现 Graphify 触发 handoff：parsed + processing_strategy=immediate → 创建 Graphify Job → graphify_pending
- [ ] 8.3 实现批量上传 batch_id 分配：同 Space 30 秒窗口内上传共享 batch_id
- [ ] 8.4 实现 metadata_json 规范化：按 source-document-lifecycle spec 定义的字段 schema 校验
- [ ] 8.5 实现 validation Job 完成后自动创建 ingestion Job（Medium/Large 文件异步校验流程）
- [ ] 8.6 编写状态机转换单元测试（合法/非法转换、reprocess 重置）
- [ ] 8.7 编写 Graphify handoff 集成测试：immediate→graphify_pending、stash→停留 parsed
- [ ] 8.8 编写 batch_id 合并测试：5 文件 30s 内上传 → 1 个 Graphify run
