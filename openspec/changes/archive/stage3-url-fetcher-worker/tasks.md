## 1. Worker 应用脚手架

- [x] 1.1 创建 apps/url-fetcher-worker/ 目录结构（src/、tests/、requirements.txt、Dockerfile）
- [x] 1.2 创建 Python 虚拟环境 apps/url-fetcher-worker/.venv/
- [x] 1.3 安装依赖：requests、dnspython、pyyaml
- [x] 1.4 复用 worker_base 模块（与 ingestion-worker 共享 Internal API 客户端、心跳、Job 轮询）
- [x] 1.5 实现 main.py 入口：worker_id、轮询循环（type=url_fetch）、心跳线程、graceful shutdown

## 2. SSRF 防护层

- [x] 2.1 实现 IpValidator：检查 IP 是否在禁止范围（127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 0.0.0.0/8, ::1/128, fc00::/7, fe80::/10），含 IPv4-mapped IPv6 canonicalization（::ffff:x.x.x.x → x.x.x.x 后校验）
- [x] 2.2 实现 DnsResolver：使用 dnspython 解析 hostname → IP 列表，校验所有 IP
- [x] 2.3 实现 DNS pinning：解析后锁定 IP，构造直连 IP 的请求（Host header 保留原 hostname）
- [x] 2.4 实现 RedirectHandler：禁用 requests auto-redirect，手动跟踪每个 301/302/307/308，每跳重新 DNS 解析 + IP 校验，最多 5 跳
- [x] 2.5 编写 SSRF 防护单元测试：每个禁止 IP 范围验证、IPv4-mapped IPv6 canonicalization、DNS pinning 验证、redirect 攻击验证

## 3. URL 抓取实现

- [x] 3.1 实现 UrlFetcher：接收 URL → DNS 解析 → IP 校验 → DNS pinning → 流式下载 → 返回快照内容
- [x] 3.2 实现流式下载 + 50MB 大小限制：累计字节数超限立即 abort
- [x] 3.3 实现超时配置：连接 10s + 总 30s
- [x] 3.4 实现 clean 请求：不注入内部 header/cookie/token，使用 generic User-Agent
- [x] 3.5 编写 URL 抓取单元测试（成功下载、404、超时、超大响应）

## 4. Job 执行流程

- [x] 4.1 实现 UrlFetchJobHandler：接收 Job → 提取 URL → 调用 UrlFetcher → 存储快照 → 创建 file_blob → 上报完成
- [x] 4.2 实现快照存储到 MinIO（路径: archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}_{hostname}.snapshot）
- [x] 4.3 实现 file_blob 创建/去重（计算 SHA256，查询已有，复用或新建）
- [x] 4.4 实现 result_json 上报：包含 file_blob_id、snapshot_uri、content_type、size_bytes
- [x] 4.5 实现失败上报：error_json 包含 error_type（ssrf_blocked/fetch_error/connection_timeout/request_timeout/response_too_large）
- [x] 4.6 实现 SSRF 拒绝时写入 audit_log（action=upload.ssrf_blocked，含 target_url、resolved_ip、block_reason）

## 5. 链式 Job 触发（cherry-api 侧）

- [x] 5.1 在 cherry-api 的 Job 完成处理逻辑中，检测 type=url_fetch 的 Job 完成后自动创建 ingestion Job
- [x] 5.2 从 url_fetch Job 的 result_json 提取 file_blob_id 和 snapshot_uri，作为 ingestion Job 的 payload
- [x] 5.3 调用 UploadService.linkBlob 将 file_blob_id 回填到 source_document
- [x] 5.4 编写链式触发单元测试

## 6. Docker 配置

- [x] 6.1 编写 apps/url-fetcher-worker/Dockerfile（Python 3.11、非 root、无特权、cap_drop ALL）
- [x] 6.2 在 docker-compose 中添加 url-fetcher-worker 服务：独立网络（仅 egress-proxy + minio + cherry-api 可达）
- [x] 6.3 配置 egress proxy 服务（squid 或 nginx forward proxy），限制出站端口 80/443
- [x] 6.4 配置环境变量（CHERRY_API_URL、WORKER_API_KEY、MINIO_ENDPOINT、HTTP_PROXY）

## 7. 集成测试

- [x] 7.1 编写 URL 抓取完整流程测试（P1-E11）：提交 URL → url_fetch Job → 抓取 → snapshot → file_blob → ingestion Job 自动创建
- [x] 7.2 编写 SSRF 拦截测试（P1-E12）：localhost URL 被拒 + 审计记录
- [x] 7.3 编写 SSRF 私网 IP 拦截测试（P1-E12）：10.x/172.16.x/192.168.x URL 被拒
- [x] 7.4 编写 SSRF metadata 端点拦截测试（P1-E12）：169.254.169.254 被拒
- [x] 7.5 编写 SSRF redirect 攻击拦截测试（P1-E12）：公网 URL redirect 到私网 IP 被拒
- [x] 7.6 编写 DNS rebinding 防护测试（P1-E12）：DNS pinning 生效验证
- [x] 7.7 编写响应超大拒绝测试：>50MB 响应被 abort
- [x] 7.8 编写快照去重测试：相同 URL 内容复用 file_blob
