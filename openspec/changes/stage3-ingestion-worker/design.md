## Context

Stage 2 已交付 Worker 协议：Python Worker 通过 Internal API（GET /internal/jobs/pending, PATCH /internal/jobs/{id}/progress|complete|fail, POST /internal/workers/heartbeat）与 cherry-api 交互。`apps/graphify-worker/` 已有 Python Worker 骨架和虚拟环境。

本 change 新增 `apps/ingestion-worker/` 作为独立 Python 服务，复用 Stage 2 的 Worker 基类和协议。ingestion-worker 专注于文件解析，在 Docker 中以无网络、资源受限的方式运行。

## Goals / Non-Goals

**Goals:**

- 实现 PDF/DOCX/PPTX/XLSX/MD/TXT/RST/图片的解析，产出标准化 parsed.md
- 遵循 Worker 协议：Job 拉取 → 进度上报 → 完成/失败
- 实现解析沙箱安全约束（独立容器、无网络、资源限制）
- parsed.md 包含完整 frontmatter 元数据，满足 Graphify 输入规范
- 单文件失败不阻塞批量处理中其余文件

**Non-Goals:**

- URL 抓取 — 由 stage3-url-fetcher-worker 实现
- Graphify 处理 — Stage 5
- 病毒扫描 — Phase 2
- Vision model 图片理解 — Phase 1 仅 OCR placeholder

## Decisions

### D1: Worker 应用位置

**选择**: 在 `apps/ingestion-worker/` 创建独立 Python 应用，与 `apps/graphify-worker/` 平行。共享 Worker 基类代码通过 Python package 引用（或复制 Stage 2 的 worker_base 模块）。

**理由**: ingestion-worker 和 graphify-worker 有不同的依赖（解析库 vs LLM SDK）和不同的安全策略（无网络 vs 需要 LLM API），应作为独立容器部署。

**替代方案**: 扩展 graphify-worker 加 ingestion 功能 — 但违反隔离原则且依赖膨胀。

### D2: 解析工具选择

**选择**:

| 格式 | 工具 | 备注 |
|---|---|---|
| PDF | pdfplumber | 文本+表格提取，fallback pytesseract OCR |
| DOCX | python-docx | 提取文本+表格+图片引用 |
| PPTX | python-pptx | 提取幻灯片文本+注释 |
| XLSX | openpyxl | 提取表格数据为 Markdown 表格 |
| MD/MDX | 直接读取 | 仅规范化 frontmatter |
| TXT/RST | 直接读取 / pandoc | RST 用 pandoc 转 Markdown |
| 图片 | pytesseract | Phase 1 OCR，Phase 2 vision model |

**理由**: 选择成熟的纯 Python 库，避免系统级依赖。pdfplumber 比 PyPDF2 表格提取更好。

### D3: 解析流程

**选择**:

```
1. 从 MinIO 下载 archive 文件到 job 独立 tmpdir
2. 根据 MIME 类型选择解析器
3. 执行解析，提取文本/表格/图片描述
4. 生成 parsed.md（含 frontmatter 元数据）
5. 计算 parsed_md_hash (SHA256)
6. 上传 parsed.md 到 MinIO (archive/{path}/{sha256}.parsed.md)
7. 更新 source_document: status=parsed, parsed_uri=parsed.md 路径
8. 清理 tmpdir
```

每步上报 progress（如 downloading=10%, parsing=50%, uploading=90%）。

### D4: 超时与资源限制

**选择**: Python 层面使用 signal.alarm 设置 300s 超时。Docker 层面配置 `mem_limit: 2g`、`cpus: 2`、`storage_opt: size=5g`。每个 Job 使用 `tempfile.mkdtemp()` 创建独立工作目录，完成/失败后 `shutil.rmtree()` 清理。

**理由**: 双层防护。Python 层超时保证单 Job 不会永久阻塞 Worker。Docker 层资源限制防止恶意文件耗尽宿主机资源。

### D5: ZIP 文件处理

**选择**: ZIP 文件已由安全校验管线验证安全后才进入 ingestion-worker。ingestion-worker 解压 ZIP，对每个子文件独立解析，产出多个 parsed.md。每个子文件对应一个 source_document 子记录。单个子文件解析失败不影响其余。

**理由**: 原子化处理，失败可定位到具体文件。

### D6: 错误处理

**选择**: 解析失败时捕获异常，构造 error_json（含 error_type, error_message, stderr, exit_code, stack_trace），通过 Internal API 的 fail 端点上报。source_document 状态转为 parse_failed。原始 archive 文件不删除。

**理由**: 遵循 P1-E8 要求（解析失败保留原文件），error_json 支持运维排查。

## Risks / Trade-offs

- **[R1] OCR 质量** → pytesseract 对中文 PDF 识别率有限。Mitigation: Phase 1 先支持文本型 PDF，扫描件 OCR 标注为 best-effort。
- **[R2] Office 格式复杂性** → 复杂排版的 DOCX/PPTX 可能丢失格式。Mitigation: 以文本内容为主，表格保留 Markdown 表格格式，图片仅提取引用描述。
- **[R3] 大文件解析内存** → 2GB 内存可能不够大型 PDF。Mitigation: pdfplumber 逐页处理，不一次加载全部页面。
- **[R4] Python 依赖冲突** → 多个解析库可能有版本冲突。Mitigation: requirements.txt 锁定版本，Docker 镜像固定。
