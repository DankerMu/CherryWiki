## Why

Upload API（stage3-upload-api-schema-storage）将文件存入 quarantine 后，需要一条安全校验管线来决定文件是否可以进入正式 archive 并被 ingestion-worker 解析。当前系统没有文件内容校验能力，恶意文件（伪装扩展名、ZIP bomb、路径穿越、prompt injection）可以直接进入处理链路。安全校验管线是 Upload 链路和 Worker 解析之间的必经关卡，覆盖威胁模型 T1（恶意文件上传）、T2（ZIP 安全）和 T4（prompt injection）。

## What Changes

- 新增文件类型校验服务：MIME 真实性验证（magic bytes vs Content-Type 声明）、扩展名白名单匹配
- 新增 magic bytes 检测（P1-E15）：识别文件真实类型，拒绝伪装文件（如 ELF 伪装为 .pdf）
- 新增 ZIP 安全解压服务（P1-E14）：ZIP bomb 检测（解压后 >500MB 拒绝）、路径穿越防护（../ 拒绝）、最大嵌套层级限制（3 层）
- 新增 Prompt Injection 检测服务（P1-E13）：模式匹配扫描解析产物，标记 injection_risk=true，Chat 检索降权系数 ×0.3
- 新增安全校验管线编排：quarantine 文件按顺序执行 MIME → magic bytes → ZIP（如适用）→ archive 或 reject
- 安全拒绝事件写入 audit_logs

## Capabilities

### New Capabilities

- `file-type-validation`: MIME 真实性验证、magic bytes 检测、扩展名白名单，拒绝伪装文件
- `zip-security`: ZIP 安全解压，bomb 检测、路径穿越防护、嵌套层级限制
- `prompt-injection-detection`: 解析产物中 prompt injection 模式扫描和标记

### Modified Capabilities

(无已有 spec 需要修改)

## Impact

- **apps/api/src/uploads/**: 集成安全校验管线，quarantine → validate → archive/reject 流程
- **packages/**: 可能新增 `packages/security/` 或在 uploads 模块内实现校验服务
- **依赖**: `file-type`（npm，magic bytes 检测）、`yauzl`（ZIP 安全解压）
- **审计日志**: security_rejected 事件写入 audit_logs（action: upload.security_rejected）
- **source_documents**: 新增 status=security_rejected 状态，metadata_json 记录拒绝原因
- **wiki_chunks**: injection_risk 字段用于 Chat 降权（后续 Stage 实现降权逻辑）
