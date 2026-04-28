# CherryGraph Studio — 方案完善 TODO 合并状态

> 本文件基于仓库 `docs/todo.md` 合并。状态说明：`[x]` 表示已完成并进入文档。

## 一、Cherry Studio Electron→Web 改造深化

### 1.1 代码审计与可复用性分析

- [x] **T-1.1.1** 审计 `cherry-studio/src/renderer/`。  
  已完成：实际扫描 1,738 文件 / 244,488 LOC，按功能模块给出精确行数和 A/B/C 复用评级。
- [x] **T-1.1.2** 审计 `cherry-studio/packages/aiCore/`。  
  已完成：60 文件 / 13,014 LOC，Vercel AI SDK v5 + 9 provider + plugin pipeline。
- [x] **T-1.1.3** 审计 `cherry-studio/packages/shared/`。  
  已完成：26 文件 / 6,719 LOC。
- [x] **T-1.1.4** 审计 `cherry-studio/packages/mcp-trace/`。  
  已完成：14 文件 / 687 LOC。

### 1.2 改造策略文档

- [x] **T-1.2.1** `02_总体架构设计.md` 新增 Cherry Studio 改造策略。  
  已补充：路径映射、重写模块、Electron→Web 适配层、状态管理迁移、graph-core 抽象。
- [x] **T-1.2.2** `17_风险清单与决策记录.md` 更新 R1。  
  已补充：量化数据（A ~30K LOC 8.7% / B ~60K LOC 17.4% / C ~255K LOC 73.9%）。

## 二、Docmost 集成策略更新

- [x] **T-2.1.1** 更新 `06_模块需求_Docmost集成.md`。  
  已删除企业版 API 路径，明确 Fork 开源版 + 自建 Bridge endpoint。
- [x] **T-2.1.2** 更新 `11_API规范.md`。  
  已补充 Bridge API endpoint、schema、触发时机、错误处理和重试策略。
- [x] **T-2.1.3** 更新 `17_风险清单与决策记录.md`。  
  已将 R3 改为 Docmost Fork 维护成本风险，新增 ADR-007。

## 三、AGPL 合规简化

- [x] **T-3.1** 重写 `18_开源许可证与合规说明.md`。  
  源码全部公开，删除商业许可/规避 AGPL 旧口径。
- [x] **T-3.2** 更新 `17_风险清单与决策记录.md`。  
  R2 已降为 Low/Low。

## 四、分阶段交付重构

- [x] **T-4.1** 重写 `16_实施路线图与里程碑.md`。  
  已按 Phase 1-4 成品交付重构。

## 五、技术设计补强

- [x] **T-5.1.1** `08_强耦合设计_六层.md` 新增一致性保障。
- [x] **T-5.1.2** `10_数据模型与数据库设计.md` 补充版本一致性字段。
- [x] **T-5.2.1** 新建 `21_Graphify_输出Schema契约.md`。  
  已对照 Graphify v0.5.3 源码验证并修正 5 处关键差异。
- [x] **T-5.3.1** 更新 `09_RAG与GraphRAG设计.md`。
- [x] **T-5.4.1** 更新 `14_测试验收规范.md`。
- [x] **T-5.5.1** 更新 `02_总体架构设计.md`。

## 六、文档间交叉引用一致性

- [x] **T-6.1** 检查交叉引用和 Phase 编号。
- [x] **T-6.2** 更新 `README.md`。
- [x] **T-6.3** 更新 `MANIFEST.md`。

## 七、Schema 与配置补充

- [x] **T-7.1** 更新 `schemas/schema.sql`。
- [x] **T-7.2** 更新 `schemas/openapi.yaml`。
- [x] **T-7.3** 更新 `ops/docker-compose.skeleton.yml`。
- [x] **T-7.4** 更新 `ops/env.example`。

## 八、补充缺失文档

- [x] **T-8.1** 新建 `20_Cherry_Studio_代码审计.md`（含实际审计数据）。
- [x] **T-8.2** 新建 `21_Graphify_输出Schema契约.md`（含源码验证差异修正）。
- [x] **T-8.3** 新建 `22_Docmost_Fork_改动清单.md`（含 baseline v0.80.1 / commit 980521f）。

## 九、GPT Pro 额外补充

- [x] **T-9.1** 新建 `23_补充建议清单.md`。
- [x] **T-9.2** 在 `17_风险清单与决策记录.md` 新增 R11-R14。
- [x] **T-9.3** schema.sql 增加 `graph_communities` 等建议表。

## 十、源码验证补全（Claude 完成）

- [x] **T-10.1** Cherry Studio 代码审计：实际扫描 2,219 文件 / 345,785 LOC，728 处 IPC 依赖，28 Redux slices，9 AI providers。
- [x] **T-10.2** Graphify Schema 验证：对照 v0.5.3 源码确认 5 处关键差异（无 metadata、无 frontmatter、扁平 wiki 目录、不同置信度默认值、hyperedges 字段），均已更新到 Doc 21。
- [x] **T-10.3** Docmost baseline：v0.80.1 / commit `980521f95792ddd382ebbc275467a8319a351bae`，NestJS+Fastify 架构，Bridge 放 `integrations/bridge/`。
- [x] **T-10.4** Docmost Fork：已 fork 到 `DankerMu/docmost`，已作为 submodule 添加到 `external/docmost/`。

## 全部 TODO 已完成
