# 21. Graphify 输出 Schema 契约

## 1. 目标

Graphify 是 CherryGraph 的知识图谱与 Wiki 生成引擎。为避免 Graphify 输出变化影响 Cherry Web，必须定义 `Graphify Output Schema v1`，作为 `graph-core` 和 `wiki-core` 的输入契约。

## 2. 依据（基于 Graphify v0.5.3 源码验证）

Graphify 当前流程：

```text
detect() → extract() → build_graph() → cluster() → analyze() → report() → export()
```

### 2.1 实际输出目录结构

经源码验证（`export.py`、`wiki.py`、`report.py`、`cache.py`），Graphify v0.5.3 实际输出：

```text
graphify-out/
  graph.json              # to_json() — NetworkX node_link_data，links 自动重映射为 edges
  GRAPH_REPORT.md         # report() — 含 Summary、God Nodes、Communities、Ambiguous Edges、Knowledge Gaps、Suggested Questions
  graph.html              # to_html() — vis.js 交互可视化（>5000 节点时跳过）
  cache/
    ast/{sha256}.json     # 代码文件 AST 提取缓存
    semantic/{sha256}.json # LLM 语义提取缓存
  wiki/                   # to_wiki() — 扁平结构，无子目录
    index.md              # 统计和索引
    {community_slug}.md   # 社区文章（扁平，非 communities/ 子目录）
    {god_node_slug}.md    # 核心节点文章（扁平，非 god-nodes/ 子目录）
  needs_update            # 增量更新标志文件（可选）
  memory/                 # query 结果保存目录（可选）
```

### 2.2 Graphify 实际 graph.json 结构

```json
{
  "nodes": [
    {
      "id": "unique_string",
      "label": "human name",
      "norm_label": "normalized_name",
      "type": "module",
      "community": "community_1",
      "source_file": "path",
      "source_location": "L42"
    }
  ],
  "edges": [
    {
      "source": "id_a",
      "target": "id_b",
      "relation": "calls|imports|uses|...",
      "confidence": "EXTRACTED|INFERRED|AMBIGUOUS",
      "confidence_score": 1.0
    }
  ],
  "hyperedges": []
}
```

### 2.3 关键差异（Graphify 实际 vs 本契约期望）

| 差异点 | Graphify v0.5.3 实际 | 本契约期望 | 处理策略 |
|---|---|---|---|
| `metadata` 顶层字段 | **不存在** | 需要 `graphify_version` + `generated_at` | graph-core 导入时从环境变量和任务记录补齐 |
| `communities` 顶层数组 | **不存在**（社区信息在节点 `community` 字段） | 需要独立 `communities` 数组 | graph-core 从节点 `community` 字段归并生成 |
| `hyperedges` 顶层数组 | **存在** | 未定义 | graph-core 解析并存入扩展表或忽略 |
| `norm_label` 节点字段 | **存在**（去音标规范化） | 未定义 | 导入时写入 `graph_nodes` 备用搜索字段 |
| Wiki frontmatter | **不存在**（纯 Markdown，无 YAML frontmatter） | 需要 page_id/space_id/source 等 | wiki-core 导入时自动生成 frontmatter |
| Wiki 目录结构 | **扁平**（所有文件在 wiki/ 根） | 需要 communities/god-nodes/pages 子目录 | wiki-core 导入时按类型归类到 Canonical Wiki Repo |
| 置信度默认值 | EXTRACTED=1.0, INFERRED=0.5, AMBIGUOUS=0.2 | 0.90 / 0.70 / 0.40 | **采用 Graphify 实际值**（见 4.2 更新） |
| graph.html 节点上限 | >5000 节点时跳过生成 | 未标注 | 补充到 3.1 |

**处理原则**：Graphify 输出按原样接受，所有不足由 `graph-core` 和 `wiki-core` 导入层补齐。不要求修改 Graphify 源码。

## 3. CherryGraph 接受的 Output Schema v1

### 3.1 输出文件

| 文件/目录 | 必选 | 用途 |
|---|---:|---|
| `graph.json` | 是 | 导入 `graph_nodes`、`graph_edges`、`graph_communities`。 |
| `GRAPH_REPORT.md` | 是 | 导入 `graph_reports`，用于 Space 摘要和治理建议。 |
| `wiki/` | 是 | 导入 Canonical Wiki Repo 或生成候选更新。 |
| `graph.html` | 否 | 管理后台可视化预览。 |
| `cache/` | 否 | Graphify 内部缓存，平台不解析。 |

### 3.2 `graph.json` 兼容结构

CherryGraph v1 解析器必须兼容 Graphify v0.5.3 的实际输出（最小结构）：

```json
{
  "nodes": [
    {
      "id": "auth_service",
      "label": "Auth Service",
      "norm_label": "auth service",
      "type": "module",
      "community": "community_1",
      "source_file": "docs/auth.md",
      "source_location": "L10-L20"
    }
  ],
  "edges": [
    {
      "source": "auth_service",
      "target": "token_service",
      "relation": "uses",
      "confidence": "EXTRACTED",
      "confidence_score": 1.0,
      "source_file": "docs/auth.md",
      "source_location": "L42"
    }
  ],
  "hyperedges": []
}
```

**graph-core 导入时补齐的字段**（Graphify 不输出，由平台生成）：

| 字段 | 来源 |
|---|---|
| `metadata.graphify_version` | 从 `GRAPHIFY_PINNED_REF` 环境变量或 `graphify --version` 获取 |
| `metadata.generated_at` | 从 `graphify_runs.completed_at` 获取 |
| `communities[]` 顶层数组 | 从节点 `community` 字段归并生成，写入 `graph_communities` 表 |
| `edge.evidence[]` | 默认 `[]`，后续由知识治理补充 |

### 3.3 Wiki 输出结构

Graphify v0.5.3 实际输出为**扁平结构**（无子目录）：

```text
wiki/                          # Graphify 实际输出
  index.md                     # 统计和社区/核心节点索引
  {community_slug}.md          # 社区文章
  {god_node_slug}.md           # 核心节点文章
```

**wiki-core 导入时归类到 Canonical Wiki Repo 的目标结构**：

```text
spaces/{space_id}/
  index.md
  communities/
    {community_slug}.md
  god-nodes/
    {god_node_slug}.md
  pages/
    {page_slug}.md             # 若 Graphify 未来输出 pages
```

**wiki-core 导入时自动生成 frontmatter**（Graphify 不输出 frontmatter）：

```yaml
---
page_id: rd.auth.sso
title: SSO 认证流程
space_id: space_rd
source: graphify
graphify_run_id: gf_run_001
graphify_schema_version: v1
managed_by: graphify
status: draft
curation_status: auto_generated
created_at: 2026-04-28T00:00:00Z
---
```

wiki-core 通过文件名和 index.md 中的引用关系判断页面类型（community / god-node / page）。

## 4. 校验规则

### 4.1 graph.json 必选字段

| 对象 | 字段 | 类型 | 规则 |
|---|---|---|---|
| node | `id` | string | 非空，Space 内唯一。 |
| node | `label` | string | 非空，长度 <= 256。 |
| edge | `source` | string | 必须能匹配 node.id。 |
| edge | `target` | string | 必须能匹配 node.id。 |
| edge | `relation` | string | 非空，标准化为 snake_case。 |
| edge | `confidence` | enum | `EXTRACTED / INFERRED / AMBIGUOUS`。 |

### 4.2 可选字段默认值

| 字段 | 默认值 |
|---|---|
| `node.type` | `concept` |
| `node.community` | `null` |
| `edge.confidence_score` | 按 label 映射（Graphify 实际值）：EXTRACTED=1.0 / INFERRED=0.5 / AMBIGUOUS=0.2 |
| `edge.evidence` | `[]` |
| `node.norm_label` | 使用 `label` 小写去音标 |
| `metadata.graphify_version` | 从 `GRAPHIFY_PINNED_REF` 或 `graphify --version` 获取 |
| `metadata.generated_at` | 从 `graphify_runs.completed_at` 获取 |
| `hyperedges` | `[]`（存在则解析，不存在则忽略） |

### 4.3 schema 校验失败处理

| 失败类型 | 处理 |
|---|---|
| 缺少 `graph.json` | Graphify run 标记 failed，不更新索引。 |
| 缺少 `wiki/` | run failed，不发布页面。 |
| 部分 edge 引用不存在 node | 丢弃该 edge，记录 warning。 |
| confidence 非法 | 转为 `AMBIGUOUS`，score=0.2。 |
| Markdown frontmatter 非法 | 自动补齐并记录 warning。 |
| graph.json 比上一版本显著缩小 | 触发 shrink guard，需人工确认。 |

## 5. 版本兼容策略

1. `GRAPHIFY_PINNED_REF` 当前锁定版本：v0.5.3。必须记录在环境变量和 Admin 页面。
2. Graphify 升级必须走 ADR。
3. 每次升级前执行 schema contract test。
4. graph-core 不直接依赖 Graphify 内部 Python 类，只读取文件契约。
5. 允许为不同 Graphify 版本实现 adapter：`GraphifyAdapterV1`、`GraphifyAdapterV2`。

## 6. 降级策略

当 schema 不兼容：

1. 不覆盖上一成功 `graphify_run_id`。
2. 不更新 `indexed_version_id`。
3. Chat 继续使用上一成功索引。
4. Admin 显示 schema incompatibility。
5. 保存原始输出到 MinIO 便于排查。
6. 可选择只导入 Wiki，不导入 graph；但必须在 Space 状态标记 `graph_degraded`。

## 7. Contract Test

```bash
pytest tests/contract/test_graphify_output_schema.py -q
```

测试样本：

```text
tests/fixtures/graphify-output/v1/minimal/
tests/fixtures/graphify-output/v1/full/
tests/fixtures/graphify-output/v1/missing-edge-node/
tests/fixtures/graphify-output/v1/invalid-confidence/
```

## 8. 导入映射

| Graphify 字段 | CherryGraph 表字段 |
|---|---|
| `node.id` | `graph_nodes.node_key` |
| `node.label` | `graph_nodes.label` |
| `node.type` | `graph_nodes.type` |
| `node.community` | `graph_nodes.community_id` |
| `node.source_file/source_location` | `graph_nodes.source_refs_json` |
| `edge.source` | `graph_edges.source_node_id` |
| `edge.target` | `graph_edges.target_node_id` |
| `edge.relation` | `graph_edges.relation_type` |
| `edge.confidence` | `graph_edges.confidence_label` |
| `edge.confidence_score` | `graph_edges.confidence_score` |
| `edge.evidence` | `graph_edges.evidence_refs_json` |

## 9. Graphify Wiki Normalization Algorithm

### 9.1 概述

wiki-core 负责将 Graphify 的扁平 wiki/ 目录转换为 Canonical Wiki Repo 的嵌套结构 + 标准 frontmatter。此过程是**确定性**的——相同输入必须产生相同输出。

### 9.2 输入

| 来源 | 用途 |
|---|---|
| `graphify-out/wiki/index.md` | 解析社区列表和 god node 列表，用于页面类型识别 |
| `graphify-out/wiki/{slug}.md` | 页面正文 |
| `graphify-out/graph.json` | 提取 node→community 映射、node.id→node.label 映射 |
| `graphify-out/GRAPH_REPORT.md` | 存为 Space 运行报告 |
| 当前 Canonical Wiki Repo `spaces/{space_id}/` | 用于冲突检测、page_id 复用、人工区块保护 |
| `graphify_runs` 记录 | 提供 `graphify_run_id`、`input_version`、`output_version` |

### 9.3 页面类型识别

Graphify 不输出页面类型元数据，wiki-core 通过以下规则推断：

| 规则 | 类型 | 目标目录 |
|---|---|---|
| 文件名 = `index.md` | `index` | `spaces/{space_id}/index.md` |
| 文件 slug 匹配 graph.json 中某个 `community` label 经 `_safe_filename()` 转换后的结果 | `community` | `spaces/{space_id}/communities/{slug}.md` |
| 文件 slug 匹配 graph.json 中某个 god node label 经 `_safe_filename()` 转换后的结果 | `god_node` | `spaces/{space_id}/god-nodes/{slug}.md` |
| 以上均不匹配 | `generated_article` | `spaces/{space_id}/pages/{slug}.md` |

`_safe_filename()` 逻辑（与 Graphify v0.5.3 `wiki.py:9` 一致）：

```python
slug = label.replace("/", "-").replace(" ", "_").replace(":", "-")
```

Graphify 内部使用 `_unique_slug()` 对重复 slug 追加 `_2`、`_3`。wiki-core 必须用相同算法还原。

### 9.4 page_id 生成规则

```
page_id = {space_id}.{type_prefix}.{stable_key}
```

| 页面类型 | type_prefix | stable_key | 示例 |
|---|---|---|---|
| `index` | `index` | `root` | `rd-platform.index.root` |
| `community` | `community` | `community_{cid}`（graph.json 中 community ID） | `rd-platform.community.community_1` |
| `god_node` | `god-node` | `node_{node_id}`（graph.json 中 node.id） | `rd-platform.god-node.node_auth_service` |
| `generated_article` | `page` | SHA256(slug)[:12] | `rd-platform.page.a1b2c3d4e5f6` |

**关键决策**：page_id 绑定 graph.json 中的 ID（community ID、node ID），不绑定 label。label 改名时 page_id 不变。

### 9.5 frontmatter 生成

每个页面生成的标准 frontmatter：

```yaml
---
page_id: rd-platform.community.community_1
title: 认证与权限          # 取自 Graphify 输出的 community label 或 node label
space_id: rd-platform
page_type: community       # community / god_node / generated_article / index
status: draft              # 新页面默认 draft；已存在页面保留原 status
curation_status: auto_generated
source: graphify
graphify_run_id: gf_run_001
graphify_schema_version: v1
managed_by: graphify       # 整页由 Graphify 管理（人工编辑后局部区块改为 human_curated）
source_document_ids: []    # 从 graph.json 节点的 source_file 反查 file_blobs
graph_node_ids: [auth_service, token_service]  # 页面关联的图节点
version: 1                 # 新页面 = 1；已存在页面 = current_version + 1
acl_hash: ""               # 由 wiki-core 根据 Space 权限计算
created_by: graphify
created_at: 2026-04-28T10:00:00Z
updated_at: 2026-04-28T10:00:00Z
---
```

### 9.6 section anchor 生成

wiki-core 对每个 Markdown 二级/三级标题生成稳定 anchor：

```
section_id = {page_id}#heading-{slugify(heading_text)}
```

用于 Chat 引用跳转到具体段落。

### 9.7 block ownership markers

所有由 Graphify 生成的正文内容包裹 managed marker：

```markdown
<!-- graphify:managed:start id="{page_id}_body" run="{graphify_run_id}" -->
...Graphify 生成的正文...
<!-- graphify:managed:end -->
```

首次生成时整页 = managed。人工编辑某区块后，编辑器将该区块改为：

```markdown
<!-- human:curated:start id="{page_id}_section_xxx" -->
...人工修订内容...
<!-- human:curated:end -->
```

后续 Graphify 更新时只能修改 `graphify:managed` 区块，不碰 `human:curated` 区块。

### 9.8 冲突策略

| 场景 | 策略 |
|---|---|
| **Graphify slug 与现有页面 slug 冲突** | 查 Canonical Wiki Repo 的 `page_id`。如果 page_id 匹配（同一逻辑页面），执行更新；如果 page_id 不匹配（不同页面撞 slug），Graphify 侧 slug 追加 `_gf_{run_id_short}` 后缀。 |
| **Graphify 节点 label 改名** | page_id 绑定 node.id 而非 label，所以 page_id 不变。frontmatter `title` 更新为新 label，文件名 slug 如果变化则执行 rename（git mv），旧路径写 redirect。 |
| **同一 god node 多次生成** | page_id = `{space}.god-node.node_{node_id}`，天然稳定。多次运行只更新 `graphify:managed` 区块和 frontmatter `version`、`graphify_run_id`。 |
| **社区 ID 变化（Graphify 重新聚类）** | community page_id 绑定 community ID。如果 Graphify 重新聚类导致 ID 变化：旧页面标记 `status: deprecated`，新页面创建 draft，不自动删除旧页面。管理员可手动合并或确认。 |
| **扁平 community/god-node 归入嵌套目录** | wiki-core 根据 9.3 的类型识别将文件写入对应子目录。Graphify 的扁平输出不直接写入 Repo。 |
| **GRAPH_REPORT.md 的定位** | 不作为 Wiki 页面，不进入 Canonical Wiki Repo 页面目录。存入 `graphify_runs` 表的 `report_uri` 字段（MinIO），管理后台可查看。Space 概览从 report 摘要提取。 |
| **同时存在 Graphify 更新和人工编辑** | wiki-core 按 block ownership 合并：`graphify:managed` 区块接受 Graphify 更新，`human:curated` 区块保持不变。如果 Graphify 试图修改 `human:curated` 区块对应的段落，生成 `graphify:proposal` 候选更新，等待人工确认。 |

### 9.9 转换流程

```text
1. 读取 graphify-out/graph.json
   → 构建 community_id → label 映射
   → 构建 node_id → label 映射
   → 构建 node_id → community_id 映射

2. 遍历 graphify-out/wiki/*.md
   → 对每个文件：
     a. 识别页面类型（9.3）
     b. 生成或复用 page_id（9.4）
     c. 生成 frontmatter（9.5）
     d. 生成 section anchors（9.6）
     e. 包裹 block ownership markers（9.7）
     f. 写入 Canonical Wiki Repo 对应目录

3. 处理 GRAPH_REPORT.md
   → 存入 graphify_runs.report_uri（MinIO）
   → 不写入 Canonical Wiki Repo

4. 冲突检测
   → 对比 Repo 中已有页面的 page_id
   → 已有页面：按 block ownership 合并（9.8）
   → 新页面：直接写入

5. 输出 index_update_manifest
   → 新增/更新/删除的页面列表
   → 需重新 chunk 和 embedding 的页面列表
   → 图节点/边变更列表
```
