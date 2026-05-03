# Stage 3 Issue Alignment Audit

审查时间：2026-05-01

审查范围：

- OpenSpec changes：`stage3-upload-api-schema-storage`、`stage3-security-validation`、`stage3-ingestion-worker`、`stage3-url-fetcher-worker`、`stage3-upload-center-ui`
- 对齐审核报告：`openspec/changes/stage3-alignment-review.md`
- GitHub issues：#64、#65、#66、#67、#68、#69

审查方法：

- 已完整读取用户指定的 `proposal.md` / `tasks.md` / `stage3-alignment-review.md`。
- 已通过 `gh issue view <number> --json number,title,state,url,body,labels` 拉取 #64-#69。
- 已检查 #64-#69 的 issue comments，均为空；本报告以 issue body 为准。

状态说明：

- 覆盖：issue 明确承接该一级任务及关键子任务。
- 部分覆盖：issue 有对应 owner，但压缩或遗漏了 tasks.md 中的关键子任务、测试、字段或实现约束。
- 缺失：对应 issue 中没有可执行任务承接。

## A. 逐 change 对齐矩阵

### A.1 `stage3-upload-api-schema-storage` -> Issue #65

| tasks.md 一级任务 | Issue 覆盖状态 | 对应 issue 内容 | 子任务遗漏 / 风险 |
|---|---|---|---|
| 1. Drizzle Schema & Migration | 覆盖 | #65 Tasks 1.1-1.5 | 无明显遗漏。#65 已明确 `source_documents.file_blob_id NULLABLE`，覆盖 alignment-review 指出的 URL schema 冲突修正。 |
| 2. Upload Repository | 部分覆盖 | #65 Tasks 2.1-2.4 | #65 只写 `FileBlobRepository` / `SourceDocumentRepository`，未显式列出 `create`、`findByTenantAndSha256`、`findById`、`findBySpaceAndBlob`、`updateStatus`、`findByFilter` 分页查询等方法契约。 |
| 3. Upload Service - 核心逻辑 | 部分覆盖 | #65 Tasks 3.1-3.5、6.5 | 覆盖 uploadFile、uploadUrl、get/status/reprocess/linkBlob、大小分层。遗漏或不够明确：创建 `source_document(status=uploaded)`、Job `queue_name=ingestion` / `queue_name=validation`、Medium/Large 上传时创建 `validation` Job、竞态 fallback 测试。 |
| 4. Upload Controller - REST API | 部分覆盖 | #65 Tasks 4.1-4.5 | 覆盖 4 个端点和 `upload:create` / `upload:read` Guard。遗漏或不够明确：`FileInterceptor + multer`、后端 200MB limit 实现点、参数校验和错误响应码测试细分。 |
| 5. Storage Flow - Quarantine & Archive | 部分覆盖 | #65 Tasks 5.1-5.3 | 覆盖三个 StorageService 方法和 `ArchivePathHelper`。遗漏或不够明确：quarantine/archive 精确路径模板、`copy -> delete quarantine` 的顺序约束、跨 ingestion/url-fetcher 的 helper 使用要求。 |
| 6. Upload Module 注册 | 缺失 | 无 | #65 没有承接 `UploadsModule` 创建、注入 `StorageService` / `JobService` / repositories、在 `AppModule` 注册、启动验证。 |
| 7. 集成测试 | 部分覆盖 | #65 Tasks 7、Acceptance Criteria | 覆盖 P1-E6、P1-E7、reprocess、权限、413、Graphify handoff、batch。遗漏：上传完整流程测试、跨 Space 去重测试、URL 上传集成测试、明确的 source_document / Job / quarantine 全链路断言。 |
| 8. Source Document 生命周期 | 部分覆盖 | #65 Tasks 6.1-6.5、7、Acceptance Criteria | 覆盖状态机、Graphify handoff、batch_id、metadata schema、validation 完成后 ingestion。遗漏或不够明确：状态机单元测试、metadata_json schema 字段清单和校验测试、`parse_failed/security_rejected` 不触发 Graphify 的子 issue 级任务。 |

结论：#65 承接了该 change 的大部分主干，但把 tasks.md 的 8 个一级任务压缩为 7 组，遗漏了 `Upload Module 注册`，并弱化了 Job queue、repository 方法、集成测试和 metadata schema 的可执行细节。

### A.2 `stage3-security-validation` -> Issue #66

| tasks.md 一级任务 | Issue 覆盖状态 | 对应 issue 内容 | 子任务遗漏 / 风险 |
|---|---|---|---|
| 1. 依赖安装 | 部分覆盖 | #66 Tasks 1、2 | `file-type` 已覆盖；`yauzl` 使用已覆盖。遗漏：`@types/yauzl` 类型定义安装没有显式任务。 |
| 2. MIME & Magic Bytes 校验器 | 部分覆盖 | #66 Tasks 1、Acceptance Criteria | 覆盖 magic bytes、白名单、三方一致性、shebang/null bytes、`MIME_MISMATCH`。遗漏：`apps/api/src/uploads/validators/` 目录、读取文件头 4096 字节、类型映射表、MimeValidator 单元测试细分。 |
| 3. ZIP 安全校验器 | 部分覆盖 | #66 Tasks 2、5 | 覆盖 yauzl、bomb、路径穿越、symlink、嵌套、entry 数量、扩展名白名单、P1-E14。遗漏：ZipValidator 单元测试细分未显式列出。 |
| 4. Prompt Injection 扫描器 | 部分覆盖 | #66 Tasks 3、5 | 覆盖 pattern 库、scanner、`injection_risk` / `matched_patterns` 标记、P1-E13。遗漏：PromptInjectionScanner 单元测试细分；`metadata_json.injection_patterns` 字段名未显式固定。 |
| 5. 校验管线编排 | 部分覆盖 | #66 Tasks 4 | 覆盖 `ValidationPipeline`、通过 promote、失败 `security_rejected` + audit、Small/Medium/Large 校验模型。遗漏：prompt injection 集成到 ingestion-worker 解析后步骤（tasks.md 5.5）、ValidationPipeline 单元测试。 |
| 6. 集成到 Upload 流程 | 部分覆盖 | #66 Tasks 4、#65 Tasks 3/6.5 | 覆盖 Small 同步、Medium/Large 异步 validation Job 的方向。遗漏：UploadService 侧明确调用点和安全校验集成测试 owner 不够细。 |
| 7. 集成测试 | 覆盖 | #66 Tasks 5、Acceptance Criteria | 覆盖 P1-E14、P1-E15、P1-E13、quarantine->archive、audit_log、标准化错误码。 |

结论：#66 对 alignment-review 中补充的安全 P0 项吸收较好，尤其是 shebang、symlink、标准错误码。但 prompt injection 的 ingestion-worker 后置集成和各 validator 的单元测试粒度仍需补进 issue。

### A.3 `stage3-ingestion-worker` -> Issue #67

| tasks.md 一级任务 | Issue 覆盖状态 | 对应 issue 内容 | 子任务遗漏 / 风险 |
|---|---|---|---|
| 1. Worker 应用脚手架 | 覆盖 | #67 Tasks 1 | 覆盖目录、`.venv`、requirements、Dockerfile、worker_base、main loop、heartbeat、shutdown。依赖包清单未逐项列出，但由 requirements 和解析器任务间接覆盖。 |
| 2. 解析器实现 | 部分覆盖 | #67 Tasks 2 | 覆盖 PDF/OCR、DOCX/PPTX/XLSX、Text、Image、注册表、解析器测试。遗漏或不够明确：PDF 表格转 Markdown、DOCX 标题/列表/表格保留、PPTX 注释、RST pandoc fallback 等格式细节。 |
| 3. Parsed.md 产物生成 | 部分覆盖 | #67 Tasks 3、Acceptance Criteria | 覆盖 YAML frontmatter、hash、preview、MinIO 上传。遗漏：frontmatter 中 `filename`、`source_type`、`uploaded_by`、`space_id`、`sha256`、`parsed_at`、`extraction_params` 等 tasks.md 明确字段。 |
| 4. Job 执行流程 | 部分覆盖 | #67 Tasks 4 | 覆盖 handler、进度、300s 超时、tmpdir、error_json。遗漏或不够明确：MinIO 下载到 tmpdir、`result_json` 传递 `parsed_uri` / metadata 并驱动 `source_document` 状态更新。 |
| 5. ZIP 批量处理 | 部分覆盖 | #67 Tasks 5、7 | 覆盖 ZipHandler 和单文件失败不阻塞。遗漏：为每个 ZIP 子文件创建 `source_document` 子记录、ZIP 批量处理单元测试。 |
| 6. Docker 配置 | 部分覆盖 | #67 Tasks 6 | 覆盖非 root、tesseract、docker-compose、2GB/2 cores/internal-only。遗漏：`CHERRY_API_URL`、`WORKER_API_KEY`、`MINIO_ENDPOINT` 等环境变量任务。 |
| 7. 测试 | 覆盖 | #67 Tasks 7、Acceptance Criteria | 覆盖 Worker 生命周期、各格式、P1-E8、超时、ZIP 批量、frontmatter 完整性。 |

结论：#67 覆盖主干充分，但 parsed.md frontmatter 字段、ZIP 子文档建模、Job result_json/status handoff 是必须补齐的实现契约。

### A.4 `stage3-url-fetcher-worker` -> Issue #68

| tasks.md 一级任务 | Issue 覆盖状态 | 对应 issue 内容 | 子任务遗漏 / 风险 |
|---|---|---|---|
| 1. Worker 应用脚手架 | 部分覆盖 | #68 Tasks 1 | 覆盖目录、`.venv`、Dockerfile、worker_base、main loop。遗漏：`requirements.txt`、`requests` / `dnspython` / `pyyaml` 依赖安装清单、tests 目录。 |
| 2. SSRF 防护层 | 覆盖 | #68 Tasks 2、6、Acceptance Criteria | 覆盖禁止 IP 范围、IPv4-mapped IPv6 canonicalization、DNS resolver、DNS pinning、redirect 每跳重验证、单元/集成测试。 |
| 3. URL 抓取实现 | 部分覆盖 | #68 Tasks 3 | 覆盖 DNS->IP 校验->pinning->流式下载、50MB 限制、10s/30s 超时、clean 请求。遗漏：generic User-Agent、URL 抓取单元测试细分（成功、404、超时、超大响应）。 |
| 4. Job 执行流程 | 部分覆盖 | #68 Tasks 4 | 覆盖 UrlFetchJobHandler、snapshot、file_blob 去重、audit。遗漏或不够明确：snapshot 精确路径、`result_json` 字段清单、失败 `error_json.error_type` 枚举。 |
| 5. 链式 Job 触发（cherry-api 侧） | 部分覆盖 | #68 Tasks 4 | 覆盖 `linkBlob` 和自动创建 ingestion Job。遗漏：从 `result_json` 提取字段的契约、链式触发单元测试。 |
| 6. Docker 配置 | 部分覆盖 | #68 Tasks 5 | 覆盖非 root、cap_drop、no-new-privileges、独立网络、egress proxy。遗漏：环境变量配置任务。 |
| 7. 集成测试 | 覆盖 | #68 Tasks 6、Acceptance Criteria | 覆盖 P1-E11、P1-E12、响应超大、快照去重。 |

结论：#68 对 alignment-review 的 SSRF P0 缺口覆盖完整；主要缺口在 Job result/error contract、snapshot path、依赖/env/test 细节。

### A.5 `stage3-upload-center-ui` -> Issue #69

| tasks.md 一级任务 | Issue 覆盖状态 | 对应 issue 内容 | 子任务遗漏 / 风险 |
|---|---|---|---|
| 1. API 层补充 | 部分覆盖 | #69 Tasks 1 | 覆盖 `GET /api/spaces/:spaceId/uploads` 列表端点。遗漏：列表端点单元测试。且该后端任务放在 UI issue 中，ownership 不清。 |
| 2. 路由与导航 | 覆盖 | #69 Tasks 2 | 覆盖路由、侧边栏、`upload:read` 权限检查。 |
| 3. 文件上传组件 | 部分覆盖 | #69 Tasks 3、Acceptance Criteria | 覆盖 dropzone、多文件、前端类型/大小校验、multipart 进度、提示文字。遗漏：上传结果反馈的成功/失败展示细节。 |
| 4. URL 上传表单 | 部分覆盖 | #69 Tasks 4、Acceptance Criteria | 覆盖 URL 输入和 http/https 校验。遗漏：显式调用 `POST /api/spaces/:spaceId/uploads (source_type=url)`、提交成功后列表添加新条目。 |
| 5. 上传列表 | 覆盖 | #69 Tasks 5 | 覆盖表格字段、状态色标、分页、空状态。 |
| 6. 上传详情 | 覆盖 | #69 Tasks 6 | 覆盖元数据、进度、错误详情、parse_failed 重处理按钮。 |
| 7. 状态轮询 | 部分覆盖 | #69 Tasks 7 | 覆盖 processing 5s 刷新、终态停止、离开清理。遗漏：批量状态查询优化。 |
| 8. UI 测试 | 覆盖 | #69 Tasks 8 | 覆盖 FileUploadZone、UploadList、UploadDetail、URL 表单单元测试。 |

结论：#69 覆盖页面主体验收。风险是后端列表端点 owner 被放在 frontend issue 中，以及批量状态查询优化未被承接。

## B. `alignment-review.md` §8.1 P0 缺口覆盖度

| §8.1 必须补齐项 | Issue 覆盖状态 | 覆盖位置 | 审查结论 |
|---|---|---|---|
| 1. 修正 URL source_document 与 schema 的冲突 | 覆盖 | #65 Tasks 1.2、3.2、Acceptance Criteria | #65 明确 `file_blob_id NULLABLE` 和 URL 上传 `file_blob_id=NULL`。 |
| 2. 统一 Job type/queue/status 契约 | 部分覆盖 | #65、#67、#68 | type 基本覆盖：`ingestion` / `url_fetch` / `validation`。queue_name、payload_json、result_json、状态转换 owner 不完整。 |
| 3. 统一 quarantine/archive/parsed/snapshot 路径 | 部分覆盖 | #65 Tasks 5.2、#67 Tasks 3、#68 Tasks 4 | `ArchivePathHelper` 已有 owner，但 #67/#68 未明确必须复用同一 helper；snapshot/parsed 精确路径仍未固定。 |
| 4. 修正安全校验时序 | 覆盖 | #65 Tasks 3.1、6.5；#66 Description/Tasks 4 | 已明确 quarantine->validation->archive->ingestion，Small 同步、Medium/Large validation Job。 |
| 5. 补 Graphify 触发策略 handoff contract | 覆盖 | #65 Tasks 6.2、6.3、7、Acceptance Criteria；#64 Acceptance Criteria | `immediate/stash/archive_only`、batch_id、`parsed -> graphify_pending` 已进入 #65。 |
| 6. 补完整 source_document 状态机和 metadata_json schema | 部分覆盖 | #65 Tasks 6.1、6.4、Acceptance Criteria | 有 owner，但缺完整状态枚举、合法转换表、metadata_json 字段清单和 schema 校验测试。 |
| 7. 补 P1-E12/P1-E15/P1-E14 安全细节 | 覆盖 | #66、#68、#64 Acceptance Criteria | SSRF IPv4-mapped IPv6、magic bytes shell script、ZIP symlink、标准错误码均已吸收。 |
| 8. 补权限命名映射 | 覆盖 | #65 Tasks 4.4、#69 Tasks 2 | 已采用 `upload:create` / `upload:read`，与 Doc 12 权限点对齐。 |
| 9. 补 Source Document 不直接进入 Chat 的 contract | 部分覆盖 | #64 Acceptance Criteria | 仅 Epic 有验收项；#65/#67/#69 没有可执行任务或 contract test owner。建议补到 #65 lifecycle 或新增子任务。 |

结论：9 个 P0 中，5 项覆盖，4 项部分覆盖，无完全遗漏。部分覆盖项集中在 Job contract、路径 contract、状态/metadata schema、Chat/indexer 禁止读取 Source Document 的可测试约束。

## C. 跨 change 依赖一致性

### C.1 Epic 依赖图与实际依赖

Issue #64 当前依赖图：

```text
#65 (Upload API) -> #66 (Security) -> #67 (Ingestion)
                                    -> #68 (URL Fetcher)
#67 and #68 -> #69 (UI)
```

总体方向正确：#65 是数据/API 基座，#66 提供 quarantine->archive 的安全关卡，#67/#68 是 worker，#69 是前端入口。

### C.2 发现的问题

1. #65 标注为无依赖，但 #65 自身任务已经包含 `ValidationPipeline`、Small 同步校验、Medium/Large validation Job、validation 完成后创建 ingestion Job。这些能力实质依赖 #66。  
   建议：#65 只定义接口和状态/Job contract；实际调用 `ValidationPipeline` 的实现任务放到 #66，或在 #65 中标注该部分由 #66 接续完成，避免 #65/#66 形成隐性循环。

2. #69 依赖 #65/#67/#68，但没有依赖 #66。上传中心需要展示 `security_rejected`、标准错误码、audit/security failure 对应错误信息；这些来自 #66。  
   建议：#69 至少依赖 #65 的状态契约和 #66 的安全错误契约，或在 #65 lifecycle 中统一暴露 UI 所需状态/error schema。

3. #68 依赖 #66，但 issue #68 没有写明 URL snapshot 是否要经过 #66 的 ValidationPipeline。当前 #68 直接把抓取内容存为 archive snapshot 并创建 ingestion Job，可能绕过文件类型/ZIP 安全校验。  
   建议：二选一明确：URL snapshot 也进入 validation pipeline 后再 archive/ingestion；或明确 URL fetcher 对 response content 自行承担等价校验职责。

4. `GET /api/spaces/:spaceId/uploads` 列表端点属于 API surface，但当前只在 #69 UI issue 中承接。  
   建议：迁移到 #65，或在 #69 标注需要修改 `apps/api` 并将 #65 owner 作为依赖 reviewer。

5. `ArchivePathHelper` 在 #65 中定义，但 #67/#68 只写了各自路径，没有显式声明复用 helper。  
   建议：#67/#68 增加 “must use ArchivePathHelper canonical path” 任务，避免 worker 与 API 生成不同 archive/parsed/snapshot 路径。

6. Job result_json/status handoff 跨 #65/#67/#68 未完全闭合。#67/#68 都会上报 result_json，#65 负责更新 source_document，但 issue 中缺字段级 contract。  
   建议：在 #65 lifecycle/job contract 中固定 `payload_json` / `result_json` schema，并让 #67/#68 引用。

## D. 遗漏清单

以下为 tasks.md 中存在、但对应 GitHub issue 未显式承接的任务项或关键约束。

### D.1 `stage3-upload-api-schema-storage`

- 2.2/2.3 repository 方法级契约：`FileBlobRepository.create/findByTenantAndSha256/findById`；`SourceDocumentRepository.create/findById/findBySpaceAndBlob/updateStatus/findByFilter`。
- 3.1 文件上传后创建 `source_document(status=uploaded)` 的显式步骤。
- 3.1 文件 ingestion Job 的 `queue_name=ingestion`。
- 3.1 Medium/Large 文件创建 `validation` Job 的 `type=validation, queue_name=validation`。
- 3.8 Service 单元测试中的竞态 fallback 场景。
- 4.1 `FileInterceptor + multer` 和后端 200MB limit 的具体实现任务。
- 5.1/5.2 quarantine/archive 路径模板的精确定义和 `copy -> delete quarantine` 顺序约束。
- 6.1 创建 `UploadsModule` 并注入依赖。
- 6.2 在 `AppModule` 注册 `UploadsModule`。
- 6.3 模块启动无错误验证。
- 7.1 上传完整流程集成测试。
- 7.3 跨 Space 去重集成测试。
- 7.5 URL 上传集成测试。
- 8.4 `metadata_json` schema 的字段清单和校验测试。
- 8.6 状态机合法/非法转换单元测试。

### D.2 `stage3-security-validation`

- 1.2 `@types/yauzl` 类型定义安装。
- 2.1 `apps/api/src/uploads/validators/` 目录任务。
- 2.2 magic bytes 检测读取文件头 4096 字节。
- 2.4 MIME/magic bytes/扩展名类型映射表。
- 2.7 MimeValidator 单元测试细分。
- 3.7 ZipValidator 单元测试细分。
- 4.4 PromptInjectionScanner 单元测试细分。
- 5.5 prompt injection 检测集成到 ingestion-worker 解析后步骤。
- 5.6 ValidationPipeline 单元测试。
- 6.1/6.2 UploadService 侧调用 ValidationPipeline 的具体接入点。

### D.3 `stage3-ingestion-worker`

- 1.3 Python 依赖清单：`pdfplumber`、`python-docx`、`python-pptx`、`openpyxl`、`Pillow`、`pytesseract`、`requests`、`pyyaml`。
- 2.2 PDF 表格转 Markdown 表格。
- 2.4 DOCX 标题/段落/表格/列表层级保留。
- 2.5 PPTX 注释提取。
- 2.7 RST pandoc 转换和 fallback 正则。
- 3.2 frontmatter 字段：`filename`、`source_type`、`uploaded_by`、`space_id`、`sha256`、`parsed_at`、`extraction_params`。
- 4.2 MinIO 文件下载到 tmpdir。
- 4.8 通过 Job `result_json` 传递 `parsed_uri` 和 metadata，并由 API 更新 source_document 状态。
- 5.3 为 ZIP 子文件创建 `source_document` 子记录。
- 5.4 ZIP 批量处理单元测试。
- 6.3 环境变量配置：`CHERRY_API_URL`、`WORKER_API_KEY`、`MINIO_ENDPOINT` 等。

### D.4 `stage3-url-fetcher-worker`

- 1.3 Python 依赖清单：`requests`、`dnspython`、`pyyaml`。
- 3.4 generic User-Agent。
- 3.5 URL 抓取单元测试细分：成功下载、404、超时、超大响应。
- 4.2 snapshot 精确路径：`archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}_{hostname}.snapshot`。
- 4.4 `result_json` 字段：`file_blob_id`、`snapshot_uri`、`content_type`、`size_bytes`。
- 4.5 失败 `error_json.error_type` 枚举：`ssrf_blocked`、`fetch_error`、`connection_timeout`、`request_timeout`、`response_too_large`。
- 5.2 从 url_fetch Job `result_json` 提取 `file_blob_id` 和 `snapshot_uri` 的契约。
- 5.4 链式触发单元测试。
- 6.4 环境变量配置：`CHERRY_API_URL`、`WORKER_API_KEY`、`MINIO_ENDPOINT`、`HTTP_PROXY`。

### D.5 `stage3-upload-center-ui`

- 1.2 列表端点单元测试。
- 3.6 上传结果反馈：成功显示和失败错误信息。
- 4.3 调用 `POST /api/spaces/:spaceId/uploads` 时显式传 `source_type=url`。
- 4.4 URL 提交成功后在列表中添加新条目。
- 7.2 批量状态查询优化：一次请求获取多个文件状态。

## E. 结论与建议

### E.1 总体覆盖率评估

按一级任务统计：

| 范围 | 一级任务数 | 覆盖 | 部分覆盖 | 缺失 |
|---|---:|---:|---:|---:|
| Upload API + Schema + Storage | 8 | 1 | 6 | 1 |
| Security Validation | 7 | 1 | 6 | 0 |
| Ingestion Worker | 7 | 2 | 5 | 0 |
| URL Fetcher Worker | 7 | 2 | 5 | 0 |
| Upload Center UI | 8 | 4 | 4 | 0 |
| 合计 | 37 | 10 | 26 | 1 |

如果只看“是否有 issue owner”，覆盖率约为 97%（36/37）。如果看“是否完整承接 tasks.md 子任务和字段级 contract”，实际可执行覆盖率约为 75%-80%。

当前 issues 已吸收 alignment-review 中大部分 P0 结论，尤其是 URL schema nullable、shebang、ZIP symlink、IPv4-mapped IPv6、权限命名、Graphify handoff。但 issue 粒度偏粗，存在实现时容易被遗漏的字段、测试、路径、Job result contract。

### E.2 优先级建议

P0，建议立即补到 issues：

1. 在 #65 增加 `Upload Module 注册` 任务：`UploadsModule`、依赖注入、`AppModule` 注册、启动验证。
2. 在 #65 增加 Job contract 小节：`type`、`queue_name`、`payload_json`、`result_json`、status transition，由 #67/#68 引用。
3. 在 #65/#67/#68 固定 canonical archive path，并要求 ingestion/url-fetcher 复用 `ArchivePathHelper`。
4. 在 #65 补完整 `source_document` 状态机和 `metadata_json` schema 字段清单及测试。
5. 在 #66/#67 补 prompt injection 扫描的 post-parse 集成 owner，明确是在 ingestion-worker 解析 `parsed.md` 后写回 metadata。
6. 在 #64 或 #65 下新增 “Source Document 不直接进入 Chat” contract test owner，不能只停留在 Epic 验收项。
7. 明确 #68 URL snapshot 是否走 #66 ValidationPipeline；若走，补任务；若不走，补等价校验责任。

P1，建议补充但不阻塞 issue 创建：

1. 将 #69 的列表 API 端点迁移到 #65，或明确 #69 需要改后端并指定 API reviewer。
2. 补各 validator/parser/fetcher 的单元测试细分，避免只剩集成测试兜底。
3. 补 worker 环境变量、依赖清单、result/error JSON 字段枚举。
4. 补 UI 批量状态查询、上传结果反馈、URL 提交后列表同步。

最终结论：Stage 3 GitHub issues 与 OpenSpec changes 已完成主干对齐，但尚未达到“按 issues 直接实现不会漏需求”的程度。建议先修补上述 P0 issue 描述，再进入实现或拆分 PR，否则最可能在 Job handoff、path/schema、post-parse security、Chat 禁入约束和 UploadModule 注册处出现端到端验收失败。
