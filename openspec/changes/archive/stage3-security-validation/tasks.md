## 1. 依赖安装

- [x] 1.1 安装 `file-type` npm 包（magic bytes 检测）
- [x] 1.2 安装 `yauzl` npm 包（ZIP 安全解析）及其类型定义 `@types/yauzl`

## 2. MIME & Magic Bytes 校验器

- [x] 2.1 创建 apps/api/src/uploads/validators/ 目录
- [x] 2.2 实现 MimeValidator：读取文件头 4096 字节，使用 file-type 检测真实类型
- [x] 2.3 实现扩展名白名单检查（.md/.mdx/.txt/.rst/.pdf/.docx/.pptx/.xlsx/.png/.jpg/.jpeg/.webp/.zip）
- [x] 2.4 实现 MIME/magic bytes/扩展名三方一致性校验，含类型映射表
- [x] 2.5 纯文本文件类型（.txt/.md/.mdx/.rst）豁免 strict magic bytes 检查，但检测 shebang 行（#!/）和 null bytes，拒绝脚本伪装
- [x] 2.6 实现标准化错误码：MIME_MISMATCH、ZIP_BOMB_DETECTED、PATH_TRAVERSAL_DETECTED、ZIP_NESTING_EXCEEDED（与 Doc 14 §4.5 对齐）
- [x] 2.7 编写 MimeValidator 单元测试（正常匹配、ELF 伪装 PDF、shell script 伪装 .txt、缺失扩展名、binary 冒充文本、纯文本豁免）

## 3. ZIP 安全校验器

- [x] 3.1 实现 ZipValidator：使用 yauzl 只读打开 ZIP，遍历 entries
- [x] 3.2 实现 ZIP bomb 检测：累计 uncompressedSize >500MB 拒绝 + 单 entry 压缩比 >100:1 拒绝
- [x] 3.3 实现路径穿越检测：entry 路径含 ../ 或 ..\ 或以 / 开头则拒绝（错误码 PATH_TRAVERSAL_DETECTED）
- [x] 3.3a 实现 symlink entry 检测：ZIP entry 的 external file attribute 为 symlink 则拒绝（错误码 ZIP_SYMLINK_DETECTED）
- [x] 3.4 实现嵌套深度检测：递归检查嵌套 ZIP，深度 >3 拒绝
- [x] 3.5 实现 entry 数量限制：>10000 entries 拒绝
- [x] 3.6 实现 ZIP 内文件类型校验：每个解压文件检查扩展名白名单
- [x] 3.7 编写 ZipValidator 单元测试（正常 ZIP、bomb、路径穿越、嵌套过深、过多 entries、禁止类型）

## 4. Prompt Injection 扫描器

- [x] 4.1 创建 injection pattern 库文件（JSON/TS 常量），含 4 类 ≥16 个正则模式
- [x] 4.2 实现 PromptInjectionScanner：加载 pattern 库，扫描 parsed.md 内容，返回 injection_risk + matched_patterns
- [x] 4.3 在 source_document.metadata_json 中标记 injection_risk 和 injection_patterns
- [x] 4.4 编写 PromptInjectionScanner 单元测试（干净内容、单模式匹配、多模式匹配、边界用例）

## 5. 校验管线编排

- [x] 5.1 实现 ValidationPipeline：按顺序执行 MimeValidator → ExtensionWhitelist → ZipValidator（ZIP 文件） → 返回 pass/reject 结果
- [x] 5.2 校验通过时调用 StorageService.promoteToArchive 将文件从 quarantine 移入 archive
- [x] 5.3 校验失败时更新 source_document status=security_rejected，在 metadata_json 记录拒绝原因
- [x] 5.4 校验失败时写入 audit_log（action=upload.security_rejected）
- [x] 5.5 Prompt injection 检测集成到 ingestion-worker 解析后步骤（扫描 parsed.md 后标记）
- [x] 5.6 编写 ValidationPipeline 单元测试（全通过、MIME 拒绝短路、ZIP 拒绝短路）

## 6. 集成到 Upload 流程

- [x] 6.1 在 UploadService.uploadFile 中集成 ValidationPipeline（Small 文件同步校验）
- [x] 6.2 为 Medium/Large 文件，创建 validation 类型 Job（type=validation, queue_name=validation），校验通过后 promote archive 并创建 ingestion Job
- [x] 6.3 编写安全校验集成测试

## 7. 集成测试

- [x] 7.1 编写 magic bytes 伪装拒绝集成测试（P1-E15）：ELF→.pdf 被拒，审计记录
- [x] 7.2 编写 ZIP bomb 拒绝集成测试（P1-E14）：>500MB 解压被拒
- [x] 7.3 编写 ZIP 路径穿越拒绝集成测试（P1-E14）：../../ 路径被拒
- [x] 7.4 编写 ZIP 嵌套过深拒绝集成测试（P1-E14）：>3 层被拒
- [x] 7.5 编写 prompt injection 标记集成测试（P1-E13）：注入内容被标记 injection_risk=true
- [x] 7.6 编写校验通过后 quarantine→archive 移动集成测试
- [x] 7.7 编写审计日志写入集成测试：security_rejected 事件可查询
- [x] 7.8 编写 shell script 伪装 .txt 拒绝测试（P1-E15）：shebang 脚本重命名为 notes.txt 被拒
- [x] 7.9 编写 ZIP symlink entry 拒绝测试：含 symlink 的 ZIP 被拒
- [x] 7.10 编写标准化错误码验证测试：API 响应和审计日志使用相同的 MIME_MISMATCH / ZIP_BOMB_DETECTED 等错误码
