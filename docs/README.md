# CherryGraph Studio 方案文档包

版本：v0.1  
日期：2026-04-27  
定位：基于 Cherry Studio 社区版 Fork 重构的 Docker 化 Web 端，强耦合 Graphify Wiki、Docmost 协作编辑和 GraphRAG 能力。

## 1. 方案一句话

本项目不是把 Cherry Studio 桌面端简单搬到浏览器，而是以 Cherry Studio 的体验和能力为基础，重构为一套多用户 Web AI 工作台：

```text
Cherry Studio Web
= 多用户 AI 聊天与 Agent 工作台
+ Graphify Wiki 唯一知识源
+ Docmost 协作编辑壳层
+ 上传资料自动归档/解析/生成 Wiki
+ Graphify 自动图谱化与 Wiki 同步
+ Vector/BM25/GraphRAG 检索
+ 管理后台、权限、审计、Docker 部署
```

## 2. 已确认路线

| 编号 | 决策 | 本文档处理方式 |
|---|---|---|
| D1 | Fork 开源 Cherry Studio，路线 A，重构 Web 版 | 以“重构”而不是“Electron 直改”为前提，保留 Cherry 聊天、模型、知识库、MCP、Agent 等核心体验。 |
| D2 | Graphify CLI 由 Cherry Web 后台自动调度 | 设计 `graphify-worker`、任务队列、运行记录、输出解析、索引更新。 |
| D3 | 不考虑内网模型限制，按互联网可用模型处理 | 模型网关仍作为抽象层保留，便于未来切换。 |
| D4 | Docmost 作为 Wiki 网页 | Docmost 是 Graphify Wiki 的编辑/协作/权限前端，不是独立知识源。 |
| D5 | Graphify Wiki 是唯一信息源 | 聊天检索只从发布后的 Graphify Wiki 页面与其派生图谱/索引取材；上传原文只作为证据、归档和再生成输入。 |
| D6 | 认可六层耦合 | 形成数据源、索引、检索、UI、Agent、权限六层强耦合。 |
| D7 | Wiki 支持人工修订、上传资料自动归档解析、同步 Graphify | 增加 Wiki 修订流、上传归档流、Graphify 增量更新流和冲突合并机制。 |

## 3. 文档索引

### 需求与产品

1. [方案总览与边界](docs/01_方案总览与边界.md)
2. [产品需求 PRD](docs/03_产品需求_PRD.md)
3. [模块需求：Cherry Web、Chat、Admin](docs/04_模块需求_CherryWeb_Chat_Admin.md)
4. [模块需求：Graphify Wiki 唯一知识源](docs/05_模块需求_GraphifyWiki唯一知识源.md)
5. [模块需求：Docmost 集成](docs/06_模块需求_Docmost集成.md)
6. [模块需求：资料上传、归档、解析](docs/07_模块需求_资料上传归档解析.md)

### 架构与技术

7. [总体架构设计](docs/02_总体架构设计.md)
8. [六层强耦合设计](docs/08_强耦合设计_六层.md)
9. [RAG 与 GraphRAG 设计](docs/09_RAG与GraphRAG设计.md)
10. [数据模型与数据库设计](docs/10_数据模型与数据库设计.md)
11. [API 规范](docs/11_API规范.md)
12. [权限、安全与审计](docs/12_权限安全审计.md)

### 工程与交付

13. [开发规范](docs/13_开发规范.md)
14. [测试与验收规范](docs/14_测试验收规范.md)
15. [部署与运维规范](docs/15_部署运维规范.md)
16. [实施路线图与里程碑](docs/16_实施路线图与里程碑.md)
17. [风险清单与决策记录](docs/17_风险清单与决策记录.md)
18. [开源许可证与合规说明](docs/18_开源许可证与合规说明.md)
19. [资料依据与外部来源](docs/19_资料依据与外部来源.md)

### 可执行参考件

- [Docker Compose 骨架](ops/docker-compose.skeleton.yml)
- [环境变量样例](ops/env.example)
- [Nginx 反向代理样例](ops/nginx.conf.example)
- [数据库 Schema 草案](schemas/schema.sql)
- [OpenAPI 草案](schemas/openapi.yaml)
- [ADR 模板](templates/ADR_TEMPLATE.md)
- [模块需求模板](templates/MODULE_REQUIREMENT_TEMPLATE.md)
- [验收用例模板](templates/ACCEPTANCE_CASE_TEMPLATE.md)

## 4. 总体架构速览

```mermaid
flowchart LR
  U[用户/管理员] --> WEB[Cherry Web 前端]
  WEB --> API[Cherry API]
  WEB --> DOC[Docmost Wiki UI]

  API --> AUTH[Auth/RBAC]
  API --> CHAT[Chat & Agent Engine]
  API --> KO[Knowledge Orchestrator]
  API --> ADMIN[Admin Console API]

  DOC --> BRIDGE[Docmost Bridge]
  BRIDGE --> KREPO[Canonical Graphify Wiki Repo]

  UP[Upload Center] --> ARCHIVE[Source Archive/MinIO]
  ARCHIVE --> INGEST[Ingestion Worker]
  INGEST --> KREPO

  KREPO --> GF[Graphify Worker]
  GF --> GOUT[graphify-out: wiki + graph.json + report]
  GOUT --> SYNC[Wiki/Graph Sync]
  SYNC --> DOC
  SYNC --> IDX[Index Engine]

  IDX --> PG[(PostgreSQL)]
  IDX --> VEC[(pgvector/Qdrant)]
  IDX --> SEARCH[(OpenSearch/MeiliSearch)]
  IDX --> GRAPH[(Graph Tables/Neo4j optional)]

  CHAT --> RET[GraphRAG Retrieval]
  RET --> VEC
  RET --> SEARCH
  RET --> GRAPH
  CHAT --> LLM[Model Gateway]
```

## 5. 核心原则

1. **Graphify Wiki 是唯一知识源**：AI 回答基于发布后的 Wiki 页面、页面切片、图谱节点和关系；原始上传文件不是直接检索源。
2. **Docmost 是协作编辑壳层**：Docmost 提供多人编辑、页面历史、附件、Spaces、权限 UI；内容需同步回 Canonical Graphify Wiki Repo。
3. **Graphify 是平台内置索引器**：不让用户手动跑 CLI；后台通过任务队列自动调用 Graphify，解析 `graph.json`、`GRAPH_REPORT.md` 和 `wiki/`。
4. **生成内容不能静默覆盖人工修订**：Graphify 新生成页面进入“候选修订/变更提案”，与人工修订做差异合并。
5. **权限必须贯穿检索链路**：检索前、检索中、重排后、回答引用阶段都要做 ACL 校验。
6. **AGPL 先行**：Cherry Studio 社区版和 Docmost core 均涉及 AGPL，网络服务化和二开需要合规处理。

## 6. 首期建议目标

MVP 不建议直接做全量能力。首期只交付：

- Docker Compose 部署。
- 用户登录、分组、空间权限。
- Cherry Web 基础聊天、会话历史、模型配置。
- 上传资料并归档。
- 后台自动跑 Graphify `--wiki`。
- 将 Graphify Wiki 页面同步到 Docmost。
- 人工编辑 Docmost 页面后回写 Canonical Wiki Repo。
- 对发布 Wiki 做向量 + 关键词 + 图谱索引。
- 聊天时使用 GraphRAG 回答并引用 Wiki 页面。

## 7. 建议项目代号

内部研发可以使用：

```text
项目名称：CherryGraph Studio
知识层名称：Graphify Wiki
Wiki UI：Docmost Shell
服务端名称：Cherry Web Platform
```
