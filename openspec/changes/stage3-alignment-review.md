# Stage 3 Openspec Change 对齐度审核报告

审核对象：

- `stage3-upload-api-schema-storage`
- `stage3-security-validation`
- `stage3-ingestion-worker`
- `stage3-url-fetcher-worker`
- `stage3-upload-center-ui`

需求源：

- `cherrywiki_implementation_stage_plan.md` Stage 3
- `docs/requirements/07_模块需求_资料上传归档解析.md`
- `docs/engineering/14_测试验收规范.md`
- `docs/engineering/24_威胁建模与安全用例.md`
- `docs/project/26_需求追踪矩阵.md`
- `docs/engineering/12_权限安全审计.md`

## 1. 总体评估

综合覆盖率估算：约 **78%**。

按 Stage 3 计划中的最小交付物看，5 个 change 已经覆盖主要表面能力：上传 API、查询/状态/重处理 API、ingestion-worker、url-fetcher-worker、parsed.md、上传中心页面均有对应 spec/task。

但按完整需求源对齐看，仍存在若干高优先级缺口和冲突：

1. **URL 上传与 schema 冲突**：`source_documents.file_blob_id` 在 `docs/schemas/schema.sql` 中为 NOT NULL，但 upload-api 设计 URL 上传时创建 `file_blob_id=null` 的 source_document。
2. **quarantine/archive 与 Job 时序不一致**：upload-api task 在文件进入 quarantine 后立即创建 ingestion Job，但 storage-flow 明确 quarantine 文件不得被 ingestion-worker 处理；security-validation 又提出 Medium/Large 将校验作为 ingestion Job 第一步，和“先校验再 archive 再解析”的主流程冲突。
3. **路径约定不统一**：archive 原文件、parsed.md、URL snapshot 在 5 个 change 中出现多种路径格式，`sha256` 全量、`sha256_prefix`、`sha256_prefix8` 混用。
4. **Graphify 正向触发策略缺失**：只覆盖了 `parse_failed` 不触发 Graphify，未覆盖 `parsed` 后如何进入 `graphify_pending`、批量上传如何合并为 1 个 Graphify run、`processing_strategy` 的真实语义。
5. **Prompt injection 覆盖不完整**：已覆盖扫描与 `source_document.metadata_json` 标记，但 P1-E13 要求 `wiki_chunks.injection_risk`、retrieval_trace 可见、rerank ×0.3，这些还缺少跨 Stage 契约。
6. **权限命名不一致**：需求文档定义 `upload:create` / `upload:read`，change 使用 `space:upload` / Space 读权限，缺少角色到权限点的明确映射。

建议在进入实现前补齐这些契约，否则 Stage 3 后端、worker、UI 很容易各自实现成功但端到端无法闭环。

## 2. 交付物覆盖度

| Stage 3 交付物 | 覆盖状态 | 覆盖 change / spec | 审核结论 |
|---|---:|---|---|
| `POST /api/spaces/{space_id}/uploads` | ✅ 已覆盖 | `stage3-upload-api-schema-storage/specs/upload-api/spec.md`；UI 调用见 `stage3-upload-center-ui` | 覆盖文件和 URL 两种入口，但 URL 的 `file_blob_id=null` 与 schema 冲突需修正。 |
| `GET /api/uploads/{source_document_id}` | ✅ 已覆盖 | `stage3-upload-api-schema-storage/specs/upload-api/spec.md` | 元数据查询覆盖。 |
| `GET /api/uploads/{source_document_id}/status` | ✅ 已覆盖 | `stage3-upload-api-schema-storage/specs/upload-api/spec.md` | 状态查询覆盖，但有效状态列表不完整。 |
| `POST /api/uploads/{source_document_id}/reprocess` | ✅ 已覆盖 | `stage3-upload-api-schema-storage/specs/upload-api/spec.md`；UI 操作见 `stage3-upload-center-ui/specs/upload-center-page/spec.md` | 覆盖单个 `parse_failed` 重处理；未覆盖管理员批量 reprocess。 |
| `ingestion-worker` | ✅ 已覆盖 | `stage3-ingestion-worker/*` | 覆盖 Python worker、解析器、沙箱、Job 协议。 |
| `url-fetcher-worker` | ✅ 已覆盖 | `stage3-url-fetcher-worker/*` | 覆盖 URL 抓取、SSRF 防护、snapshot、链式 ingestion Job。 |
| `parsed.md` 产物 | ✅ 已覆盖 | `stage3-ingestion-worker/specs/parsed-output/spec.md` | frontmatter、hash、preview 覆盖；路径约定需统一。 |
| 上传中心页面 | ✅ 已覆盖 | `stage3-upload-center-ui/*` | 覆盖上传、URL、列表、详情、重处理、轮询；依赖列表 API 需移入/补入 Upload API change。 |

## 3. 验收标准覆盖度

| Stage 3 验收标准 | 覆盖状态 | 对齐结果 |
|---|---:|---|
| PDF / DOCX / MD / TXT / ZIP 可上传 | ✅ 已覆盖 | upload-api 支持上传；security-validation 白名单包含这些类型；ingestion-worker 对 PDF/DOCX/MD/TXT/ZIP 均有解析要求。 |
| 原文件进入 archive | ⚠️ 部分覆盖 | upload-storage-flow 和 security-validation 覆盖 quarantine → archive，但 upload-api 先创建 ingestion Job、security-validation 对 Medium/Large “作为 ingestion Job 第一步”的表述与 quarantine 隔离要求冲突。 |
| parsed.md 生成 | ✅ 已覆盖 | ingestion-worker 的 parsed-output spec 覆盖 frontmatter、hash、preview 和 MinIO 存储。 |
| ZIP bomb / 路径穿越被拒 | ✅ 已覆盖 | zip-security 覆盖 >500MB、压缩比、路径穿越、绝对路径、嵌套 >3、entry 数量限制。需补 symlink 检查与错误码对齐。 |
| SSRF URL 被拒 | ⚠️ 部分覆盖 | 覆盖 localhost、私网、metadata、redirect、DNS pinning、egress proxy；但 P1-E12 明确要求 IPv6 映射 IPv4（如 `::ffff:169.254.169.254`），当前 spec 未显式覆盖。 |
| `parse_failed` 不触发 Graphify | ✅ 已覆盖 | upload-storage-flow 明确 `parse_failed` 不创建 graphify Job。 |
| Source Document 不直接进入 Chat | ⚠️ 部分覆盖 | 需求定位上各 change 以 parsed.md/Graphify 为输入，但没有明确 Chat/indexer 禁止读取 `source_documents` / `file_blobs` 的契约或测试挂点。 |

## 4. 测试用例对齐

| 测试用例 | 覆盖状态 | 覆盖 change / spec / task | 差距 |
|---|---:|---|---|
| P1-E6 文件去重 | ✅ 已覆盖 | `stage3-upload-api-schema-storage/specs/upload-dedup/spec.md`；tasks 7.2/7.3 | 文件上传去重完整；URL 抓取后去重也有 spec。 |
| P1-E7 大文件分层 | ⚠️ 部分覆盖 | `stage3-upload-api-schema-storage/specs/upload-api/spec.md`；tasks 3.6/7.4 | priority 覆盖；但 P1-E7 明确 `queue_name=ingestion`，change 未要求创建 Job 时设置 queue_name。 |
| P1-E8 解析失败保留 | ✅ 已覆盖 | `stage3-upload-api-schema-storage/specs/upload-storage-flow/spec.md`；`stage3-ingestion-worker/specs/ingestion-worker-protocol/spec.md`；UI detail/reprocess | 保留 archive、不触发 Graphify、UI 显示失败和 reprocess 均覆盖。注意 `docs/engineering/14` 写 `status=failed`，Doc 07 和 changes 用 `parse_failed`，需统一为一个值。 |
| P1-E11 URL 抓取 | ⚠️ 部分覆盖 | `stage3-url-fetcher-worker/specs/url-fetching/spec.md`；tasks 7.1；upload-api URL endpoint | URL fetch → snapshot → file_blob → ingestion Job 覆盖；但 `queue=url-fetch` 未显式要求，且 URL source_document 空 `file_blob_id` 与 schema 冲突。 |
| P1-E12 SSRF 防护 | ⚠️ 部分覆盖 | `stage3-url-fetcher-worker/specs/ssrf-protection/spec.md`；tasks 7.2-7.6 | localhost/私网/metadata/redirect/DNS pinning 覆盖；缺 IPv4-mapped IPv6 场景，需明确连接前不会对未校验 host 发起网络请求。 |
| P1-E13 Prompt injection 标记 | ⚠️ 部分覆盖 | `stage3-security-validation/specs/prompt-injection-detection/spec.md`；tasks 4/5.5/7.5 | 扫描和 source_document 标记覆盖；P1-E13 要求 `wiki_chunks.injection_risk`、retrieval_trace、rerank ×0.3、Chat 不泄露，当前只写“later stages”，缺 Stage 3 输出契约。 |
| P1-E14 ZIP 安全 | ⚠️ 部分覆盖 | `stage3-security-validation/specs/zip-security/spec.md`；tasks 3/7.2-7.4 | 核心检查覆盖；需补 symlink 禁止、审计字段、错误码与测试要求的 `ZIP_BOMB_DETECTED` / `PATH_TRAVERSAL_DETECTED` / `ZIP_NESTING_EXCEEDED` 对齐。 |
| P1-E15 Magic bytes 校验 | ⚠️ 部分覆盖 | `stage3-security-validation/specs/file-type-validation/spec.md`；tasks 2/7.1 | ELF→PDF 覆盖；但测试规范还要求 shell script 伪装 `.txt` 被拒，当前 spec 明确 `.txt/.md` 对无 magic bytes 放宽，会放过 shebang 脚本。错误码也需对齐 `MIME_MISMATCH`。 |

## 5. 安全威胁覆盖度

| 威胁 | 覆盖状态 | 覆盖情况 | 需补强点 |
|---|---:|---|---|
| T1 恶意文件上传 | ⚠️ 部分覆盖 | MIME/magic、大小限制、quarantine、解析沙箱、非 root、资源限制均有覆盖。 | Office 宏不执行未显式写入；shell script-as-text 放行风险；Medium/Large 校验时序与 quarantine 隔离冲突。 |
| T2 ZIP bomb / 路径穿越 | ⚠️ 部分覆盖 | >500MB、压缩比、路径穿越、绝对路径、嵌套、entry 数量均覆盖。 | 威胁模型要求禁止符号链接，当前未覆盖；错误码和审计 action/fields 需对齐测试规范。 |
| T3 SSRF | ⚠️ 部分覆盖 | 独立 url-fetcher-worker、DNS pinning、私网 IP、metadata、redirect 重验证、egress proxy、无凭据覆盖较完整。 | 缺 IPv4-mapped IPv6 显式场景；design 允许 MVP 直接出站与 Phase 1 P0 的 egress proxy 要求有张力，应删掉或改为非合规 fallback。 |
| T4 Prompt injection | ⚠️ 部分覆盖 | parsed.md 扫描、pattern 库、source_document metadata 标记、audit 覆盖。 | 需求要求 ingestion-worker 对 chunk 标记 `injection_risk=true`，并在检索降权和 retrieval_trace 中可见；当前仅承诺 later stages，缺可测试契约。 |

## 6. 跨 change 依赖一致性

### 6.1 Job 类型与队列

结论：**类型基本一致，队列字段不完整。**

- upload-api 创建 `ingestion` / `url_fetch` Job。
- ingestion-worker 消费 `type=ingestion`。
- url-fetcher-worker 消费 `type=url_fetch`。
- P1-E7 要求大文件 Job `queue_name=ingestion`，P1-E11 要求 URL Job `queue=url-fetch`，但 upload-api spec/tasks 没有明确 `queue_name` 值。

建议：

- 在 upload-api spec 中明确：
  - 文件上传 Job：`type=ingestion`, `queue_name=ingestion`
  - URL 上传 Job：`type=url_fetch`, `queue_name=url-fetch`
  - priority：Small=50, Medium=100, Large=200

### 6.2 quarantine/archive 路径约定

结论：**quarantine 一致，archive 不一致。**

当前出现的格式：

- `archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}_{filename.ext}`
- `archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256_prefix8}_{original_filename.ext}`
- `archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}.parsed.md`
- `archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}_{hostname}.snapshot`

需求源 Doc 07 的路径规则是同一目录下保存：

- `{sha256}_original_filename.ext`
- `{sha256}.metadata.json`
- `{sha256}.parsed.md`
- `{sha256}.preview.txt`

建议：

- 统一为一个 canonical path，并要求所有 change 引用同一 helper：
  - 原文件：`archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}_{safe_original_filename}`
  - 元数据：`archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}.metadata.json`
  - 解析产物：`archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}.parsed.md`
  - 预览：`archive/{tenant_id}/{space_id}/{yyyy}/{mm}/{dd}/{sha256}.preview.txt`
  - URL snapshot 原文件名可使用 `{sha256}_{safe_hostname}.snapshot.html` 或按 Content-Type 推断扩展名，但仍必须写入 metadata。

### 6.3 `source_documents` 状态机

结论：**Stage 3 局部状态覆盖，完整状态机缺失。**

需求源完整状态：

`uploaded → archived → parsing → parsed → graphify_pending → graphify_running → wiki_proposed → published → indexed`

失败状态：

`parse_failed`, `security_rejected`, `graphify_failed`, `sync_failed`, `index_failed`

当前 changes 主要覆盖：

- `uploaded`, `archived`, `parsing`, `parsed`, `parse_failed`, `security_rejected`, `graphify_pending`
- UI 额外显示 `graphify_running`

缺口：

- `wiki_proposed`, `published`, `indexed`
- `graphify_failed`, `sync_failed`, `index_failed`
- `parse_failed` 的 `needs_attention` 标记
- `docs/engineering/14` 中 P1-E8 的 `source_document.status=failed` 与 Doc 07 的 `parse_failed` 冲突

建议：

- 在 upload-api 或新增 `source-document-lifecycle` spec 中定义单一状态枚举、合法转换和跨 Stage 所有权。
- 将 `failed` 统一改为 `parse_failed`，或引入 `status=parse_failed` + UI display label “failed”。

### 6.4 `file_blob` 去重逻辑

结论：**文件上传去重清晰，URL 抓取后去重存在 schema 阻塞。**

一致处：

- 文件上传使用 `(tenant_id, sha256)` 去重 file_blob。
- 同 Space 使用 `(space_id, file_blob_id)` 去重 source_document。
- URL 抓取完成后计算内容 SHA256 并复用 file_blob。

冲突：

- upload-api 设计 URL 提交时创建 `source_document(file_blob_id=null)`，但 schema 中 `file_blob_id TEXT NOT NULL`。
- 若 URL 抓取内容命中已有 file_blob，url-fetcher spec 说“不存重复 snapshot”，但需要明确是先写临时对象再 promote，还是流式 hash 后才写 archive，否则实现容易先写后删，破坏“不重复存储”的断言。

建议：

- 二选一修正：
  1. 修改 schema：`source_documents.file_blob_id` 允许 NULL，并增加状态/约束说明：仅 `source_type=url AND status in (uploaded, fetching)` 可 NULL。
  2. 引入 `upload_requests` / `source_ingestions` 暂存表，URL fetch 完成前不创建 source_document。
- URL snapshot 应使用 temporary/quarantine 对象，hash 完成且确认非重复后再写 archive/linkBlob。

### 6.5 安全校验与 ingestion 的所有权

结论：**当前描述会导致实现分裂。**

冲突点：

- upload-api task：上传文件后立即创建 ingestion Job。
- upload-storage-flow：quarantine 文件不得被 ingestion-worker 处理。
- security-validation design：Small 在 API 同步校验，Medium/Large 将校验作为 ingestion Job 第一步。
- ingestion-worker proposal：假设文件已经归档到 MinIO 且安全校验已完成。

建议：

- 明确两种合法模型之一：
  1. **推荐**：上传后创建 `validation`/`ingestion` 前置 Job，校验通过 promote archive，再创建 ingestion Job。
  2. 或：ingestion-worker 先执行 validation，但此时必须允许它读取 quarantine，且 ingestion-worker spec 要承担 MIME/ZIP/magic 的安全职责。
- 不建议当前“quarantine 不可处理”与“ingestion 第一步校验”并存。

## 7. 遗漏分析

| 遗漏点 | 需求来源 | 严重性 | 说明 |
|---|---|---:|---|
| 自动归档分类 | Doc 07 §8 | P1 | 未覆盖主题/文件类型/来源/状态分类，也未覆盖 Wiki 路径建议。 |
| Graphify 正向触发策略 | Doc 07 §9 | P0 | 只覆盖 `parse_failed` 不触发，缺 `parsed` 后如何创建 Graphify job/run、`processing_strategy` 行为、batch run 合并。 |
| 完整任务状态机 | Doc 07 §10 | P0 | 缺后半段状态和失败状态；状态名还存在 `failed` vs `parse_failed` 冲突。 |
| 批量上传合并为一个 Graphify run | Doc 07 §9；测试 P1-E10 | P0/P1 | UI 支持多文件顺序上传，但没有 batch_id、run grouping 或合并 Graphify run 的契约。 |
| 管理后台批量导入 | Doc 07 §3.3 | P2 | UI change 明确 Phase 2；如 Stage 3 不做，应在 proposal 中显式标为 out-of-scope 并说明替代路径。 |
| `source_documents.metadata_json` 规范 | Doc 07 §4.3/§7.1/§10.1 | P0 | 只零散记录拒绝原因、injection_risk、cleanup；缺 source_url、tags、author、processing_strategy、fetch metadata、parse metadata、needs_attention、graphify_run_id 等统一 schema。 |
| 上传权限模型 | Doc 12 §2.2/§5 | P0 | docs 定义 `upload:create`/`upload:read`，change 使用 `space:upload`；缺 Editor/Space Admin/Owner 到权限点映射。 |
| Source Document 不直接进入 Chat 的强约束 | Stage 3 验收；Doc 07 §11 | P0 | 缺 indexer/Chat 禁止读取 source_documents/file_blobs 的 contract test。 |
| Magic bytes 对脚本文本伪装的拒绝 | P1-E15 | P0 | 当前对 `.txt/.md` 无 magic bytes 放宽，可能不满足 shell script 重命名为 `notes.txt` 被拒的测试。 |
| IPv4-mapped IPv6 SSRF | P1-E12 / §4.5C | P0 | 未显式覆盖 `::ffff:169.254.169.254`。 |
| ZIP symlink 禁止 | Threat T2 | P1 | ZIP path validation 未提 symlink entry。 |
| Office 宏不执行 | Threat T1 | P1 | Threat model 要求 Office 解析工具不执行宏，ingestion-worker 未明确。 |
| 错误码规范 | 14_测试验收规范 §4.5A/B/C | P1 | change 使用 reason snake_case，测试要求 `ZIP_BOMB_DETECTED`、`MIME_MISMATCH`、`SSRF_BLOCKED` 等。 |

## 8. 建议

### 8.1 必须补到现有 Stage 3 changes

1. **修正 URL source_document 与 schema 的冲突**  
   补到 `stage3-upload-api-schema-storage`：明确 `file_blob_id` 是否 nullable，或引入 URL ingest 暂存实体；同时更新 Drizzle schema/spec/tasks。

2. **统一 Job type/queue/status 契约**  
   补到 `stage3-upload-api-schema-storage` 和两个 worker change：明确 `type`、`queue_name`、payload_json、result_json、source_document 状态转换。

3. **统一 quarantine/archive/parsed/snapshot 路径**  
   补到 `stage3-upload-api-schema-storage`、`stage3-ingestion-worker`、`stage3-url-fetcher-worker`：使用一个 canonical path helper 和同一命名规范。

4. **修正安全校验时序**  
   补到 `stage3-security-validation` 与 `stage3-upload-api-schema-storage`：校验通过 promote archive 后再创建 ingestion Job，或明确 ingestion-worker 可读取 quarantine 并承担安全校验。推荐前者。

5. **补 Graphify 触发策略的 Stage 3 handoff contract**  
   至少补：
   - `processing_strategy=immediate`：`parsed` 后创建 Graphify run/job，状态进入 `graphify_pending`
   - `stash/archive_only`：不自动 Graphify
   - `parse_failed/security_rejected`：不 Graphify
   - 批量上传 batch_id 合并为一个 Graphify run

6. **补完整 source_document 状态机和 metadata_json schema**  
   补到 upload-api 或单独新增 lifecycle/spec：状态枚举、合法转换、失败策略、metadata_json 字段规范。

7. **补 P1-E12/P1-E15/P1-E14 安全细节**  
   - SSRF：IPv4-mapped IPv6、canonicalization、精确错误码 `SSRF_BLOCKED`
   - Magic bytes：shell script 伪装 `.txt` 拒绝策略
   - ZIP：symlink entry 禁止、精确错误码、审计字段

8. **补权限命名映射**  
   将 `space:upload` 改为 docs 中的 `upload:create`，或在权限 spec 中新增 `space:upload` 并说明与 `upload:create` 的等价/迁移关系；同时定义 `upload:read`。

9. **补 Source Document 不直接进入 Chat 的 contract**  
   至少在 Stage 3 spec 中声明：任何 `source_documents` / `file_blobs` 不进入 indexer 输入；只有 Published Wiki chunks 可被 Chat 检索。具体实现可在 Stage 6，但 Stage 3 必须输出可测试约束。

### 8.2 可以推迟到后续 Stage，但应显式标注

1. 管理后台批量导入：可推迟到 Phase 2/管理后台增强，但需要在 Stage 3 proposal 中声明不做。
2. Docmost 附件上传：Doc 07 §3.2 属 Phase 2，可推迟。
3. 病毒扫描、DLP、敏感信息识别：Doc 07/12 均标为 P1 或 Phase 2 增强，可推迟。
4. JavaScript 渲染 URL、登录态/Cookie 抓取：url-fetcher-worker 已标 Phase 2，可推迟。
5. 自动归档分类的高级智能分类：建议 Stage 3 先补 metadata 字段和手动标签/来源/类型分类；自动 Wiki 路径建议可推迟到 Graphify/Wiki 阶段。

## 9. 最终结论

5 个 change 已经覆盖 Stage 3 的主要工程模块，但当前仍不是可直接实施的完整端到端规格。最大风险集中在 **schema 与 URL 流程冲突、quarantine/archive/ingestion 时序冲突、Graphify 触发缺失、状态机/metadata 未标准化、安全边界细节未对齐测试**。

建议先补齐上述 P0 项，再进入实现；否则很可能出现 API、worker、UI 单项验收通过，但 P1-E11/P1-E13/P1-E15 和端到端 Stage 3 验收失败。
