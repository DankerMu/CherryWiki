# MANIFEST

本文档包版本：v0.2-todo-merged  
更新时间：2026-04-28

## 根目录

| 文件 | 说明 |
|---|---|
| `README.md` | 主文档与索引。 |
| `MANIFEST.md` | 文件清单。 |
| `todo.md` | 从仓库 `docs/todo.md` 合并后的 TODO 完成状态与补充项。 |

## docs/

| 文件 | 说明 |
|---|---|
| `docs/01_方案总览与边界.md` | 项目定位、边界与术语。 |
| `docs/02_总体架构设计.md` | 总体架构、数据流、Cherry Studio 改造策略、graph-core 抽象。 |
| `docs/03_产品需求_PRD.md` | 产品目标、用户角色、核心场景。 |
| `docs/04_模块需求_CherryWeb_Chat_Admin.md` | Cherry Web、Chat、Admin 模块需求。 |
| `docs/05_模块需求_GraphifyWiki唯一知识源.md` | Graphify Wiki 唯一知识源需求。 |
| `docs/06_模块需求_Docmost集成.md` | Docmost Fork 集成、Bridge、自建 webhook。 |
| `docs/07_模块需求_资料上传归档解析.md` | 上传、归档、解析、触发 Graphify。 |
| `docs/08_强耦合设计_六层.md` | 六层强耦合与一致性保障。 |
| `docs/09_RAG与GraphRAG设计.md` | RAG、GraphRAG、置信度模型、上下文组装。 |
| `docs/10_数据模型与数据库设计.md` | 数据模型、版本一致性字段、索引策略。 |
| `docs/11_API规范.md` | API 与 Docmost Bridge 内部接口。 |
| `docs/12_权限安全审计.md` | 权限、安全、审计。 |
| `docs/13_开发规范.md` | 开发规范。 |
| `docs/14_测试验收规范.md` | 测试、验收、性能指标。 |
| `docs/15_部署运维规范.md` | 部署运维。 |
| `docs/16_实施路线图与里程碑.md` | Phase 1-4 分阶段交付成品路线。 |
| `docs/17_风险清单与决策记录.md` | 风险清单与 ADR 摘要。 |
| `docs/18_开源许可证与合规说明.md` | AGPL 简化合规说明。 |
| `docs/19_资料依据与外部来源.md` | 外部资料依据。 |
| `docs/20_Cherry_Studio_代码审计.md` | Cherry Studio Electron→Web 初步代码审计与复用策略。 |
| `docs/21_Graphify_输出Schema契约.md` | Graphify 输出契约、schema 校验、版本兼容。 |
| `docs/22_Docmost_Fork_改动清单.md` | Docmost Fork 修改边界、Bridge 路由、rebase 流程。 |
| `docs/23_补充建议清单.md` | TODO 之外建议补充的工程清单。 |

## ops/

| 文件 | 说明 |
|---|---|
| `ops/docker-compose.skeleton.yml` | Docker Compose 骨架，Docmost 改为 Fork build。 |
| `ops/env.example` | 环境变量样例。 |
| `ops/nginx.conf.example` | Nginx 反向代理样例。 |

## schemas/

| 文件 | 说明 |
|---|---|
| `schemas/schema.sql` | PostgreSQL/pgvector 数据库草案。 |
| `schemas/openapi.yaml` | OpenAPI 草案。 |

## templates/

| 文件 | 说明 |
|---|---|
| `templates/ADR_TEMPLATE.md` | ADR 模板。 |
| `templates/MODULE_REQUIREMENT_TEMPLATE.md` | 模块需求模板。 |
| `templates/ACCEPTANCE_CASE_TEMPLATE.md` | 验收用例模板。 |
