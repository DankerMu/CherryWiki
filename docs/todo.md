# CherryGraph Studio — 方案完善 TODO

> 本文件供 GPT Pro 逐条执行，完善 `docs/` 下的设计文档。
> 每完成一条，在 `[ ]` 改为 `[x]` 并注明修改了哪些文件。
>
> **项目背景决策（已确认）：**
> - 内部小团队使用，非 SaaS
> - 源码全部公开（AGPL 合规自动满足）
> - Docmost 决策：Fork 开源版 + 自建 Bridge endpoint，不购买企业版
> - 不设 MVP 概念，分阶段交付成品，Phase 1 = 最小可用成品
> - 不考虑团队能力约束，按最佳实践设计

---

## 一、Cherry Studio Electron→Web 改造深化

Cherry Studio 源码在 `../cherry-studio/`，结构为 Electron (main/preload/renderer) + packages (aiCore, shared, ai-sdk-provider, mcp-trace, extension-table-plus)。

### 1.1 代码审计与可复用性分析

- [ ] **T-1.1.1** 审计 `cherry-studio/src/renderer/` 目录，按功能模块（Chat UI、会话管理、模型选择、Markdown 渲染、设置页、知识库页、MCP 配置）逐一列出：
  - 模块名称、文件路径、行数
  - 对 Electron API 的依赖程度（无依赖 / `ipcRenderer` / `fs` / `dialog` / `shell` 等）
  - 可复用性评级：A（直接复用）、B（需适配）、C（需重写）
  - 输出为 `docs/docs/20_Cherry_Studio_代码审计.md`

- [ ] **T-1.1.2** 审计 `cherry-studio/packages/aiCore/`，分析：
  - 模型调用抽象层（provider pattern）能否直接用于 Web 后端
  - streaming 实现是否依赖 Electron IPC
  - tool calling / function calling 实现是否可复用
  - 将结论补充到 `20_Cherry_Studio_代码审计.md`

- [ ] **T-1.1.3** 审计 `cherry-studio/packages/shared/`，识别：
  - 类型定义（models, conversations, messages, settings）
  - 工具函数
  - 哪些可以直接作为 `packages/shared/` 的种子代码
  - 将结论补充到 `20_Cherry_Studio_代码审计.md`

- [ ] **T-1.1.4** 审计 `cherry-studio/packages/mcp-trace/` 和 MCP 相关代码，分析：
  - MCP client 实现方式
  - 是否与 Electron 耦合
  - Web 端 MCP Gateway 如何复用
  - 将结论补充到 `20_Cherry_Studio_代码审计.md`

### 1.2 改造策略文档

- [ ] **T-1.2.1** 基于 T-1.1.* 的审计结果，在 `docs/docs/02_总体架构设计.md` 中新增 "Cherry Studio 改造策略" 章节，包含：
  - 可复用模块清单（含路径映射：原路径 → CherryGraph 新路径）
  - 需重写模块清单及重写原因
  - Electron→Web 适配层设计（替换 ipcRenderer 为 HTTP/WebSocket、替换 fs 为 API 调用等）
  - 前端状态管理迁移方案（如 Cherry Studio 用 zustand/redux → CherryGraph 的选择）

- [ ] **T-1.2.2** 在 `docs/docs/17_风险清单与决策记录.md` 中更新 R1（改造量低估风险），用审计数据替换当前模糊描述，补充量化的改造量估计（可复用行数 / 需重写行数）

---

## 二、Docmost 集成策略更新

### 2.1 Fork 策略明确

- [ ] **T-2.1.1** 更新 `docs/docs/06_模块需求_Docmost集成.md`：
  - 删除"企业版 API 路径"相关内容
  - 明确 Fork 策略：Fork `docmost/docmost` 开源版，仓库放在 `external/docmost/`
  - 定义 Fork 修改范围（最小改动原则）：
    - 新增 `/api/internal/bridge/` 路由组（page CRUD webhook、sync status、attachment event）
    - 新增 page save 后的 webhook 通知机制
    - 不修改 Docmost 核心编辑器、权限模型、存储层
  - 定义 upstream 合并策略（定期 rebase upstream，冲突解决在 bridge 路由层）

- [ ] **T-2.1.2** 在 `docs/docs/11_API规范.md` 的 Docmost Bridge 内部 API 部分：
  - 补充完整的 Bridge API endpoint 定义（request/response schema）
  - 明确每个 endpoint 的触发时机和调用方
  - 补充错误处理和重试策略

- [ ] **T-2.1.3** 在 `docs/docs/17_风险清单与决策记录.md`：
  - 更新 R3（Docmost API 企业版风险）→ 改为"Docmost Fork 维护成本风险"
  - 新增 ADR-007：Docmost Fork 开源版 + 自建 Bridge（记录决策理由：内部小团队、源码公开、企业版 ROI 不足）

---

## 三、AGPL 合规简化

- [ ] **T-3.1** 重写 `docs/docs/18_开源许可证与合规说明.md`：
  - 开头声明"本项目源码全部公开，AGPL 义务自动满足"
  - 删除"协商商业许可"、"避免 AGPL 义务"等段落
  - 保留：第三方依赖 SBOM 要求、LICENSE 文件保留要求、Web UI 许可证页面要求
  - 简化合规检查清单（删除关于商业使用边界的条目）

- [ ] **T-3.2** 更新 `docs/docs/17_风险清单与决策记录.md`：
  - 将 R2（AGPL 合规不足）的 Impact 降为 Low，Probability 降为 Low
  - 注明"源码全公开，风险已消解"

---

## 四、分阶段交付重构

- [ ] **T-4.1** 重写 `docs/docs/16_实施路线图与里程碑.md`，按"分阶段交付成品"重构：

  **Phase 1（最小可用成品）：** Cherry Web + Graphify 自动生成 + 只读 Wiki + 向量检索 + Chat 引用
  - 用户登录、Space、基础权限
  - 文件上传 → 归档 → 解析 → Graphify 生成 Wiki
  - Wiki 页面只读浏览（Cherry Web 内置，暂不上 Docmost）
  - 向量 + BM25 检索
  - Chat 流式回答 + Wiki 页面引用
  - Docker Compose 部署
  - 管理后台：用户/Space/模型/任务

  **Phase 2（Docmost 协作编辑）：** Fork Docmost + 双向同步 + 人工编辑
  - Docmost Fork 部署 + Space 映射
  - Graphify → Docmost 单向导入
  - Docmost → Canonical Wiki Repo 回写
  - block ownership markers
  - candidate update 机制

  **Phase 3（GraphRAG 完整闭环）：** 图索引 + 图路径 + 完整 GraphRAG
  - graph.json 导入图表
  - 图节点/边检索
  - 混合检索（Vector + BM25 + Graph）
  - 图路径解释 UI
  - 关系置信度展示

  **Phase 4（知识治理与高级功能）：** 审计 + 安全增强 + 知识质量治理
  - 完整审计日志
  - 权限一致性检查
  - 低置信度关系审核
  - 重复页面合并建议
  - Agent 工具链 + MCP Gateway
  - 备份恢复脚本

  每个 Phase 定义：交付物清单、退出标准、依赖关系、预估工作量范围

---

## 五、技术设计补强

### 5.1 数据一致性

- [ ] **T-5.1.1** 在 `docs/docs/08_强耦合设计_六层.md` 新增"一致性保障"章节：
  - Worker 竞态条件分析（Graphify 生成中用户编辑同一页面、索引未完成时 Chat 请求）
  - Optimistic locking 方案：Worker 消费前检查 page_version 是否仍为 current
  - Chat fallback 策略：检索时优先使用 indexed version，若 current > indexed 则用上一个已索引版本
  - 一致性检查定时任务设计（检查 page_version、index_version、graphify_run_id 三者绑定）

- [ ] **T-5.1.2** 在 `docs/docs/10_数据模型与数据库设计.md` 补充：
  - `wiki_pages` 表增加 `indexed_version_id` 字段（指向最近一次成功索引的版本）
  - `spaces` 表增加 `index_consistency_status` 字段（healthy / checking / inconsistent）
  - 版本锁相关索引

### 5.2 Graphify Output Schema 稳定性

- [ ] **T-5.2.1** 新建 `docs/docs/21_Graphify_输出Schema契约.md`：
  - 分析 `../graphify/` 源码，提取当前 graph.json、wiki/、GRAPH_REPORT.md 的实际输出结构
  - 定义 CherryGraph 接受的 Graphify Output Schema v1（作为 graph-core 的输入契约）
  - 定义 schema 校验规则（必选字段、可选字段、字段类型）
  - 定义版本兼容策略：pin Graphify 版本，升级走 ADR 流程
  - 定义 schema 不兼容时的降级策略

### 5.3 关系置信度模型增强

- [ ] **T-5.3.1** 更新 `docs/docs/09_RAG与GraphRAG设计.md` 的置信度部分：
  - 保留 EXTRACTED / INFERRED / AMBIGUOUS 三级标签用于 UI 展示
  - 增加底层 `confidence_score`（0.0-1.0 连续值）+ `evidence_count`（支撑证据数量）
  - 定义检索排序时使用 score 而非 label
  - 定义不同 score 区间到 label 的映射规则
  - 更新 `docs/schemas/schema.sql` 中 `graph_edges` 表，确认 `confidence_score` 字段已存在（当前已有，确认即可）

### 5.4 性能指标细化

- [ ] **T-5.4.1** 更新 `docs/docs/14_测试验收规范.md` 的性能指标：
  - 增加并发场景定义：10 并发用户、1000 Wiki 页面、5000 图节点
  - Chat 首 token 目标调整为 P95 < 3s（Phase 1）、P95 < 2s（Phase 3 优化后）
  - GraphRAG 检索目标拆分：纯向量 < 500ms、混合检索 < 1.5s、含 ACL 过滤 < 2s
  - 增加 Graphify 任务性能基线：100 页文档 → Wiki 生成 < 30min
  - 增加索引性能基线：1000 页 Wiki 全量索引 < 15min

### 5.5 graph-core 接口抽象

- [ ] **T-5.5.1** 在 `docs/docs/02_总体架构设计.md` 的 `packages/graph-core` 部分补充：
  - Repository 接口抽象设计（GraphRepository interface）
  - PostgreSQL 实现类 (PgGraphRepository)
  - Neo4j 实现类预留接口 (Neo4jGraphRepository)
  - 核心方法定义：getNode, getNeighbors, shortestPath, querySubgraph, importGraphJson
  - 明确 Phase 1-3 使用 PG 实现，Phase 4+ 按需切换 Neo4j

---

## 六、文档间交叉引用一致性

- [ ] **T-6.1** 检查所有 19 篇文档中的交叉引用，确保：
  - 引用的章节/表格/图编号存在且正确
  - 术语表（01 中定义）在所有文档中一致使用
  - Phase 编号在所有提到实施路线的文档中一致（按 T-4.1 的新分阶段）

- [ ] **T-6.2** 更新 `docs/README.md`，反映：
  - 新增的文档（20、21）
  - Docmost 决策变更
  - 源码公开决策
  - 分阶段交付策略变更

- [ ] **T-6.3** 更新 `docs/MANIFEST.md`，添加新增文档条目

---

## 七、Schema 与配置补充

- [ ] **T-7.1** 更新 `docs/schemas/schema.sql`：
  - `wiki_pages` 增加 `indexed_version_id` 字段
  - `spaces` 增加 `index_consistency_status` 字段
  - 确认 `graph_edges.confidence_score` 类型为 `REAL` 或 `DOUBLE PRECISION`
  - 检查所有表的 tenant_id 约束一致性

- [ ] **T-7.2** 更新 `docs/schemas/openapi.yaml`：
  - 补充 Docmost Bridge 内部 API 的 schema（即使是 internal，也需要文档化）
  - 补充 Wiki API 的完整 endpoint（当前只有部分）
  - 补充 Admin API 的 request/response schema

- [ ] **T-7.3** 更新 `docs/ops/docker-compose.skeleton.yml`：
  - 将 `docmost` 服务改为 build from `../../external/docmost/`（Fork 版本）
  - 增加 `docmost-bridge` 相关环境变量注释
  - 确认 volume 映射与文档描述一致

- [ ] **T-7.4** 更新 `docs/ops/env.example`：
  - 删除 `DOCMOST_API_KEY`（不再用企业版 API）
  - 增加 `DOCMOST_BRIDGE_SECRET`（Bridge 内部通信密钥）
  - 增加 `DOCMOST_FORK_BUILD=true`（标记使用 Fork 版本）

---

## 八、补充缺失文档

- [ ] **T-8.1** 新建 `docs/docs/20_Cherry_Studio_代码审计.md`（由 T-1.1.* 产出）

- [ ] **T-8.2** 新建 `docs/docs/21_Graphify_输出Schema契约.md`（由 T-5.2.1 产出）

- [ ] **T-8.3** 新建 `docs/docs/22_Docmost_Fork_改动清单.md`：
  - Fork 基线版本（commit hash）
  - 新增文件清单（Bridge 路由、webhook handler）
  - 修改文件清单（如有）
  - 不修改清单（明确不动的核心模块）
  - upstream rebase 流程

---

## 执行说明

1. **执行顺序**：先 T-1.1.*（代码审计需要先读源码），再 T-1.2.*，然后其余可并行
2. **每条 TODO 完成后**：标注 `[x]`，注明修改了哪些文件、新增了哪些内容
3. **遇到需要确认的设计决策**：在该 TODO 下方添加 `> ⚠️ 待确认：xxx`，不要自行决定
4. **Graphify 源码在** `../graphify/`，**Cherry Studio 源码在** `../cherry-studio/`
5. **所有新增文档遵循现有文档风格**：中文、Markdown、表格优先、代码块标注语言
6. **不要删除现有文档内容**，只做增量修改和更新，除非 TODO 明确说"重写"或"删除"
