## Why

Stage 1/2 交付了 Auth/RBAC/Space 和异步 Job 系统基础设施。后续 Stage 3-6 的所有知识处理链路（解析→Graphify→Wiki→索引）都从"资料上传"开始。当前系统缺少文件接收、去重、隔离校验和归档的能力，无法启动任何业务 Worker 开发。Upload API + Schema + Storage Flow 是 Stage 3 的地基层，必须先于安全校验管线、ingestion-worker、url-fetcher-worker 和上传中心 UI 完成。

## What Changes

- 新增 `file_blobs` 和 `source_documents` 表的 Drizzle migration（基于 `docs/schemas/schema.sql` 已有定义）
- 新增 Upload 模块（`apps/api/src/uploads/`）：controller / service / repository
- 新增 `POST /api/spaces/{space_id}/uploads` — 文件/URL 上传入口，multipart 接收 + SHA256 计算 + file_blob 创建/去重 + source_document 创建 + Job 下发
- 新增 `GET /api/uploads/{source_document_id}` — 上传元数据查询（filename, mime, sha256, size, status）
- 新增 `GET /api/uploads/{source_document_id}/status` — 处理状态查询（uploaded → archived → parsing → parsed → ...）
- 新增 `POST /api/uploads/{source_document_id}/reprocess` — parse_failed 文件重新解析触发
- 新增 Quarantine → Archive 存储流：上传文件先进 `quarantine/` 隔离区，校验通过后移入 `archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256_filename.ext}`
- 新增文件大小分层策略：Small(≤5MB) high priority / Medium(5-50MB) normal / Large(>50MB) low / >200MB 拒绝
- 新增 SHA256 内容级去重（P1-E6）：同 tenant+sha256 复用 file_blob，同 space+file_blob 复用 source_document
- 上传完成后通过 job-core（Stage 2）创建 ingestion 或 url_fetch Job

## Capabilities

### New Capabilities

- `upload-api`: 文件/URL 上传 REST API 端点，含权限校验、multipart 接收、元数据查询、状态查询、重处理触发
- `upload-storage-flow`: Quarantine 隔离 → 安全校验 → Archive 归档的 MinIO 存储流转，含路径规范和不可变归档原则
- `upload-dedup`: SHA256 内容寻址去重机制，file_blobs 全局去重 + source_documents 按 Space 引用
- `source-document-lifecycle`: source_document 完整状态机、转换规则、metadata_json schema、Graphify 触发 handoff 契约、批量上传合并、权限模型映射、Chat 不可直接检索约束

### Modified Capabilities

(无已有 spec 需要修改)

## Impact

- **apps/api/**: 新增 `uploads` 模块（controller/service/repository），依赖 `storage` 模块（Stage 2）和 `job-core`
- **packages/db/**: 新增 file_blobs + source_documents Drizzle schema 和 migration
- **数据库**: 两张新表 + 索引（idx_file_blobs_tenant_sha256, idx_source_docs_space_blob）
- **MinIO**: 新增 `quarantine` bucket，复用已有 `archives` bucket
- **依赖**: 可能新增 `@fastify/multipart` 或 NestJS multipart 处理；`crypto`（Node 内置）用于 SHA256
- **API 权限**: 上传需要 Space 级 `space:upload` 权限，查询需要 Space 读权限
- **Job 系统**: 上传成功后创建 ingestion/url_fetch Job，依赖 Stage 2 job-core
