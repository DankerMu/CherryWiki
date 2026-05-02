## Context

URL 上传通过 Upload API（change 1）创建 source_document(source_type=url) 和 url_fetch Job。本 change 实现消费该 Job 的 Python Worker，在独立容器中安全抓取 URL 内容。

安全架构参考：`docs/engineering/24_威胁建模与安全用例.md` T3（SSRF），`docs/requirements/07_模块需求_资料上传归档解析.md` §6.2A（URL 抓取沙箱）。

SSRF 防护是 Phase 1 Critical，必须在架构层面（独立容器 + 网络策略）和代码层面（IP 校验 + DNS pinning）双重实现。

## Goals / Non-Goals

**Goals:**

- 实现安全的 URL 内容抓取，产出快照文件存入 MinIO
- 实现完整 SSRF 防护：DNS pinning、私网 IP 拦截、redirect 重验证、egress proxy
- 抓取完成后自动创建 ingestion Job（链式 Job 触发）
- 抓取失败正确报告 error_json

**Non-Goals:**

- HTML → Markdown 转换 — 由 ingestion-worker 处理（抓取的 HTML 是 ingestion 输入）
- JavaScript 渲染（SPA 页面）— Phase 2，Phase 1 仅抓取静态 HTML
- 登录态/Cookie 保持 — Phase 2

## Decisions

### D1: SSRF 防护实现

**选择**: 三层防护。

1. **DNS 层**: 使用 `dnspython` 自行解析 URL hostname 为 IP，然后校验 IP 是否在禁止列表（私网/环回/链路本地/metadata）。解析后锁定 IP（DNS pinning），后续请求直接使用解析后的 IP。
2. **请求层**: 使用 `requests` 库但禁用自动 redirect（`allow_redirects=False`）。手动跟踪每个 redirect，每跳重新 DNS 解析并 IP 校验。
3. **网络层**: Docker 容器配置独立网络，仅允许通过 egress proxy 出站到公网 80/443。

**理由**: DNS pinning 防止 DNS rebinding（攻击者在 DNS TTL 内切换 IP）。手动 redirect 防止服务端 redirect 到内网。三层冗余保证即使单层被绕过仍有保护。

### D2: 禁止 IP 范围

**选择**:
- 127.0.0.0/8 (localhost)
- 10.0.0.0/8 (private)
- 172.16.0.0/12 (private)
- 192.168.0.0/16 (private)
- 169.254.0.0/16 (link-local, AWS metadata)
- ::1 (IPv6 localhost)
- fc00::/7 (IPv6 private)
- fe80::/10 (IPv6 link-local)
- 0.0.0.0/8 (current network)

**理由**: 覆盖所有 RFC 1918 私网地址、环回地址、链路本地地址和云 metadata 端点。

### D3: 快照存储

**选择**: 抓取的 HTTP 响应体（HTML/PDF/其他）直接存为快照文件到 MinIO。路径：`archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256_of_content}_{sanitized_hostname}.snapshot`。同时创建 file_blob 记录（计算 SHA256 去重）。

**理由**: 保留原始抓取内容，与文件上传共用 file_blob 去重机制。快照文件后续由 ingestion-worker 按普通文件处理。

### D4: 链式 Job 触发

**选择**: url-fetcher-worker 抓取完成后：
1. 创建 file_blob（如 SHA256 不重复）
2. 通过 PATCH /internal/jobs/{id}/complete 的 result_json 传递 file_blob_id
3. cherry-api 的 Job 完成回调中检测 job.type=url_fetch，自动创建 ingestion Job

**理由**: 利用 Stage 2 Job 系统的完成回调机制，避免 url-fetcher-worker 直接创建 Job（减少 Worker 权限）。

**替代方案**: Worker 直接调用 Internal API 创建 Job — 但这要求 Worker 有创建 Job 的权限，违反最小权限原则。

### D5: Redirect 跟踪限制

**选择**: 最多跟踪 5 次 redirect。每次 redirect 重新 DNS 解析目标 URL 的 hostname 并校验 IP。超过 5 次 redirect 中止并报告 error_type=too_many_redirects。

**理由**: 防止无限 redirect 循环和通过多次 redirect 逐步引向内网的攻击。

## Risks / Trade-offs

- **[R1] DNS rebinding 时间窗口** → DNS 解析和实际请求之间有微小时间窗口。Mitigation: DNS pinning（解析后直接使用 IP 连接，不再查询 DNS）消除窗口。
- **[R2] IPv6 绕过** → 某些环境 IPv4 校验通过但 IPv6 可达内网。Mitigation: 同时校验 IPv4 和 IPv6 地址，禁止 IPv6 私网范围。
- **[R3] 响应体大小** → 恶意服务器发送超大响应。Mitigation: 使用流式下载，累计超 50MB 立即中止连接。
- **[R4] 慢速响应攻击** → 服务器极慢发送数据占用连接。Mitigation: 总超时 30s，连接超时 10s。
- **[R5] Egress proxy 可用性** → Proxy 故障导致所有 URL 抓取失败。Mitigation: 健康检查 + 告警，MVP 阶段可直接出站但必须有 IP 校验。
