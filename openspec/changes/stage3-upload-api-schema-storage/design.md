## Context

Stage 2 已交付 Job 系统（job-core、Worker 协议、BullMQ 队列）和 MinIO 对象存储封装（StorageService）。当前 `apps/api/src/` 已有 auth/spaces/jobs/storage/internal 等模块，遵循 NestJS module/controller/service 分层。数据库使用 Drizzle ORM，schema 定义在 `packages/db/`，migration 通过 `drizzle-kit` 生成。

`docs/schemas/schema.sql` 已定义 `file_blobs`（SHA256 content-addressable）和 `source_documents`（per-Space 引用）两张表，但尚未生成 Drizzle schema 和 migration。MinIO 已有 uploads/archives 等 bucket 配置，StorageService 已封装 upload/download/presignedUrl。

Stage 3 的 Upload API 是整个知识处理链路的入口：文件上传 → 隔离校验 → 归档 → 解析 → Graphify。本 change 仅覆盖 API 层 + 存储流转，安全校验管线（MIME/magic bytes/ZIP）由后续 change 实现。

## Goals / Non-Goals

**Goals:**

- 提供完整的文件上传 REST API，支持 multipart file 和 URL 两种上传方式
- 实现 file_blobs + source_documents 的 Drizzle schema 和 migration
- 实现 Quarantine → Archive 两阶段存储流转
- 实现 SHA256 内容级文件去重（file_blobs 层）和 Space 级引用去重（source_documents 层）
- 实现文件大小分层，不同大小的文件分配不同优先级的 Job
- 上传完成后创建 ingestion 或 url_fetch Job（通过 Stage 2 的 job-core）

**Non-Goals:**

- 安全校验逻辑（MIME 验证、magic bytes、ZIP 解压安全）— 由 stage3-security-validation change 实现
- ingestion-worker 解析逻辑 — 由 stage3-ingestion-worker change 实现
- url-fetcher-worker 抓取逻辑 — 由 stage3-url-fetcher-worker change 实现
- 上传中心前端 UI — 由 stage3-upload-center-ui change 实现
- 病毒扫描、DLP — Phase 2 范围

## Decisions

### D1: Upload 模块结构

**选择**: 在 `apps/api/src/uploads/` 下创建独立 NestJS 模块，包含 controller/service/repository，与现有 spaces/jobs 模块平行。

**理由**: 保持与现有 auth/spaces/jobs 等模块一致的分层结构。Upload 有独立的业务逻辑（去重、存储流转、Job 创建），不适合塞进 spaces 模块。

**替代方案**: 作为 spaces 子模块 — 但上传资料的生命周期跨越多个 Space 操作，独立模块更清晰。

### D2: Multipart 文件接收

**选择**: 使用 NestJS 内置 `@UseInterceptors(FileInterceptor)` + `multer`，配置内存存储（memoryStorage）+ 200MB 大小限制。

**理由**: NestJS 原生支持，无需额外依赖。Small 文件（≤5MB）在内存中完成 SHA256 计算后直接写入 MinIO。Medium/Large 文件同样先接收到内存再流式写入（200MB 限制保证内存安全）。

**替代方案**: `@fastify/multipart` streaming — 但当前项目使用 Express adapter，不需要切换。

### D3: SHA256 去重策略

**选择**: 两层去重。

1. **file_blobs 层**（内容去重）：`tenant_id + sha256` UNIQUE 约束。上传时先计算 SHA256，查询是否已存在。存在则复用 file_blob_id，不重复存储文件到 MinIO。
2. **source_documents 层**（引用去重）：`space_id + file_blob_id` UNIQUE 约束。同一 Space 对同一文件的重复上传返回已有 source_document。

**理由**: 内容级去重节省存储，引用级去重避免同 Space 出现重复条目。跨 Space 上传相同文件共享存储但各自有独立的 source_document 记录。

### D4: Quarantine → Validate → Archive 流程与统一路径约定

**选择**:

上传流程严格按序执行：**上传 → quarantine → 安全校验 → archive → 创建 ingestion Job**。

- Quarantine 路径: `quarantine/{tenant_id}/{space_id}/{upload_id}_{filename}`
- Archive 统一路径约定（跨 change 共用）:
  - 原文件: `archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}_{safe_filename.ext}`
  - 元数据: `archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}.metadata.json`
  - 解析产物: `archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}.parsed.md`
  - 预览: `archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}.preview.txt`
  - URL 快照: `archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}_{safe_hostname}.snapshot`

安全校验时序：
- **Small 文件（≤5MB）**: API 进程同步执行 ValidationPipeline，通过后 promote archive，然后创建 ingestion Job
- **Medium/Large 文件（>5MB）**: 创建 `validation` 类型 Job（非 ingestion），由 API 进程或独立校验 worker 异步执行校验。校验通过 promote archive 后再创建 ingestion Job
- **关键约束**: ingestion-worker 只处理已在 archive 中的文件，绝不读取 quarantine

**理由**: 隔离区保证未校验的文件不会被 ingestion-worker 误取。统一路径约定消除跨 change 不一致（与 Doc 07 §4.2 对齐）。校验在 archive 之前执行，保证 archive 中的文件全部安全。

### D5: URL 上传处理

**选择**: URL 上传走同一个 `POST /api/spaces/{space_id}/uploads` 端点，通过 `source_type` 字段区分。URL 上传时不创建 file_blob（尚无文件内容），创建 source_document 时 `file_blob_id=NULL`（schema 已修改为 nullable），`status=uploaded, source_type=url`，然后创建 `url_fetch` 类型的 Job。url-fetcher-worker 抓取完成后回填 file_blob_id。

**Schema 修正**: `source_documents.file_blob_id` 改为 nullable。约束：仅 `source_type=url AND status IN (uploaded, fetching)` 时可为 NULL。抓取完成后 file_blob_id 必须非空。`UNIQUE(space_id, file_blob_id)` 约束需改为 partial index 或应用层校验（PostgreSQL UNIQUE 允许多个 NULL）。

**理由**: 统一入口简化前端调用。URL 抓取是异步的，file_blob 在抓取完成后才能创建。nullable 解决了 schema 与 URL 流程的冲突。

### D7: Job 类型与队列契约

**选择**:

| 场景 | Job type | queue_name | priority | payload_json |
|---|---|---|---|---|
| 文件上传校验（Small 同步，跳过 Job） | — | — | — | — |
| 文件上传校验（Medium/Large 异步） | `validation` | `validation` | 100 | `{source_document_id, quarantine_uri}` |
| 文件解析 | `ingestion` | `ingestion` | 50/100/200 | `{source_document_id, archive_uri, mime_type}` |
| URL 抓取 | `url_fetch` | `url-fetch` | 100 | `{source_document_id, url}` |

**理由**: 明确 queue_name 与 P1-E7（`queue_name=ingestion`）和 P1-E11（`queue=url-fetch`）的测试要求对齐。validation Job 是 Small 同步场景的异步替代，不是 ingestion 的前置步骤。

### D8: Graphify 触发策略（Stage 3 handoff 契约）

**选择**: 解析完成（status=parsed）后，根据 source_document 的 `processing_strategy` 决定 Graphify 触发行为：

| processing_strategy | 解析完成后行为 |
|---|---|
| `immediate`（默认） | 自动创建 Graphify Job，source_document 状态转为 `graphify_pending` |
| `stash` | 不触发 Graphify，状态停留在 `parsed`，等待用户手动触发 |
| `archive_only` | 不触发 Graphify，状态停留在 `parsed`，仅作为归档资料 |

批量上传合并：同一 Space 在 30 秒内连续上传的多个文件，合并为一个 Graphify run（通过 `batch_id` 关联）。

**理由**: 与 Doc 07 §9 Graphify 触发策略对齐。Graphify run 的具体实现在 Stage 5，但 Stage 3 必须定义 handoff 契约。

### D9: source_document 完整状态机

**选择**: 定义单一状态枚举和合法转换：

正常流:
```
uploaded → validating → archived → parsing → parsed → graphify_pending → graphify_running → wiki_proposed → published → indexed
```

失败状态:
```
security_rejected（从 validating）
parse_failed（从 parsing）
graphify_failed（从 graphify_running）
sync_failed（从 wiki_proposed）
index_failed（从 indexed 构建）
```

Stage 3 覆盖的状态: `uploaded`, `validating`, `archived`, `parsing`, `parsed`, `parse_failed`, `security_rejected`, `graphify_pending`。后续状态由 Stage 4-6 实现。

**理由**: 与 Doc 07 §10 完整状态机对齐。统一使用 `parse_failed`（非 `failed`），消除 Doc 14 P1-E8 的 `status=failed` 歧义。

### D10: metadata_json 规范

**选择**: source_document.metadata_json 定义标准化字段：

```json
{
  "source_url": "https://...",
  "tags": ["auth", "sso"],
  "author": "user input",
  "processing_strategy": "immediate",
  "batch_id": "batch_xxx",
  "rejection_reason": "mime_type_mismatch",
  "rejection_details": {},
  "injection_risk": false,
  "injection_patterns": [],
  "needs_attention": false,
  "fetch_metadata": {"content_type": "...", "response_size": 12345},
  "parse_metadata": {"extraction_tool": "pdfplumber", "duration_ms": 1234},
  "graphify_run_id": "run_xxx",
  "cleanup_at": "2026-05-07T..."
}
```

**理由**: 统一 metadata_json schema，避免各 change 各自定义字段导致不一致。

### D11: 权限模型映射

**选择**: Stage 3 使用 `upload:create` 和 `upload:read` 权限点（与 Doc 12 §2.2 对齐），不使用 `space:upload`。映射关系：

| 角色 | upload:create | upload:read |
|---|---|---|
| Owner | ✓ | ✓ |
| Admin | ✓ | ✓ |
| Space Admin | ✓（所管 Space） | ✓（所管 Space） |
| Editor | ✓（所属 Space） | ✓（所属 Space） |
| Viewer | ✗ | ✓（所属 Space） |

**理由**: 与权限安全审计文档的权限点定义一致，避免命名混乱。

### D6: 文件大小分层与 Job 优先级

**选择**:

| 分层 | 大小 | priority 值 | 行为 |
|---|---|---|---|
| Small | ≤5MB | 50 (high) | 同步校验 + 异步解析 |
| Medium | 5-50MB | 100 (normal) | 全异步 |
| Large | >50MB | 200 (low) | 低优先级队列 |
| Reject | >200MB | N/A | 直接拒绝 413 |

**理由**: 通过 Job priority 字段自然实现分层，无需额外队列。priority 值越小越优先，与 Stage 2 Job 系统的 `priority ASC` 排序一致。

## Risks / Trade-offs

- **[R1] 内存压力** → 200MB 大文件接收到内存可能压力大。Mitigation: multer 配置 200MB limits，实际 Large 文件走低优先级队列，production 可调整为磁盘临时存储。
- **[R2] SHA256 计算阻塞** → 大文件 SHA256 计算耗时。Mitigation: 使用 Node.js crypto 流式 hash，≤200MB 在可接受范围。
- **[R3] Quarantine 清理** → 校验失败的文件堆积。Mitigation: 定时任务清理 >7 天的 quarantine 文件，MVP 可手动清理。
- **[R4] 并发去重竞态** → 两个请求同时上传相同文件。Mitigation: DB UNIQUE 约束兜底，第二个插入失败后 fallback 到查询已有记录。
- **[R5] URL 上传 file_blob 回填** → url-fetcher-worker 需要回填 source_document 的 file_blob_id。Mitigation: 通过 Job result_json 传递 file_blob_id，upload service 提供 linkBlob 方法。
