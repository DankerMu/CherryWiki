# Stage 3 手动测试清单

测完后删除本文件。

## 前置条件

```bash
docker compose up -d
# 等待所有服务 healthy
docker compose ps
```

确认以下服务运行中：cherry-api、cherry-web、postgres、redis、minio、ingestion-worker、url-fetcher-worker

---

## 1. Upload API 冒烟

### 1.1 文件上传（Small ≤5MB）
```bash
# 准备一个小 PDF
curl -X POST http://localhost:8080/api/spaces/<SPACE_ID>/uploads \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@test.pdf"
```
- [ ] 返回 201，body 含 `source_document_id`、`status`
- [ ] MinIO `cherrywiki-archives` bucket 中出现 archive 路径文件
- [ ] 数据库 `source_documents` 表状态最终到 `parsed`

### 1.2 文件上传（Medium 5-50MB）
- [ ] 返回 201，status=`validating`
- [ ] validation job 创建（`jobs` 表 type=validation）
- [ ] validation 完成后自动创建 ingestion job
- [ ] 最终 status=`parsed`

### 1.3 超大文件拒绝（>200MB）
```bash
dd if=/dev/zero of=/tmp/big.bin bs=1M count=210
curl -X POST http://localhost:8080/api/spaces/<SPACE_ID>/uploads \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/tmp/big.bin"
```
- [ ] 返回 413

### 1.4 SHA256 去重
- [ ] 同文件二次上传 → 返回 200（非 201），复用已有 source_document_id
- [ ] 跨 Space 同文件 → 共享 file_blob，独立 source_document

### 1.5 URL 上传
```bash
curl -X POST http://localhost:8080/api/spaces/<SPACE_ID>/uploads \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","source_type":"url"}'
```
- [ ] 返回 201，source_type=url，file_blob_id=null
- [ ] jobs 表出现 type=url_fetch 的 job

### 1.6 列表与状态查询
```bash
curl http://localhost:8080/api/spaces/<SPACE_ID>/uploads \
  -H "Authorization: Bearer <TOKEN>"
```
- [ ] 返回分页列表
- [ ] `GET /api/uploads/:id/status` 返回 status + job 进度

### 1.7 重处理
- [ ] 对 `parse_failed` 文档调用 `POST /api/uploads/:id/reprocess` → 新 ingestion job 创建
- [ ] 对非 `parse_failed` 文档调用 → 返回 409

---

## 2. 安全校验

### 2.1 MIME 伪装拒绝（P1-E15）
```bash
# 创建 ELF 伪装为 PDF
cp /usr/bin/true /tmp/fake.pdf
curl -X POST http://localhost:8080/api/spaces/<SPACE_ID>/uploads \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/tmp/fake.pdf"
```
- [ ] 返回 422，error_code=`MIME_MISMATCH`
- [ ] `audit_logs` 表有 action=`upload.security_rejected` 记录

### 2.2 Shell 脚本伪装 .txt（P1-E15）
```bash
echo '#!/bin/bash\nrm -rf /' > /tmp/notes.txt
curl -X POST http://localhost:8080/api/spaces/<SPACE_ID>/uploads \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/tmp/notes.txt"
```
- [ ] 返回 422，被 shebang 检测拦截

### 2.3 ZIP bomb（P1-E14）
- [ ] 上传解压后 >500MB 的 ZIP → 拒绝，error_code=`ZIP_BOMB_DETECTED`

### 2.4 ZIP 路径穿越（P1-E14）
- [ ] 上传含 `../../etc/passwd` entry 的 ZIP → 拒绝，error_code=`PATH_TRAVERSAL_DETECTED`

### 2.5 ZIP 嵌套过深（P1-E14）
- [ ] 上传 4 层嵌套 ZIP → 拒绝，error_code=`ZIP_NESTING_EXCEEDED`

---

## 3. Ingestion Worker

### 3.1 PDF 解析
- [ ] 上传真实 PDF → MinIO 出现 `{sha256}.parsed.md`
- [ ] parsed.md 含 YAML frontmatter（source_document_id, filename, parsed_at 等）
- [ ] parsed.md 含提取的文本内容

### 3.2 DOCX/PPTX/XLSX 解析
- [ ] 各上传一个真实文件 → parsed.md 生成，内容合理

### 3.3 Markdown/TXT 直接读取
- [ ] 上传 .md → parsed.md 内容与原文一致

### 3.4 解析失败
- [ ] 上传损坏的 PDF → status=`parse_failed`，archive 文件保留

### 3.5 超时
- [ ] 上传极大/极复杂文件 → 300s 超时后 error_type=timeout

---

## 4. URL Fetcher Worker

### 4.1 正常抓取（P1-E11）
- [ ] 提交 `https://example.com` → 抓取成功 → snapshot 存入 MinIO → ingestion job 自动创建
- [ ] source_document 最终有 file_blob_id（非 null）

### 4.2 SSRF 拦截 — localhost（P1-E12）
```bash
curl -X POST http://localhost:8080/api/spaces/<SPACE_ID>/uploads \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://127.0.0.1:8080/api/admin/health","source_type":"url"}'
```
- [ ] job 失败，error_type=`ssrf_blocked`
- [ ] `audit_logs` 有 action=`upload.ssrf_blocked`

### 4.3 SSRF 拦截 — 私网 IP（P1-E12）
- [ ] `http://10.0.0.1/` → 拦截
- [ ] `http://172.16.0.1/` → 拦截
- [ ] `http://192.168.1.1/` → 拦截

### 4.4 SSRF 拦截 — metadata 端点（P1-E12）
- [ ] `http://169.254.169.254/latest/meta-data/` → 拦截

### 4.5 响应超大
- [ ] 提交一个已知 >50MB 文件的 URL → abort，error_type=`response_too_large`

---

## 5. Upload Center UI（浏览器）

打开 `http://localhost:5173/spaces/<SPACE_ID>/uploads`

### 5.1 文件上传
- [ ] 拖拽文件到上传区域 → 上传开始，显示进度条
- [ ] 点击上传区域 → 文件选择器弹出
- [ ] 上传不支持的文件类型（如 .exe）→ 前端拒绝，不发请求
- [ ] 上传 >200MB → 前端拒绝提示

### 5.2 URL 上传
- [ ] 输入 `https://example.com` 点击添加 → 列表出现新条目
- [ ] 输入 `ftp://example.com` → 前端校验拒绝

### 5.3 上传列表
- [ ] 列表显示 filename/status/time 列
- [ ] 处理中文件蓝色标签，完成绿色，失败红色
- [ ] 分页正常工作
- [ ] 空列表显示提示文字

### 5.4 详情与重处理
- [ ] 点击列表项 → 详情抽屉/模态框展示元数据
- [ ] 处理中项显示进度百分比
- [ ] 失败项显示 error_type + error_message
- [ ] `parse_failed` 项显示"重新处理"按钮，点击后状态重置

### 5.5 状态轮询
- [ ] 上传文件后，列表自动刷新状态（约 5s 间隔）
- [ ] 所有文件到终态后，Network 面板中轮询请求停止
- [ ] 切换到其他页面 → 轮询停止（无内存泄漏）

---

## 6. 权限验证

- [ ] Admin 用户可上传（upload:create）
- [ ] Editor 用户可上传
- [ ] Viewer 用户只能查看（upload:read），上传返回 403
- [ ] 无权限用户访问 uploads 列表 → 403

---

## 完成

- [ ] 以上全部通过
- [ ] 删除本文件：`rm STAGE3_MANUAL_TEST_CHECKLIST.md`
