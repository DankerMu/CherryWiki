# CherryGraph Studio — v0.4 审查整改 TODO

> 本文件基于 GPT Pro 审查（2026-04-28）+ Claude 审核确认后的整改清单。  
> `[x]` = 已完成并合入文档，`[ ]` = 待完成。

## 已完成的整改（本轮审查 commit 记录）

### P2-1 ~ P2-6 基础整改

- [x] **T-11.3** API 文档从目录式升级为完整契约（request/response/error/permission/audit）。
- [x] **T-11.3b** OpenAPI 补齐 Bridge 鉴权 schema（bridgeBearer + bridgeHmacAuth）。
- [x] **T-11.6** SSRF 防护升为 Phase 1 P0（安全文档 + 测试用例）。
- [x] **T-11.7** Prompt Injection 风险与防护（RAG §4C + 安全文档 §4C + 测试 §4.5）。
- [x] SSE 事件补齐（retrieval.completed/failed, rerank.completed, message.error, usage.reported + 公共元数据 + 断线重连）。
- [x] RAG 检索配额与 token budget 表（vector_top_k=30, context_token_budget=12000 等）。
- [x] Docker Compose phase profiles + healthcheck 全覆盖。
- [x] 技术栈定死（NestJS+Fastify, BullMQ, Drizzle ORM）。

### 模块深化

- [x] Chat 回答状态机、引用版本提示、无知识降级策略。
- [x] Graphify Worker 执行协议（job payload, 状态机, 并发互斥, quarantine, 超时）。
- [x] Canonical Wiki Repo git 规范（commit 格式, branch 策略, 发布策略, 回滚策略）。
- [x] Docmost Fork 红线（不依赖私有 API, excludedPaths 安全, 契约测试, rebase CI 门禁）。
- [x] Upload 沙箱 + quarantine + 大小分层 + 解析产物 hash + 失败策略。
- [x] GraphRAG 置信度约束 + 冲突处理 + source chain。

### Schema & API

- [x] Schema 补表：bridge_events, webhook_deliveries, graph_evidence_refs, permission_versions, sessions, system_settings, api_tokens, model_usage_logs。
- [x] API 补充端点：password/change, sessions, jobs 用户级, wiki content, proposal accept/reject, models PATCH/test, consistency check。
- [x] 权限点映射汇总表（50+ 端点）。

### 安全 & 运维

- [x] Bridge replay 防护（timestamp + nonce + HMAC 覆盖范围）。
- [x] 撤权缓存失效（permission_version + 主动清理）。
- [x] 容器沙箱安全（read_only rootfs, no-new-privileges, cap_drop ALL）。
- [x] Graphify 输出校验（节点/边上限, 偏离检测, graph.html sandbox, Markdown 清洗）。
- [x] 资源限制表 + 队列隔离 + 版本展示 + 恢复演练。

### 文档体系

- [x] **T-13.1** 需求追踪矩阵（Doc 26 project）。
- [x] **T-13.2** Phase 1 Scope Lock（Doc 25）。
- [x] **T-13.3** 威胁建模（Doc 24 engineering）。
- [x] 测试按 Phase 拆分 + 5 个关键安全测试。

### Stage 实现状态

- [x] **I-01** Stage 1 Auth/RBAC/Space/Admin 基础已完成；文档追踪矩阵、Docker Compose 和环境变量样例已收口。
- [x] **I-02** Stage 2 Job 系统/对象存储/任务中心已完成；jobs service、BullMQ 队列、Worker 协议、MinIO 封装、任务中心 UI 已交付。
- [x] **I-03** Stage 3 上传/归档/解析/URL Fetcher 已完成；ingestion-worker、url-fetcher-worker、SSRF 防护、ZIP 安全解压、Magic bytes 校验、Prompt injection 标记已交付。
- [x] **I-04** Stage 4 Canonical Wiki Repo / wiki-core / 只读 Wiki 已完成；wiki-core 42 测试 + wiki API 25 测试 + wiki UI 5 测试 + schema/validation 21 测试已交付，移交测试债务记录在需求追踪矩阵 §6.1。
- [x] **I-05** Stage 5 Graphify Worker / graph-core / wiki-normalization 已完成。
- [x] **I-06** Stage 6 Indexer / Vector / BM25 / Source Chain 已完成；Drizzle schema（wikiChunks/embeddings + migration 0007/0008）、ai-core（EmbeddingProvider + OpenAI SDK）、rag-core（chunker + source chain + injection + ACL）、indexer-worker（完整索引管道 + snapshot 生命周期）、API 索引触发（Graphify 完成→reindex、手动 reindex、admin rebuild）已交付，679 自动化测试覆盖。

---

## 待完成 TODO

### P0：开发前必须完成

- [x] **T-14.1** 定义 Graphify Wiki Normalization Algorithm。
  - 已在 `docs/design/21_Graphify_输出Schema契约.md` 中完成，包含页面类型识别、page_id 规则、frontmatter、section anchor、block ownership、冲突策略和转换流程。

- [ ] **T-14.2** 定义 Docmost Markdown ↔ 富文本 round-trip 验证用例。
  - Docmost 使用 Tiptap 编辑器，Markdown → Tiptap JSON → Markdown 可能有信息损耗。
  - 需验证：HTML 注释保留、Frontmatter 保留、表格格式、代码块、Mermaid。
  - 文件：`docs/requirements/06_模块需求_Docmost集成.md` 新增验证矩阵。

- [x] **T-14.3** 完善 openapi.yaml 补充端点 schema。
  - 所有新增端点（password/change, sessions, jobs, content, proposals accept/reject, models PATCH/test, consistency/check）已同步到 openapi.yaml。

### P1：Phase 1 开发中补充

- [x] **T-15.1** 编写 env.example 完整版。
  - 已补齐：`API_BASE_URL`、`WORKER_ID`、`S3_REGION`、`GRAPHIFY_*`、`SSRF_*`、`UPLOAD_*` 等 Worker 配置项。

- [ ] **T-15.2** 编写 nginx.conf.example。
  - Phase 1：代理 cherry-web + cherry-api。
  - Phase 2：追加 docmost upstream。
  - 安全 header（CSP, HSTS, X-Frame-Options）。

- [x] **T-15.3** CI/CD pipeline 已实现。
  - `.github/workflows/ci.yml`：Node（lint/typecheck/build/test/集成测试/audit）+ Python 三 Worker（ruff/pytest）+ Schema 校验（OpenAPI/SQL/Docker Compose）。
  - `.github/workflows/governance.yml`：PR 审查证据门禁。

- [x] **T-15.4** 编写 `tests/fixtures/` 测试数据集。
  - `test-corpus-small/`：4 个 parsed.md 文件（auth/rbac/upload/deployment）。
  - `test-corpus-security/`：SSRF URL 列表、XSS Markdown、Prompt injection 样本。
  - `test-graphify-output/`：graph.json（10 nodes/9 edges）+ GRAPH_REPORT.md + 4 个 wiki 页面，供 Stage 5 导入测试使用。

### P2：后续 Phase 前完善

- [ ] **T-16.1** Docmost Fork 实际代码开发。
  - Bridge module 实现。
  - 契约测试编写。
  - rebase CI workflow 配置。

- [ ] **T-16.2** GraphRAG 完整实现前的 spike。
  - graph.json 导入性能测试（5000 nodes, 10000 edges）。
  - path query 性能基准（4-hop on PostgreSQL）。
  - 决定是否需要 Phase 4 引入 Neo4j。

- [ ] **T-16.3** MCP Gateway 接口设计。
  - Agent tool 定义。
  - 权限策略。
  - Rate limit per token。

---

## 变更记录

| 日期 | 说明 |
|---|---|
| 2026-04-28 | v0.4 审查整改，新增 T-14 ~ T-16 系列。旧 T-1 ~ T-10 全部完成，归档。 |
| 2026-05-01 | Stage 3/4 标记完成（I-03/I-04），T-15.1/T-15.3/T-15.4 完成，Stage 5 开工门禁就绪。 |
| 2026-05-03 | Stage 5/6 标记完成（I-05/I-06），索引构建全链路交付（schema→ai-core→rag-core→indexer-worker→API trigger）。 |
