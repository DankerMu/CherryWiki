## Why

Upload API 将文件归档到 MinIO，安全校验管线确保文件安全。但系统目前没有将 PDF/DOCX/MD/TXT/图片等原始文件转化为 Graphify 可处理的 Markdown 的能力。ingestion-worker 是整个知识处理链路的核心转换器：它在独立沙箱容器中解析各类文件，产出标准化的 `parsed.md` + 元数据，作为后续 Graphify 的唯一输入源。

设计文档要求解析必须在独立容器中执行（不在 cherry-api 内），具备进程隔离、无网络外联、资源限制、超时 kill 等安全措施（威胁模型 T1）。

## What Changes

- 新增 `apps/ingestion-worker/` Python 服务：基于 Stage 2 的 Worker 协议，通过 Internal API 拉取 ingestion Job、上报进度、完成/失败
- 实现多格式解析：PDF（pdfplumber + OCR fallback）、DOCX（python-docx/pandoc）、PPTX/XLSX（python-pptx/openpyxl）、MD/TXT/RST（直接读取/pandoc）、图片（OCR/vision model placeholder）
- 实现 parsed.md 产物输出，含标准 frontmatter 元数据（source_document_id、extraction_tool、extraction_params、duration_ms、page/char/image count）
- 实现解析沙箱约束：独立 tmpdir/job、资源限制（2GB RAM、2 cores、5GB disk）、300s 超时、非 root 运行
- ZIP 文件解压后逐文件解析，失败文件不阻塞其余
- 解析完成后更新 source_document status=parsed，存储 parsed.md 到 MinIO
- 解析失败后更新 source_document status=parse_failed，记录 error_json

## Capabilities

### New Capabilities

- `document-parsing`: 多格式文档解析引擎，PDF/DOCX/PPTX/XLSX/MD/TXT/RST/图片 → 标准化 Markdown
- `parsed-output`: parsed.md 产物规范，含 frontmatter 元数据、解析追溯信息
- `ingestion-worker-protocol`: Python Worker 生命周期，Job 拉取/进度上报/完成/失败，与 Stage 2 Internal API 集成

### Modified Capabilities

(无已有 spec 需要修改)

## Impact

- **apps/**: 新增 `apps/ingestion-worker/` Python 应用（或扩展 `apps/graphify-worker/`）
- **Python 依赖**: pdfplumber、python-docx、python-pptx、openpyxl、pandoc（可选）、Pillow、pytesseract
- **MinIO**: 读取 archive/ 下原文件，写入 parsed.md 到 archive/{path}/{sha256}.parsed.md
- **Docker**: ingestion-worker 容器配置（无网络、资源限制、非 root）
- **Job 系统**: 消费 ingestion 类型 Job，通过 Internal API 上报状态
- **source_documents**: status 从 archived → parsing → parsed / parse_failed
