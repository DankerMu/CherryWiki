## Why

用户可通过 Upload API 提交 URL 来导入网页内容作为知识源。URL 抓取涉及外部网络请求，是 SSRF 攻击的主要入口（威胁模型 T3，Phase 1 Critical）。设计要求 URL 抓取必须在独立的 `url-fetcher-worker` 容器中执行，与 cherry-api 和 ingestion-worker 完全隔离，具备 DNS pinning、私网 IP 拦截、重定向校验、egress proxy 等架构级 SSRF 防护。抓取完成后将内容快照投递到 ingestion-worker 队列进行解析。

## What Changes

- 新增 `apps/url-fetcher-worker/` Python 服务：消费 url_fetch Job，抓取 URL 内容
- 实现 SSRF 防护层（P1-E12）：DNS 解析后 IP 校验（禁止 localhost/10.0.0.0/8/172.16.0.0/12/192.168.0.0/16/169.254.0.0/16/::1）、DNS pinning、每跳 redirect IP 重验证
- 实现响应安全：50MB 响应体限制、连接 10s 超时、总 30s 超时
- 抓取内容存为快照文件到 MinIO，创建 file_blob 记录
- 抓取完成后创建 ingestion Job，将快照文件投递到 ingestion-worker 处理队列
- 抓取失败的 URL 标记 source_document status=parse_failed 并记录 error_json
- 安全拒绝事件（SSRF 检测）写入 audit_logs

## Capabilities

### New Capabilities

- `url-fetching`: URL 内容抓取，HTML/文件下载，快照存储到 MinIO
- `ssrf-protection`: 架构级 SSRF 防护，DNS pinning、私网 IP 拦截、redirect 校验、egress proxy

### Modified Capabilities

(无已有 spec 需要修改)

## Impact

- **apps/**: 新增 `apps/url-fetcher-worker/` Python 应用
- **Python 依赖**: requests、dnspython（DNS 解析和 pinning）
- **Docker**: url-fetcher-worker 容器（独立 egress proxy 网络、仅 80/443 出站）
- **MinIO**: 抓取快照写入 archive/，创建 file_blob
- **Job 系统**: 消费 url_fetch Job，完成后创建 ingestion Job（链式触发）
- **审计日志**: SSRF 拒绝事件写入 audit_logs（action: upload.ssrf_blocked）
- **source_documents**: url_fetch 完成后回填 file_blob_id
