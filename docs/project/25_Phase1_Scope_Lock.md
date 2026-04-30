# 25. Phase 1 Scope Lock

## 1. 目的

锁定 Phase 1 交付范围，防止 scope creep。任何超出本文件定义的功能一律推迟到 Phase 2+。

## 2. Phase 1 做什么

| 功能 | 交付标准 |
|---|---|
| 用户登录/登出/会话 | JWT + refresh token，sessions 表管理 |
| Space 创建与管理 | CRUD + 权限绑定 |
| 文件上传与归档 | 多格式上传 → quarantine → archive → 解析 |
| Ingestion Pipeline | PDF/DOCX/MD/TXT/ZIP/URL 解析为 Markdown |
| Graphify 自动运行 | 解析完成后自动或手动触发 Graphify |
| Canonical Wiki Repo | Git-based，main 分支为发布源 |
| Cherry Web 只读 Wiki | 浏览页面列表、页面内容、版本历史 |
| Wiki 发布流程 | 管理员可发布/回滚页面 |
| 索引构建 | chunk + embedding + index_snapshot |
| Chat with citations | 流式回答 + Wiki 引用 + 引用可点击 |
| Vector + BM25 检索 | 混合检索，ACL 过滤 |
| 权限隔离 | Space 级 ACL，多次检索过滤 |
| Admin Console | 用户/Group/Space/模型/任务/审计 |
| Docker Compose 部署 | 一键启动 Phase 1 全部服务 |
| 健康检查 | 所有服务 healthcheck |
| UI 视觉规范合规 | 所有前端页面遵循 `docs/design/12_UI设计规范`，使用 CSS token 体系，支持暗色模式 |

## 3. Phase 1 不做什么

| 功能 | 推迟到 | 原因 |
|---|---|---|
| Docmost 集成 | Phase 2 | 协作编辑非 MVP |
| wiki-sync-worker | Phase 2 | 依赖 Docmost |
| Bridge webhook | Phase 2 | 依赖 Docmost |
| 人工编辑回写 | Phase 2 | 依赖 Docmost |
| Graph path 解释 | Phase 3 | 需要完整图索引 |
| GraphRAG 混合检索 | Phase 3 | Phase 1 用 Vector + BM25 |
| Community summary | Phase 3 | 需要图谱完整 |
| Retrieval trace UI | Phase 3 | 管理员工具 |
| MCP Gateway | Phase 4 | 外部集成 |
| 知识治理/反馈闭环 | Phase 4 | 高级功能 |
| 病毒扫描 | P1（Phase 1 P1 优先级） | 可后补 |
| 多模型切换过渡 | Phase 2+ | Phase 1 单模型 |

## 4. Phase 1 允许的临时方案

| 临时方案 | 正式方案（后续 Phase） | 约束 |
|---|---|---|
| Cherry Web 只读 Wiki（无编辑） | Docmost 协作编辑（Phase 2） | 只读浏览 + 版本查看 |
| 管理员直接发布（无审核流） | 候选更新审核（Phase 2） | 管理员手动操作 |
| 单 embedding 模型 | 多模型并存（Phase 2+） | 切换 = 全量重建 |
| PostgreSQL 图表（邻接表） | Neo4j（Phase 4 评估） | path query ≤ 4 hop |
| PostgreSQL FTS | MeiliSearch（Phase 4 评估） | 满足 Phase 1 规模 |
| 无 graph path 解释 | GraphRAG path UI（Phase 3） | Chat 只返回 chunk 引用 |
| 手动触发一致性检查 | 自动定时检查（Phase 2） | Admin 按需执行 |
| 日志文件 + Docker logs | 集中式 Observability（Phase 4） | 可 grep 即可 |

## 5. Phase 1 不允许的捷径

以下做法即使能加快开发也**禁止使用**：

| 禁止的捷径 | 原因 |
|---|---|
| 跳过 quarantine 直接归档 | 安全要求，上传恶意文件风险 |
| Chat 直接读 source_documents | 违反唯一知识源原则 |
| Graphify 输出直接覆盖 active_index | 无原子切换保护，失败不可恢复 |
| 跳过 ACL 过滤"先上线再加" | 权限一旦缺失，数据泄露无法回收 |
| 硬编码模型配置 | 后续切换成本极高 |
| 跳过 index_snapshot 直接写 chunk | 无法原子切换，无法回滚 |
| 前端直连 Worker | 架构越权，安全风险 |
| 共享 Docmost 数据库 | Phase 2 依赖隔离数据库 |
| git force push Canonical Wiki Repo | 历史不可追溯 |
| 单元测试覆盖率 < 60% | 质量底线 |

## 6. Phase 1 验收数据集

| 数据集 | 内容 | 用途 |
|---|---|---|
| `test-corpus-small` | 10 个文件（5 PDF + 3 DOCX + 2 MD），共 50 页 | 开发和 CI 快速验证 |
| `test-corpus-medium` | 100 个文件，共 500 页，跨 3 个 Space | 集成测试 |
| `test-corpus-security` | 含 ZIP bomb、路径穿越 ZIP、injection PDF、SSRF URL | 安全测试 |
| `test-corpus-perf` | 1000 页 Wiki + 5000 nodes + 10000 edges | 性能测试基准 |

数据集要求：
- 存储在 `tests/fixtures/` 目录
- 不含真实敏感数据（使用合成数据或脱敏数据）
- 每次 CI 可重复使用
- 包含预期输出（golden files）用于回归对比

## 7. 里程碑对照

| 里程碑 | 验收 | 对应测试 |
|---|---|---|
| M1 | 上传 → Graphify → 只读 Wiki → Chat 引用 | P1-E1, P1-E2 |
| M2 | 多用户、Space 权限、Docker Compose 启动 | P1-E3, 部署验收 |

M1 是最小演示闭环，M2 是 Phase 1 完整交付。
