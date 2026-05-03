## Why

Stage 4 建立了 Canonical Wiki Repo 和只读 Wiki 浏览能力，但 Wiki 页面只有空壳——没有真正的内容来源。Stage 5 打通"parsed.md → Graphify CLI → graphify-out → graph/wiki 导入 → Canonical Wiki Repo"的自动化生产链路，使系统首次具备从原始资料到可浏览 Wiki 的端到端能力。

## What Changes

- 补全 Drizzle ORM schema：`graphify_runs`、`graph_nodes`、`graph_edges`、`graph_communities`、`graph_node_aliases`、`graph_node_merges`、`graph_reports`、`page_block_metadata`、`graph_evidence_refs`、`index_snapshots`、`wiki_update_proposals` 共 11 张表定义 + 15 个索引 + Zod 验证
- 实现 `packages/graph-core`：graph.json 解析器（兼容 Graphify v0.5.3 实际输出）、schema 校验、stable_key 计算（Doc 21 §8A.3）、双置信度映射（raw → effective）、community 归并、graph 导入 repository
- 实现 graphify-worker Python Runner：manifest 生成、Graphify CLI 子进程调用、输出上传 MinIO、validation_report.json 生成、quarantine 机制、shrink guard
- 实现 wiki-core normalization：页面类型识别（Doc 21 §9.3）、frontmatter 自动生成（Doc 21 §9.5）、扁平→嵌套目录归类、block ownership marker 注入、page_block_metadata 写入、冲突检测与更新合并
- 新建 Graphify API 端点：runs CRUD、cancel、retry、report 查看、graph 浏览
- Admin UI：Graphify runs 管理页面、quarantine 管理、运行报告查看

## Capabilities

### New Capabilities

- `graphify-schema`: Drizzle ORM 表定义（graphify_runs / graph_nodes / graph_edges / graph_communities / graph_node_aliases / graph_node_merges / graph_reports / page_block_metadata / graph_evidence_refs / index_snapshots / wiki_update_proposals）+ 15 索引 + Zod validation
- `graph-core-parser`: graph.json 解析与校验——兼容 Graphify v0.5.3 最小结构、字段补齐（metadata/communities）、edge 悬挂引用丢弃、非法 confidence 降级为 AMBIGUOUS
- `graph-core-importer`: 图谱导入——stable_key 计算、跨 run 匹配（alias lookup）、community 归并、双置信度映射（raw 保留 Graphify 原始值、effective 按 Doc 09 §12.2 归一化）、graph_nodes/edges/communities 写入
- `graphify-worker-runner`: Python Worker 实际执行——manifest.json 生成、Graphify CLI 子进程管理（timeout/cancel）、输出目录上传 MinIO、validation_report 生成、quarantine 标记、shrink guard 检测
- `wiki-normalization`: wiki-core 导入层——页面类型识别（index/community/god_node/generated_article）、frontmatter 自动生成、扁平→嵌套目录归类、block ownership marker 注入、page_block_metadata 写入、冲突检测与更新合并
- `graphify-api`: REST API 模块——9 个端点（per OpenAPI: create run、list runs、get run、cancel、retry、get report、get graph summary、admin list、admin retry）+ graphify:run/graphify:view 权限守卫（Doc 12 §2.2）+ 审计 + Doc 12 §6.1 输出校验 + Doc 12 §6.3 Markdown 清洗
- `graphify-admin-ui`: Admin 管理页面——Graphify runs 列表（状态筛选）、运行详情（report 查看）、quarantine 审查（重试/查看错误详情）

### Modified Capabilities

- `wiki-core`: 新增 normalization 模块（importGraphifyWiki）+ page_block_metadata 管理
- `wiki-schema`: 新增 page_block_metadata 表到 Drizzle schema

## Impact

- **Schema**: `packages/shared/src/schema/core.ts` 新增 11 张表定义 + 15 个索引；`packages/shared/src/schema/validation.ts` 新增 Graphify/Graph 相关 Zod schema
- **API**: `apps/api/` 新增 `graphify/` 模块（controller + service）和 `graph/` 模块（repository），注册到 `app.module.ts`
- **Packages**: `packages/graph-core/` 从空壳变为完整 package；`packages/wiki-core/` 新增 normalization 子模块
- **Python Worker**: `apps/graphify-worker/src/runner.py` 从 no-op 变为实际 Graphify CLI 执行逻辑
- **Frontend**: `apps/web/` 新增 Graphify runs 管理页面和 quarantine 管理页面
- **权限**: 使用 `graphify:run`（触发/取消/重试 Graphify run）、`graphify:view`（查看 run 列表/详情/报告）per Doc 12 §2.2；Admin 端点使用 `admin` role guard
- **审计**: 新增 `graphify.run.create`、`graphify.run.cancel`、`graphify.run.retry` 审计事件（per Doc 12 §8）
- **依赖**: Python 侧无新外部依赖（使用 subprocess 调用 Graphify CLI）；Node 侧无新外部依赖
