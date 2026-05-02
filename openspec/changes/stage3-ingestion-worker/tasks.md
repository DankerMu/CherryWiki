## 1. Worker 应用脚手架

- [ ] 1.1 创建 apps/ingestion-worker/ 目录结构（src/、tests/、requirements.txt、Dockerfile）
- [ ] 1.2 创建 Python 虚拟环境 apps/ingestion-worker/.venv/
- [ ] 1.3 安装依赖：pdfplumber、python-docx、python-pptx、openpyxl、Pillow、pytesseract、requests、pyyaml
- [ ] 1.4 复用/引用 graphify-worker 的 worker_base 模块（Internal API 客户端、心跳、Job 轮询）
- [ ] 1.5 实现 main.py 入口：worker_id 生成、轮询循环、心跳线程、graceful shutdown

## 2. 解析器实现

- [ ] 2.1 创建 src/parsers/ 目录和 base_parser.py（抽象基类：parse(file_path) → ParseResult(content, metadata)）
- [ ] 2.2 实现 PdfParser：pdfplumber 逐页提取文本+表格，表格转 Markdown 表格格式
- [ ] 2.3 实现 PdfParser OCR fallback：检测无文本页面 → pytesseract OCR（chi_sim+eng）
- [ ] 2.4 实现 DocxParser：python-docx 提取标题/段落/表格/列表，保留标题层级
- [ ] 2.5 实现 PptxParser：python-pptx 提取幻灯片标题+文本+注释
- [ ] 2.6 实现 XlsxParser：openpyxl 逐 sheet 转 Markdown 表格
- [ ] 2.7 实现 TextParser：MD/MDX/TXT 直接读取，RST pandoc 转换（fallback 正则）
- [ ] 2.8 实现 ImageParser：pytesseract OCR 提取文本，无文本时返回元数据描述
- [ ] 2.9 实现解析器注册表：根据 MIME 类型自动路由到对应解析器
- [ ] 2.10 编写每个解析器的单元测试（使用测试样本文件）

## 3. Parsed.md 产物生成

- [ ] 3.1 实现 parsed.md 生成器：组装 YAML frontmatter + Markdown 正文
- [ ] 3.2 实现 frontmatter 字段填充：source_document_id、filename、source_type、uploaded_by、space_id、sha256、parsed_md_hash、parsed_at、extraction_tool/version、extraction_params
- [ ] 3.3 实现 extraction_duration_ms 计时
- [ ] 3.4 实现 page_count/char_count/image_count 统计
- [ ] 3.5 实现 parsed_md_hash（SHA256 of parsed content）和 preview_hash（SHA256 of first 500 chars）计算
- [ ] 3.6 实现 preview.txt 生成（前 500 字符）
- [ ] 3.7 编写产物生成单元测试

## 4. Job 执行流程

- [ ] 4.1 实现 IngestionJobHandler：接收 Job → 下载 archive 文件 → 选择解析器 → 解析 → 上传产物 → 完成
- [ ] 4.2 实现 MinIO 文件下载到 tmpdir
- [ ] 4.3 实现 parsed.md + preview.txt 上传到 MinIO（archive/{path}/{sha256}.parsed.md）
- [ ] 4.4 实现进度上报（downloading 10% → parsing 20-80% → uploading 90% → done 100%）
- [ ] 4.5 实现 300s 超时（signal.alarm），超时后 abort 并报 error_type=timeout
- [ ] 4.6 实现 tmpdir 清理（finally 块，成功/失败都清理）
- [ ] 4.7 实现 error_json 构造（error_type、error_message、stderr、stack_trace）
- [ ] 4.8 实现 source_document 状态更新（通过 Job result_json 传递 parsed_uri 和 metadata）

## 5. ZIP 批量处理

- [ ] 5.1 实现 ZipHandler：解压 ZIP → 逐文件调用对应解析器 → 聚合结果
- [ ] 5.2 实现单文件失败不阻塞：收集所有子文件解析结果，成功和失败分别上报
- [ ] 5.3 为每个 ZIP 子文件创建对应的 source_document 子记录（通过 API 或 Job result）
- [ ] 5.4 编写 ZIP 批量处理单元测试

## 6. Docker 配置

- [ ] 6.1 编写 apps/ingestion-worker/Dockerfile（Python 3.11、非 root、安装系统依赖 tesseract-ocr）
- [ ] 6.2 在 docker-compose 中添加 ingestion-worker 服务配置（mem_limit: 2g、cpus: 2、network: internal-only）
- [ ] 6.3 配置环境变量（CHERRY_API_URL、WORKER_API_KEY、MINIO_ENDPOINT 等）

## 7. 测试

- [ ] 7.1 编写 Worker 完整生命周期集成测试：poll → download → parse → upload → complete
- [ ] 7.2 编写各格式解析集成测试（PDF/DOCX/PPTX/XLSX/MD/TXT/图片，使用真实测试文件）
- [ ] 7.3 编写解析失败集成测试（P1-E8）：corrupted PDF → parse_failed → archive 文件保留
- [ ] 7.4 编写超时测试：模拟超时 → error_type=timeout
- [ ] 7.5 编写 ZIP 批量解析测试：混合成功/失败文件
- [ ] 7.6 编写 frontmatter 完整性测试：验证所有必填字段存在
