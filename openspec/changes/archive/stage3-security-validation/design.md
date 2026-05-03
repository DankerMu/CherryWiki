## Context

Upload API（change 1）负责接收文件并存入 quarantine。本 change 实现 quarantine → archive 之间的安全校验管线。校验通过调用 StorageService.promoteToArchive 将文件移入归档；校验失败则标记 source_document status=security_rejected 并写审计日志。

**校验时序（与 upload-api change 对齐）**：
- Small 文件（≤5MB）：API 进程同步执行 ValidationPipeline，通过后 promote archive，然后创建 ingestion Job
- Medium/Large 文件（>5MB）：创建 `validation` 类型 Job 异步执行，校验通过 promote archive 后再创建 ingestion Job
- **关键约束**：所有校验在 archive 之前执行。ingestion-worker 只读取 archive 中已通过校验的文件，绝不读取 quarantine

威胁模型参考：`docs/engineering/24_威胁建模与安全用例.md` T1/T2/T4。

## Goals / Non-Goals

**Goals:**

- 实现 magic bytes 文件类型检测，拒绝伪装文件（P1-E15）
- 实现 ZIP 安全解压，防护 bomb/路径穿越/嵌套过深（P1-E14）
- 实现 prompt injection 模式检测和标记（P1-E13）
- 提供管线编排接口，按顺序执行校验步骤
- 校验结果写入审计日志

**Non-Goals:**

- 病毒扫描（ClamAV）— Phase 2
- DLP/敏感信息检测 — Phase 2
- SSRF 防护 — 由 stage3-url-fetcher-worker change 实现

## Decisions

### D1: 校验服务位置

**选择**: 在 `apps/api/src/uploads/validators/` 下实现校验服务，作为 uploads 模块的内部组件。每个校验器是独立类：MimeValidator、ZipValidator、PromptInjectionScanner。

**理由**: 校验逻辑与 upload 强关联，不需要跨模块复用。独立类便于单元测试和按需组合。

**替代方案**: 独立 packages/security — 过度抽象，当前只有 upload 需要这些校验。

### D2: Magic Bytes 检测

**选择**: 使用 `file-type` npm 包读取文件头部字节判断真实 MIME 类型。将检测到的真实类型与声明的 Content-Type 和扩展名三方交叉验证。不一致则拒绝。

**理由**: `file-type` 是成熟的开源库，支持 200+ 文件类型，基于 magic bytes 而非扩展名。

### D3: ZIP 安全解压

**选择**: 使用 `yauzl`（只读 ZIP 解析器）进行安全检查，不使用 `unzip` CLI。检查项：
1. 遍历 entries，累计 uncompressedSize，超 500MB 立即中止
2. 每个 entry 路径检查 `../` 或以 `/` 开头
3. 递归检测嵌套 ZIP，超 3 层拒绝

**理由**: `yauzl` 是纯 JS 实现，不依赖系统命令，可控性好。只读遍历 entries 不实际解压，检查速度快。

### D4: Prompt Injection 检测

**选择**: 基于正则模式匹配的扫描器。扫描 parsed.md 内容，匹配已知 injection 模式（如 "ignore previous instructions"、"system prompt"、角色注入模式等）。匹配则在 source_document.metadata_json 中标记 `injection_risk: true`。

**理由**: 模式匹配是 Phase 1 最简实现，可逐步扩展模式库。LLM-based 检测是 Phase 2 增强。

**注意**: Prompt injection 检测在解析完成后执行（扫描 parsed.md），不在 quarantine 校验阶段。

### D5: 校验管线编排

**选择**: `ValidationPipeline` 类按顺序执行校验步骤，任一步骤失败立即短路返回。步骤顺序：
1. FileSize check（已在 upload controller 层，这里不重复）
2. MIME + magic bytes 验证
3. 扩展名白名单匹配
4. ZIP 安全检查（仅 ZIP 文件）

每步返回 `{pass: boolean, reason?: string, details?: object}`。失败时 details 记录到 source_document.metadata_json 和 audit_logs。

**理由**: 管线模式清晰、可扩展（后续加 ClamAV 只需新增一步）、短路节省资源。

## Risks / Trade-offs

- **[R1] Magic bytes 误判** → 某些文件类型 magic bytes 不明确（如 CSV/TXT 无 magic bytes）。Mitigation: 对纯文本类型放宽校验，仅校验 binary 文件类型。
- **[R2] ZIP 检查性能** → 大 ZIP 包含数万 entries 时遍历耗时。Mitigation: entry 数量超 10000 直接拒绝。
- **[R3] Injection 模式漏报** → 正则无法覆盖所有变体。Mitigation: Phase 1 先覆盖高频模式，Phase 2 引入 LLM 检测。模式库可热更新。
- **[R4] 校验阻塞上传响应** → Small 文件同步校验可能增加响应延迟。Mitigation: magic bytes 检测仅需读取前 4KB，通常 <10ms。
