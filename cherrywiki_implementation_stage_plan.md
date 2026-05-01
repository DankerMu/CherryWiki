# CherryWiki / CherryGraph Studio 下步实现阶段划分与文档对齐指南

版本：implementation-plan-v0.1  
日期：2026-04-29  
适用仓库：`DankerMu/CherryWiki`  
定位：用于从当前方案文档进入工程实现阶段，明确各阶段目标、范围、依赖、应读文档、交付物和验收标准。

---

## 0. 总体判断

当前方案已经具备进入实现规划的基础。下一步不要直接按“Phase 1 / Phase 2 / Phase 3 / Phase 4”粗粒度开工，而应把产品 Phase 拆成更细的工程 Stage。

产品 Phase 是交付边界：

```text
Phase 1  Cherry Web + Graphify 自动生成 + 只读 Wiki + Vector/BM25 检索 + Chat 引用
Phase 2  Docmost Fork 协作编辑 + 双向同步 + 人工编辑
Phase 3  GraphRAG 完整闭环 + 图索引 + 图路径解释
Phase 4  知识治理与高级能力 + 审计增强 + MCP Gateway
```

工程 Stage 是开发执行边界：

```text
Stage 0   工程基线与仓库脚手架
Stage 1   Auth / RBAC / Space / 基础 Admin
Stage 2   Job 系统 / 对象存储 / 任务中心
Stage 3   上传 / 归档 / 解析 / URL Fetcher
Stage 4   Canonical Wiki Repo / wiki-core / 只读 Wiki
Stage 5   Graphify Worker / Output 导入 / Wiki Normalization
Stage 6   Indexer / Vector / BM25 / Source Chain
Stage 7   Chat Engine / SSE / Citation UI
Stage 8   Phase 1 测试、部署、上线收口
Stage 9   Docmost Fork Bridge
Stage 10  Docmost 双向同步与人工编辑
Stage 11  Graph Index 与 Graph API
Stage 12  GraphRAG 检索、Path UI、Retrieval Trace
Stage 13  知识治理与反馈闭环
Stage 14  MCP Gateway 与高级 Agent
```

---

## 1. 全员必读文档

所有阶段开始前，所有开发人员都应先读这些文档。

| 文档 | 用途 |
|---|---|
| `docs/README.md` | 总索引、总体路线、文档结构。 |
| `docs/architecture/01_方案总览与边界.md` | 项目边界、唯一企业知识引用源、Docmost / Graphify / Cherry 的角色。 |
| `docs/project/16_实施路线图与里程碑.md` | Phase 1-4 总路线。 |
| `docs/project/25_Phase1_Scope_Lock.md` | Phase 1 最高优先级范围锁定文档。 |
| `docs/project/26_需求追踪矩阵.md` | 需求、API、Schema、测试闭合矩阵。 |
| `docs/engineering/13_开发规范.md` | 技术栈、仓库结构、PR、测试、任务、数据库规范。 |
| `docs/engineering/14_测试验收规范.md` | 每阶段验收门禁和安全测试。 |
| `docs/engineering/12_权限安全审计.md` | 权限、ACL、撤权缓存、上传安全、审计。 |
| `docs/engineering/24_威胁建模与安全用例.md` | SSRF、Prompt Injection、越权、Bridge Replay 等威胁模型。 |
| `docs/schemas/schema.sql` | 当前数据库草案。 |
| `docs/schemas/openapi.yaml` | 当前 API 草案。 |

---

## 2. 开发总原则

### 2.1 Phase 1 绝对边界

Phase 1 只做：

```text
登录 / 权限 / Space
上传 / Quarantine / Archive / 解析
URL Fetcher + SSRF 防护
Graphify 后台自动运行
Canonical Wiki Repo
Cherry Web 只读 Wiki
管理员发布 / 回滚
chunk + embedding + index_snapshot
Vector + BM25
Chat with citations
Docker Compose
健康检查
审计日志
```

Phase 1 不做：

```text
Docmost 集成
wiki-sync-worker
Bridge webhook
人工编辑回写
Graph path 解释
完整 GraphRAG
Community summary
Retrieval trace UI
MCP Gateway
知识治理 / 反馈闭环
多 embedding 模型并存
```

### 2.2 唯一企业知识引用源原则

企业知识引用源只能是：

```text
Published Graphify Wiki + 从 Published Wiki 派生的 chunk / graph / index
```

不允许：

```text
Chat 直接读取 source_documents
Chat 直接读取原始 PDF / DOCX / 上传文件
Docmost 未同步 Repo 的页面进入索引
未发布 Wiki 页面进入索引
无 page_id / page_version / ACL 的内容进入检索
```

`strict_knowledge_only` 默认应为 `true`。

无 Wiki 命中时：

```text
strict_knowledge_only=true:
  answer_source = no_hit
  不回答事实性内容
  引导上传或发布相关 Wiki

strict_knowledge_only=false:
  answer_source = model_knowledge
  可基于模型通用知识回答
  citations = []
  必须显式标注非企业知识引用
```

### 2.3 每个 Stage 开工前的对齐动作

每个 Stage 开始前必须检查：

```text
1. 需求是否写入 docs/project/26_需求追踪矩阵.md
2. API 是否在 docs/design/11_API规范.md 或 openapi.yaml 中定义
3. Schema 是否在 docs/schemas/schema.sql 中定义
4. 测试是否在 docs/engineering/14_测试验收规范.md 中有对应项
5. 安全影响是否已在 docs/engineering/12_权限安全审计.md 或 24_威胁建模与安全用例.md 中覆盖
6. 是否违反 docs/project/25_Phase1_Scope_Lock.md
```

任一项不闭合，不建议进入编码。

---

# 3. Phase 1 实现拆分

Phase 1 产品目标：

```text
Cherry Web + Graphify 自动生成 + 只读 Wiki + Vector/BM25 检索 + Chat 引用
```

---

## Stage 0：工程基线与仓库脚手架

### 目标

建立可持续开发的工程骨架，确保后续模块都按统一规范开发。

### 本阶段做什么

```text
- 建立 apps/web
- 建立 apps/api
- 建立 apps/ingestion-worker
- 建立 apps/url-fetcher-worker
- 建立 apps/graphify-worker
- 建立 apps/indexer-worker
- 建立 packages/shared
- 建立 packages/auth-core
- 建立 packages/job-core
- 建立 packages/wiki-core
- 建立 packages/rag-core
- 建立 packages/graph-core
- 建立 packages/ai-core
- 配置 pnpm workspace / tsconfig / lint / test
- 配置 Drizzle migration
- 配置 Docker Compose dev 环境
- 配置基础 CI：lint、typecheck、unit test、OpenAPI 校验、SQL 校验
- 确定 API 统一错误响应格式（见 docs/design/11_API规范.md）
- 确定结构化日志规范（request_id / job_id / tenant_id / space_id 穿透）
- 确定健康检查端点规范
- 准备 tests/fixtures/ 测试数据集骨架（见 todo.md T-15.4）
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/engineering/13_开发规范.md` | 仓库结构、NestJS + Fastify、Drizzle、BullMQ、Python Worker 协同方式。 |
| `docs/audit/20_Cherry_Studio_代码审计.md` | 哪些 Cherry 代码可复用、哪些必须重写。 |
| `docs/ops/docker-compose.skeleton.yml` | 服务清单、profile、healthcheck、Worker 沙箱。 |
| `docs/ops/env.example` | 环境变量基线。 |
| `docs/ops/nginx.conf.example` | Phase 1 Nginx，不代理 Docmost。 |

### 交付物

```text
- 本地 dev 环境可启动
- DB migration 可运行
- API /health 可访问
- Web 空页面可访问
- 所有 Worker healthcheck 可访问
- CI 能跑通
```

### 不做什么

```text
- 不接 Graphify
- 不做上传解析
- 不做 Chat
- 不接 Docmost
```

---

## Stage 1：Auth、RBAC、Space、基础 Admin

### 目标

先把多用户、Group、Space、权限、审计这些地基做实。后面所有上传、Graphify、Wiki、Chat 都依赖它。

### 本阶段做什么

```text
- 用户登录 / refresh token / session 管理
- 用户、Group、Space CRUD
- space_permissions
- permission_version 机制
- 模型配置 model_configs
- 基础 audit_logs
- Admin Console 基础页面
- Space 级 strict_knowledge_only 配置
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/requirements/03_产品需求_PRD.md` | 用户角色、管理后台、Space / 权限基本需求。 |
| `docs/design/10_数据模型与数据库设计.md` | users、groups、spaces、space_permissions、sessions、model_configs。 |
| `docs/schemas/schema.sql` | 实际字段，尤其 `permission_version` 与 `strict_knowledge_only`。 |
| `docs/engineering/12_权限安全审计.md` | 权限主数据源、Space 隔离、撤权缓存失效。 |
| `docs/design/11_API规范.md` | Auth、Space、Admin API 约定。 |
| `docs/project/26_需求追踪矩阵.md` | Phase 1 用户登录、Space、模型、审计追踪项。 |

### 交付物

```text
- POST /api/auth/login
- POST /api/auth/refresh
- POST /api/auth/logout
- GET /api/auth/me
- GET /api/spaces
- POST /api/spaces
- GET /api/spaces/{space_id}
- PATCH /api/spaces/{space_id}
- 用户 / Group 管理 API
- 模型配置 API
- 基础 Admin 页面
- permission_version 缓存 key 机制
```

### 验收

```text
- 用户可登录
- 用户只看到有权限的 Space
- 管理员可创建用户、Group、Space
- 权限变更后 permission_version 增加
- 审计日志记录权限变更
```

---

## Stage 2：Job 系统、对象存储、任务中心

### 目标

先实现统一任务系统。上传解析、URL 抓取、Graphify、索引都走 Job，不允许前端直连 Worker。

### 本阶段做什么

```text
- jobs 表 repository/service
- job 状态机
- BullMQ 基础队列
- Python Worker Job API
- Worker lock / retry / timeout / cancel
- MinIO 基础封装
- 任务中心 UI
- Worker health heartbeat
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/engineering/13_开发规范.md` | 任务规范、Python Worker 与 Node.js 协同。 |
| `docs/requirements/05_模块需求_GraphifyWiki唯一知识源.md` | Graphify Worker job payload 和状态机。 |
| `docs/schemas/schema.sql` | jobs、graphify_runs、index_snapshots。 |
| `docs/design/11_API规范.md` | Job 查看、取消、重试接口。 |
| `docs/engineering/14_测试验收规范.md` | P1-E9 任务取消、Graphify 失败回滚。 |

### 交付物

```text
- jobs service
- GET /api/jobs/{job_id}
- GET /api/jobs/{job_id}/events
- POST /api/jobs/{job_id}/cancel
- Worker 拉取任务内部 API
- Worker 锁和超时扫描
- 任务中心页面
```

### 验收

```text
- 创建 job 后可查询进度
- job 可取消
- worker 崩溃后锁可过期
- 任务失败有 error_json
- 重复 idempotency_key 不产生重复任务
```

---

## Stage 3：上传、归档、解析、URL Fetcher

### 目标

把原始资料安全转成 Graphify 可处理的 Markdown 输入，但不允许原始资料直接进入 Chat。

### 本阶段做什么

```text
- 文件上传 API
- file_blobs / source_documents
- quarantine → archive
- MIME / magic bytes 校验
- ZIP 安全解压
- 大小分层
- ingestion-worker
- url-fetcher-worker
- SSRF 防护
- parsed.md 产物
- prompt injection pattern 标记
- 上传中心 UI
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/requirements/07_模块需求_资料上传归档解析.md` | 上传链路、Source Archive、Quarantine、URL Fetcher、解析产物规范。 |
| `docs/engineering/12_权限安全审计.md` | 上传安全、解析沙箱、URL 抓取安全。 |
| `docs/engineering/24_威胁建模与安全用例.md` | T1、T2、T3、T4 安全威胁。 |
| `docs/schemas/schema.sql` | file_blobs、source_documents、jobs。 |
| `docs/engineering/14_测试验收规范.md` | P1-E6~E8、P1-E11~E15、§4.3/§4.5/§4.5A/§4.5B/§4.5C 安全测试。 |
| `docs/ops/docker-compose.skeleton.yml` | ingestion-worker 和 url-fetcher-worker 安全配置。 |

### 交付物

```text
- POST /api/spaces/{space_id}/uploads
- GET /api/uploads/{source_document_id}
- GET /api/uploads/{source_document_id}/status
- POST /api/uploads/{source_document_id}/reprocess
- ingestion-worker
- url-fetcher-worker
- parsed.md 产物
- 上传中心页面
```

### 验收

```text
- PDF / DOCX / MD / TXT / ZIP 可上传
- 原文件进入 archive
- parsed.md 生成
- ZIP bomb / 路径穿越被拒
- SSRF URL 被拒
- parse_failed 不触发 Graphify
- Source Document 不直接进入 Chat
```

---

## Stage 4：Canonical Wiki Repo 与 wiki-core

### 目标

建立 Graphify Wiki 的规范化仓库、页面版本、发布/回滚、只读浏览能力。这个阶段完成后，系统已经有“唯一企业知识引用源”的核心形态。

### 本阶段做什么

```text
- Canonical Wiki Repo 初始化
- wiki_pages / wiki_page_versions
- frontmatter parser / generator
- page_id / slug / section_id
- status 发布状态机
- 管理员发布 / 回滚
- Cherry Web 只读 Wiki 页面
- source_links 基础证据链
- wiki_sections
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/requirements/05_模块需求_GraphifyWiki唯一知识源.md` | Canonical Wiki Repo、frontmatter、branch、发布、回滚。 |
| `docs/design/21_Graphify_输出Schema契约.md` | Wiki normalization 的目标结构、frontmatter、section anchor。 |
| `docs/design/10_数据模型与数据库设计.md` | wiki_pages、wiki_page_versions、wiki_sections、source_links。 |
| `docs/schemas/schema.sql` | 实际表结构。 |
| `docs/requirements/04_模块需求_CherryWeb_Chat_Admin.md` | 只读 Wiki、引用卡片、版本提示。 |

### 交付物

```text
- wiki-core package
- GET /api/spaces/{space_id}/wiki/pages
- GET /api/spaces/{space_id}/wiki/pages/{page_id}
- GET /api/spaces/{space_id}/wiki/pages/{page_id}/content
- GET /api/spaces/{space_id}/wiki/pages/{page_id}/versions
- POST /api/spaces/{space_id}/wiki/pages/{page_id}/publish
- POST /api/spaces/{space_id}/wiki/pages/{page_id}/rollback
- Cherry Web 只读 Wiki
```

### 验收

```text
- 页面可版本化
- 页面可发布
- 页面可回滚且回滚创建新版本
- 只有 published 页面能进入索引
- 引用可跳转到 Cherry Web 只读 Wiki
```

---

## Stage 5：Graphify Worker 与 Graphify Output 导入

### 目标

跑通“上传解析产物 → manifest → Graphify CLI → graphify-out → Wiki normalization → Canonical Wiki Repo”的自动生产链路。

### 本阶段做什么

```text
- graphify_input_manifest.json 生成
- graphify-worker Python wrapper
- 执行 graphify --wiki
- 输出上传 MinIO
- validation_report.json
- graph.json schema 校验
- wiki/ normalization
- graph_nodes / graph_edges / graph_communities 基础导入（仅入库存储，Phase 1 检索链路不走 graph path）
- raw/effective confidence 导入
- stable_key 计算
- quarantine 机制
- shrink guard
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/requirements/05_模块需求_GraphifyWiki唯一知识源.md` | Graphify Worker 执行协议、manifest、状态机、quarantine。 |
| `docs/design/21_Graphify_输出Schema契约.md` | graph.json 实际结构、输出契约、stable_key、normalization algorithm。 |
| `docs/design/09_RAG与GraphRAG设计.md` | 双置信度模型和回答约束。 |
| `docs/engineering/12_权限安全审计.md` | Graphify 运行安全、输出校验、Markdown 清洗。 |
| `docs/engineering/14_测试验收规范.md` | P1-E1、P1-E4、Graphify schema 异常测试。 |

### 交付物

```text
- POST /api/spaces/{space_id}/graphify/runs
- GET /api/graphify/runs
- GET /api/graphify/runs/{run_id}
- POST /api/graphify/runs/{run_id}/cancel
- POST /api/graphify/runs/{run_id}/retry
- GET /api/graphify/runs/{run_id}/report
- graphify-worker
- graph-core parser
- wiki-core normalization
- quarantine 管理页
```

### 验收

```text
- parsed.md 可触发 Graphify
- Graphify 输出 graph.json / wiki / report
- wiki/ 能转成 Canonical Wiki 页面
- graph.json schema 异常不影响旧索引
- Graphify 失败 active_index_snapshot 不变
- graph 数据仅入库存储和管理员查看，检索不走 graph path（Phase 3 启用）
```

---

## Stage 6：Indexer、Vector/BM25、引用链

### 目标

让 Published Wiki 变成可检索对象，构建 Phase 1 的 RAG 基础能力。

### 本阶段做什么

```text
- chunking
- wiki_sections
- wiki_chunks
- source_chain_json
- embeddings
- PostgreSQL FTS
- index_snapshots
- active_index_snapshot 原子激活
- embedding model 单模型约束
- strict_knowledge_only 检索策略
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/design/09_RAG与GraphRAG设计.md` | Phase 1 的 `wiki_only` / `hybrid_text`，source chain，strict_knowledge_only。 |
| `docs/design/10_数据模型与数据库设计.md` | index_snapshots、一致性、embedding 模型管理。 |
| `docs/schemas/schema.sql` | wiki_chunks、embeddings、index_snapshots、source_chain_json。 |
| `docs/architecture/08_强耦合设计_六层.md` | Phase 1 的数据源、索引、权限耦合边界。 |
| `docs/engineering/14_测试验收规范.md` | P1-E2、P1-E5、性能指标。 |

### 交付物

```text
- indexer-worker
- chunker
- embedding service
- BM25 / FTS search
- index_snapshot builder
- snapshot activation
- index consistency check
```

### 验收

```text
- Published Wiki 可被 chunk
- embedding 写入成功
- BM25 可检索
- active_index_snapshot 原子切换
- 未发布页面不被检索
- Source Document 不直接检索
```

---

## Stage 7：Chat Engine、SSE、Citation UI

### 目标

完成 Phase 1 用户真正可用的闭环：提问 → 检索 Published Wiki → 模型回答 → 引用可点击。

### 本阶段做什么

```text
- Chat conversation / message
- SSE streaming
- retrieval_mode = wiki_only / hybrid_text
- context packing
- answer_source = knowledge_base / no_hit / model_knowledge / mixed
- citations
- answer_citations
- 引用版本提示
- Chat UI
- 无知识命中策略
- no_retrieval_hit 审计
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/requirements/04_模块需求_CherryWeb_Chat_Admin.md` | Chat UI、SSE、answer_source、引用版本提示。 |
| `docs/design/09_RAG与GraphRAG设计.md` | Phase 1 检索模式、Prompt injection 防护、回答约束。 |
| `docs/design/11_API规范.md` | Chat API、SSE 事件、统一响应。 |
| `docs/engineering/12_权限安全审计.md` | 检索前/中/后/回答前权限过滤。 |
| `docs/engineering/14_测试验收规范.md` | P1-E2、P1-E3、P1-E5、安全测试。 |

### 交付物

```text
- POST /api/chat/completions
- SSE event stream
- Chat 页面
- Citation 卡片
- answer_citations 结构化落库
- strict_knowledge_only 策略
```

### 验收

```text
- Chat 首 token P95 < 3s
- 回答带 Wiki citation
- citation 可跳转只读 Wiki
- 无权限 Space 不进入候选
- 无知识命中严格模式返回 no_hit
- 宽松模式才返回 model_knowledge
- Prompt injection 不改变系统行为
```

---

## Stage 8：Phase 1 收口、测试、部署、发布

### 目标

把 Phase 1 从“功能跑通”变成“可交付成品”。

### 本阶段做什么

```text
- P1-E1 ~ P1-E15 E2E
- S1 ~ S8 安全测试
- 权限撤权即时生效测试
- Graphify schema 异常回滚测试
- SSRF 测试
- Prompt injection 测试
- Docker Compose 一键启动
- Nginx Phase 1 配置
- AGPL / 许可证声明
- 最小运维文档
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/project/25_Phase1_Scope_Lock.md` | Phase 1 上线范围、禁止捷径、验收数据集。 |
| `docs/engineering/14_测试验收规范.md` | Phase 1 上线门禁。 |
| `docs/engineering/24_威胁建模与安全用例.md` | 安全测试对应威胁。 |
| `docs/engineering/15_部署运维规范.md` | 部署、备份、健康检查、日志。 |
| `docs/ops/docker-compose.skeleton.yml` | Compose 启动。 |
| `docs/ops/nginx.conf.example` | Phase 1 Nginx。 |
| `docs/project/18_开源许可证与合规说明.md` | AGPL、源码入口、许可证声明。 |

### Phase 1 上线门禁

```text
- P1-E1 ~ P1-E15 全部通过
- 撤权即时生效通过
- Graphify schema 异常不影响旧索引
- SSRF 防护通过
- Prompt injection 防护通过
- S1 ~ S8 安全测试通过
- Docker Compose 一键启动
- Chat 只引用 Published Wiki
- Source Document 不直接检索
- AGPL / 许可证声明存在
```

---

# 4. Phase 2 实现拆分：Docmost Fork 协作编辑

Phase 2 的目标是把 Docmost 作为 Graphify Wiki 的协作编辑壳层，不改变“Canonical Wiki Repo 是企业知识引用源”的原则。

---

## Stage 9：Docmost Fork Bridge

### 做什么

```text
- Fork Docmost bridge module
- /api/internal/bridge/*
- page saved webhook
- attachment webhook
- HMAC + Bearer
- bridge_events
- webhook_deliveries
- Bridge contract tests
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/requirements/06_模块需求_Docmost集成.md` | Docmost 角色、Bridge 命名空间、同步方向。 |
| `docs/audit/22_Docmost_Fork_改动清单.md` | Fork 改动边界、baseline、Bridge 文件清单、rebase CI。 |
| `docs/engineering/12_权限安全审计.md` | Bridge replay 防护、权限主数据源。 |
| `docs/engineering/14_测试验收规范.md` | P2-E1 ~ P2-E10、Bridge HMAC、webhook 幂等。 |
| `docs/ops/nginx.phase2.conf.example` | Phase 2 Nginx 代理 Docmost。 |

### 交付物

```text
- external/docmost cherrygraph-bridge 分支
- BridgeAuthGuard
- Page export/import API
- Attachment download API
- Sync status API
- Page saved webhook
- Bridge contract tests
```

---

## Stage 10：Docmost 双向同步与人工编辑

### 做什么

```text
- Graphify → Docmost import
- Docmost → Canonical Repo export
- Markdown ↔ Tiptap round-trip 验证
- page_block_metadata
- human curated 区块保护
- proposal accept/reject
- 权限投影同步
- Docmost sync failed 补偿
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/requirements/05_模块需求_GraphifyWiki唯一知识源.md` | block ownership、branch、proposal、发布策略。 |
| `docs/design/21_Graphify_输出Schema契约.md` | block ownership 双轨制与冲突合并。 |
| `docs/requirements/06_模块需求_Docmost集成.md` | 双向同步和权限映射。 |
| `docs/project/26_需求追踪矩阵.md` | Phase 2 需求/API/Schema/测试闭合。 |

### 交付物

```text
- wiki-sync-worker
- Docmost import/export
- page_block_metadata 写入/维护
- proposal accept/reject
- 权限同步 reconciler
- Docmost sync 管理页面
```

---

# 5. Phase 3 实现拆分：完整 GraphRAG

Phase 3 的目标是让 graph.json 不只是入库，而是进入检索、解释和 UI。

---

## Stage 11：Graph Index 与 Graph API

### 做什么

```text
- graph-core Repository
- PgGraphRepository
- graph_nodes / graph_edges / graph_communities 查询
- graph path 查询
- graph evidence refs
- stable_key alias/merge 初步支持
- Graph API
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/design/21_Graphify_输出Schema契约.md` | graph.json 字段、stable_key、双键策略。 |
| `docs/design/09_RAG与GraphRAG设计.md` | Graph Search、confidence、Graph path ACL。 |
| `docs/schemas/schema.sql` | graph_nodes、graph_edges、graph_communities、graph_evidence_refs。 |
| `docs/engineering/14_测试验收规范.md` | P3-E1、P3-E2、P3-E6。 |

### 交付物

```text
- GraphRepository interface
- PgGraphRepository
- GET /api/graph/nodes
- GET /api/graph/nodes/{node_id}
- POST /api/graph/path
- Graph path ACL
```

---

## Stage 12：GraphRAG 检索、Path UI、Retrieval Trace

### 做什么

```text
- graph_rag / path_first / community_first
- graph context packing
- INFERRED / AMBIGUOUS 策略
- graph path explanation
- retrieval_traces
- conflict detection
- source chain 展开
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/design/09_RAG与GraphRAG设计.md` | 混合检索、token budget、置信度策略、source chain。 |
| `docs/requirements/04_模块需求_CherryWeb_Chat_Admin.md` | 图谱解释 UI、引用展示。 |
| `docs/architecture/08_强耦合设计_六层.md` | 检索耦合、UI 耦合、权限耦合。 |
| `docs/project/26_需求追踪矩阵.md` | Phase 3 需求闭合。 |

### 交付物

```text
- graph_rag retrieval mode
- path_first retrieval mode
- community_first retrieval mode
- graph path UI
- retrieval trace UI
- source chain 展开视图
```

---

# 6. Phase 4 实现拆分：治理、MCP、长期运维

Phase 4 不要提前做。它应在 Phase 1-3 跑稳后再进入。

---

## Stage 13：知识治理与反馈闭环

### 做什么

```text
- feedback_items 工作台
- 低置信关系审核
- 重复页面合并建议
- 知识冲突检测
- graph_node_merges 管理
- 治理后触发 reindex
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/design/09_RAG与GraphRAG设计.md` | 质量反馈闭环。 |
| `docs/project/17_风险清单与决策记录.md` | 图谱幻觉、覆盖人工修订、权限泄露风险。 |
| `docs/engineering/14_测试验收规范.md` | P4-E1 ~ P4-E3。 |

### 交付物

```text
- 知识治理后台
- 低置信审核队列
- duplicate page merge suggestion
- graph node merge
- feedback → issue → edit → reindex 闭环
```

---

## Stage 14：MCP Gateway 与高级 Agent

### 做什么

```text
- MCP Gateway
- api_tokens
- tool policy
- search_wiki
- get_wiki_page
- query_graph
- shortest_path
- create_graphify_job
- 调用审计
- rate limit
```

### 必读文档

| 文档 | 读取重点 |
|---|---|
| `docs/architecture/08_强耦合设计_六层.md` | Agent 耦合和 MCP 策略。 |
| `docs/audit/20_Cherry_Studio_代码审计.md` | MCP trace 和 Cherry 侧可复用模块。 |
| `docs/engineering/13_开发规范.md` | MCP、外部组件、审计要求。 |
| `docs/project/26_需求追踪矩阵.md` | Phase 4 MCP 需求。 |

### 交付物

```text
- apps/mcp-gateway
- api_token 认证
- 工具权限策略
- 工具调用审计
- Graphify MCP 兼容
```

---

# 7. 推荐开发顺序总表

| 实现阶段 | 所属产品 Phase | 主要目标 | 是否可并行 |
|---|---|---|---|
| Stage 0 | 基线 | 仓库、CI、Compose、基础脚手架 | 否 |
| Stage 1 | Phase 1 | Auth/RBAC/Space/Admin | 否 |
| Stage 2 | Phase 1 | Job/Object Storage | Stage 1 完成后立即启动 |
| Stage 3 | Phase 1 | Upload/Ingestion/URL Fetcher | 依赖 Stage 1/2 |
| Stage 4 | Phase 1 | Canonical Wiki Repo/只读 Wiki | 可与 Stage 3 并行 |
| Stage 5 | Phase 1 | Graphify Worker/Wiki normalization | 依赖 Stage 3/4 |
| Stage 6 | Phase 1 | Indexer/Vector/BM25 | 依赖 Stage 4/5 |
| Stage 7 | Phase 1 | Chat/SSE/Citation | 依赖 Stage 6；SSE 协议 / 会话管理 / Prompt 组装可与 Stage 6 并行 |
| Stage 8 | Phase 1 | 测试、部署、上线门禁 | 依赖 Stage 1-7 |

> **注意**：Stage 0 内部，CI 管线（CS-6）应在 monorepo 骨架（CS-0）完成后立即执行，与 CS-1/CS-3/CS-4 并行，确保后续所有 PR 有 CI 门禁。
| Stage 9 | Phase 2 | Docmost Fork Bridge | Phase 1 稳定后 |
| Stage 10 | Phase 2 | 双向同步/人工编辑 | 依赖 Stage 9 |
| Stage 11 | Phase 3 | Graph API/Graph Index | Phase 2 后或部分提前 Spike |
| Stage 12 | Phase 3 | GraphRAG/Path UI/Trace | 依赖 Stage 11 |
| Stage 13 | Phase 4 | 知识治理 | Phase 3 后 |
| Stage 14 | Phase 4 | MCP Gateway/Agent | Phase 3 后 |

---

# 8. 建议更新 TODO

建议在 `docs/todo.md` 中新增实现阶段 TODO，与现有设计 TODO 并列。

## 建议新增实现 TODO

```text
- [ ] I-00 建立 monorepo 工程脚手架
- [x] I-01 实现 Auth/RBAC/Space/Admin 基础
- [ ] I-02 实现 Job 系统和 Worker 协同协议
- [ ] I-03 实现 Upload/Ingestion/URL Fetcher
- [ ] I-04 实现 Canonical Wiki Repo 和只读 Wiki
- [ ] I-05 实现 Graphify Worker 与 output import
- [ ] I-06 实现 Indexer / Vector / BM25
- [ ] I-07 实现 Chat SSE / citations
- [ ] I-08 Phase 1 E2E / 安全 / 部署收口
- [ ] I-09 Docmost Fork Bridge
- [ ] I-10 Docmost 双向同步
- [ ] I-11 Graph Index / Graph API
- [ ] I-12 GraphRAG / Path UI / Trace
- [ ] I-13 知识治理
- [ ] I-14 MCP Gateway
```

---

# 9. 阶段开工检查模板

每个 Stage 开工前建议复制下面模板到 Issue / PRD / 项目任务中。

```markdown
# Stage X 开工检查

## 1. Stage 名称

## 2. 所属产品 Phase

## 3. 本阶段目标

## 4. 本阶段范围

### 做

### 不做

## 5. 必读文档

- [ ] docs/...
- [ ] docs/...

## 6. API 对齐

- [ ] docs/design/11_API规范.md 已覆盖
- [ ] docs/schemas/openapi.yaml 已覆盖

## 7. Schema 对齐

- [ ] docs/schemas/schema.sql 已覆盖
- [ ] migration 已准备

## 8. 测试对齐

- [ ] docs/engineering/14_测试验收规范.md 已覆盖
- [ ] E2E case 已定义
- [ ] 安全测试已定义

## 9. 安全对齐

- [ ] docs/engineering/12_权限安全审计.md 已覆盖
- [ ] docs/engineering/24_威胁建模与安全用例.md 已覆盖

## 10. 交付物

## 11. 验收标准

## 12. 风险与回滚
```

---

# 10. 阶段完成检查模板

每个 Stage 完成后建议使用下面模板。

```markdown
# Stage X 完成检查

## 1. 交付物检查

- [ ] API 已实现
- [ ] UI 已实现
- [ ] Worker 已实现
- [ ] DB migration 已实现
- [ ] 文档已更新

## 2. 测试检查

- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] E2E 测试通过
- [ ] 权限测试通过
- [ ] 安全测试通过

## 3. 文档检查

- [ ] README / 索引不需要更新或已更新
- [ ] OpenAPI 已更新
- [ ] schema.sql 已更新
- [ ] 需求追踪矩阵已更新
- [ ] TODO 已更新

## 4. 运维检查

- [ ] Docker Compose 可启动
- [ ] healthcheck 正常
- [ ] 日志包含 request_id / job_id / tenant_id / space_id
- [ ] 无敏感信息泄露

## 5. 回滚方案

## 6. 下一阶段依赖
```

---

# 11. 最终建议

当前最应该做的是从文档方案转向 Stage 0 / Stage 1。

建议立即执行：

```text
1. 更新 docs/todo.md：从“审查整改 TODO”改成“实现 TODO”
2. 开始 Stage 0：工程基线、CI、Compose、Migration
3. 开始 Stage 1：Auth/RBAC/Space/Admin
4. 每个 Stage 用 docs/project/26_需求追踪矩阵.md 做闭环检查
```

Phase 1 的核心成功标准只有一个：

```text
上传资料 → 自动 Graphify → Canonical Wiki → Published Wiki → Vector/BM25 → Chat citation
```

在这个闭环跑通之前，不要启动 Docmost、GraphRAG、MCP Gateway 或知识治理开发。
