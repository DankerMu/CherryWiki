# 文档清单

版本：v0.5 | 日期：2026-05-02

| 分类 | 文件 | 说明 |
|---|---|---|
| **architecture/** | 01_方案总览与边界.md | 项目定位、边界、术语表、成功标准 |
| | 02_总体架构设计.md | 服务拆分、数据流、Cherry Studio 改造策略 |
| | 08_强耦合设计_六层.md | 六层耦合定义、验收矩阵、一致性保障 |
| **requirements/** | 03_产品需求_PRD.md | 用户角色、功能矩阵、非功能需求 |
| | 04_模块需求_CherryWeb_Chat_Admin.md | 前端、Chat 引擎、管理后台 |
| | 05_模块需求_GraphifyWiki唯一知识源.md | Canonical Wiki Repo、合并流水线 |
| | 06_模块需求_Docmost集成.md | Fork 策略、Bridge、权限映射 |
| | 07_模块需求_资料上传归档解析.md | 上传、解析、分类、Graphify 触发 |
| **design/** | 09_RAG与GraphRAG设计.md | 混合检索、双层查询架构、置信度模型、Prompt 组装 |
| | 10_数据模型与数据库设计.md | ER、表结构、ACL 信封、版本一致性 |
| | 11_API规范.md | RESTful API、SSE、Bridge 内部 API |
| | 21_Graphify_输出Schema契约.md | graph.json/wiki/report 契约与降级 |
| | 12_UI设计规范_CherryStudio风格对齐.md | UI 设计规范、主题 Token、风格对齐 |
| | 22_Graphify集成架构勘误.md | graphify Python API vs CLI 的正确理解 |
| | 27_Agent架构与CLI工具设计.md | 双层查询架构、Claude Code Agent、CLI 工具族、数据库接入 |
| **engineering/** | 12_权限安全审计.md | RBAC、Space 隔离、审计日志 |
| | 13_开发规范.md | 仓库结构、技术栈、编码规范 |
| | 14_测试验收规范.md | 测试层级、性能指标 |
| | 15_部署运维规范.md | Docker Compose、备份恢复 |
| | 24_威胁建模与安全用例.md | 8 类威胁场景、风险矩阵、防御映射 |
| **project/** | 16_实施路线图与里程碑.md | Phase 1-4 交付物与退出标准 |
| | 17_风险清单与决策记录.md | R1-R16、ADR-001~011 |
| | 18_开源许可证与合规说明.md | AGPL、SBOM |
| | 19_资料依据与外部来源.md | 参考来源 |
| | 23_补充建议清单.md | 安全、可观测性补充 |
| | 26_需求追踪矩阵.md | 需求→API→Schema→测试全链路追踪 |
| | 25_Phase1_Scope_Lock.md | Phase 1 做什么/不做什么/禁止捷径 |
| **audit/** | 20_Cherry_Studio_代码审计.md | 345K LOC 扫描、复用评级 |
| | 22_Docmost_Fork_改动清单.md | baseline v0.80.1、Bridge 路由 |
| **schemas/** | schema.sql | PostgreSQL DDL 草案 |
| | openapi.yaml | OpenAPI 3.1 草案 |
| **ops/** | docker-compose.skeleton.yml | Docker Compose 骨架 |
| | nginx.phase2.conf.example | Phase 2 Nginx 配置（含 Docmost 代理） |
| | env.example | 环境变量模板 |
| | nginx.conf.example | Nginx 配置 |
| **templates/** | ADR_TEMPLATE.md | 架构决策记录模板 |
| | MODULE_REQUIREMENT_TEMPLATE.md | 模块需求模板 |
| | ACCEPTANCE_CASE_TEMPLATE.md | 验收用例模板 |
| **根目录** | README.md | 索引与架构速览 |
| | MANIFEST.md | 本文件 |
| | todo.md | TODO 状态 |
