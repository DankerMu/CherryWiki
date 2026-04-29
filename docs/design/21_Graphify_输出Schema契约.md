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
| `node.id` | `graph_nodes.node_key`（Graphify 原始 ID，按 run 唯一） |
| `node.id` → `stable_key` 算法 | `graph_nodes.stable_key`（跨 run 稳定键，见 8A） |
| `node.label` | `graph_nodes.label` |
| `node.norm_label` | `graph_nodes.norm_label` |
| `node.type` | `graph_nodes.type` |
| `node.community` | `graph_nodes.community_id` |
| `node.source_file/source_location` | `graph_nodes.source_refs_json` |
| `edge.source` | `graph_edges.source_node_id` |
| `edge.target` | `graph_edges.target_node_id` |
| `edge.relation` | `graph_edges.relation_type` |
| `edge.confidence` | `graph_edges.confidence_label` |
| `edge.confidence_score` | `graph_edges.confidence_score` |
| `edge.evidence` | `graph_edges.evidence_refs_json` |

## 8A. 图谱节点身份稳定性

### 8A.1 问题

Graphify 的 `node.id` 由 `_make_id(*parts)` 生成——将名称片段拼接、去特殊字符、小写化。这个 ID 在同一次 run 内是稳定的，但跨 run 可能因以下原因漂移：

1. 源文件路径变化（重命名/移动目录）→ `_make_id(str(path))` 结果变化
2. LLM 提取的实体名称细微变化 → 不同 run 产生不同 ID
3. `deduplicate_by_label()` 的 surviving ID 选择依赖输入顺序

如果不解决，历史引用、用户反馈、人工治理记录、Wiki page_id 绑定都会断裂。

### 8A.2 双键设计

| 字段 | 来源 | 作用域 | 用途 |
|---|---|---|---|
| `node_key` | Graphify 原始 `node.id` | 单次 run 内唯一 | 原始数据保真，用于 run 内关联 |
| `stable_key` | graph-core 计算 | 跨 run 稳定 | 所有持久引用（page_id、反馈、治理、路径缓存）绑定此键 |

### 8A.3 stable_key 生成算法

```python
import hashlib

def compute_stable_key(space_id: str, norm_label: str, node_type: str) -> str:
    """
    跨 run 稳定的节点身份键。
    绑定 Space + 规范化 label + 类型，不绑定源文件路径或 run ID。
    """
    raw = f"{space_id}:{norm_label}:{node_type or 'concept'}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]
```

`norm_label` 使用 Graphify 的规范化逻辑（`re.sub(r"[^a-z0-9 ]", "", label.lower()).strip()`），确保大小写、标点差异不影响身份。

### 8A.4 跨 run 匹配流程

```text
新 run 产生 graph.json
  → 对每个 node：
    1. 计算 stable_key = hash(space_id + norm_label + type)
    2. 查 graph_nodes 中同 Space 是否已存在 stable_key
    3. 已存在 → 复用 stable_key，记录 node_key 变化到 graph_node_aliases
    4. 不存在 → 查 graph_node_aliases 是否有别名匹配
    5. 别名匹配 → 复用别名指向的 stable_key
    6. 均不匹配 → 新建 stable_key
```

### 8A.5 别名表

当同一概念出现不同名称时（如 "SSO" 和 "Single Sign-On"），graph-core 记录别名：

```sql
-- graph_node_aliases
-- 同一 stable_key 可有多个 alias
INSERT INTO graph_node_aliases (id, tenant_id, space_id, node_stable_key, alias, source, confidence)
VALUES ('...', 't1', 's1', 'a1b2c3d4...', 'sso', 'graphify', 1.0);
```

别名来源：
- `graphify`：不同 run 中同一概念的 node.id 变化，自动记录
- `manual`：管理员手动添加的同义词
- `merge`：节点合并时，被合并方的所有别名继承

### 8A.6 合并表

管理员可合并重复节点：

```sql
-- graph_node_merges
INSERT INTO graph_node_merges (id, tenant_id, space_id, from_stable_key, to_stable_key, reason, created_by)
VALUES ('...', 't1', 's1', 'old_key', 'new_key', 'duplicate: SSO vs Single Sign-On', 'user_admin');
```

合并触发：
1. `from_stable_key` 的所有别名转移到 `to_stable_key`
2. 引用 `from_stable_key` 的 wiki page frontmatter `graph_node_ids` 更新
3. 历史 graph_edges 中 `from` 侧节点重映射到 `to`（仅活跃快照）
4. 用户反馈中的节点引用重映射

### 8A.7 page_id 绑定更新

Doc 21 Section 9.4 定义的 god node page_id 现在绑定 `stable_key` 而非 `node.id`：

```
god node page_id = {space_id}.god-node.{stable_key[:12]}
```

这确保 Graphify 重新提取时 node.id 变化不影响 Wiki 页面身份。

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
| `god_node` | `god-node` | `{stable_key[:12]}`（跨 run 稳定，见 8A.3） | `rd-platform.god-node.a1b2c3d4e5f6` |
| `generated_article` | `page` | SHA256(slug)[:12] | `rd-platform.page.a1b2c3d4e5f6` |

**关键决策**：page_id 不绑定 label，label 改名时 page_id 不变。具体绑定策略按类型区分：
- `community`：绑定 graph.json 中的 community ID（聚类 ID 在合理范围内稳定）。
- `god_node`：绑定 graph-core 计算的 `stable_key`（见 §8A.3），**不绑定 graph.json node.id**（node.id 跨 run 可能漂移）。
- `generated_article`：绑定 slug 的 SHA256（无图谱节点对应）。

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

### 9.7 block ownership — 双轨制

Docmost 富文本编辑器可能在保存/导出时清洗 HTML 注释、重排块结构、丢失 frontmatter。因此 block ownership **不能只依赖 Markdown 内嵌注释**，必须采用双轨制：

**轨道 1：正文内嵌标记（best-effort）**

Canonical Wiki Repo 中的 Markdown 正文仍包含 HTML 注释标记：

```markdown
<!-- graphify:managed:start id="summary" run="gf_run_001" -->
...Graphify 生成的正文...
<!-- graphify:managed:end -->

<!-- human:curated:start id="implementation-notes" -->
...人工修订内容...
<!-- human:curated:end -->
```

这些标记用于 Git diff 可读性和非 Docmost 场景（直接编辑 Markdown 文件）。

**轨道 2：sidecar metadata（权威源）**

`page_block_metadata` 表为每个 block 记录结构化元数据：

```json
{
  "page_id": "rd.auth.sso",
  "page_version_id": "ver_003",
  "blocks": [
    {
      "block_id": "summary",
      "owner": "graphify",
      "content_hash": "sha256...",
      "graphify_run_id": "gf_run_001",
      "editable": false
    },
    {
      "block_id": "implementation-notes",
      "owner": "human",
      "content_hash": "sha256...",
      "last_editor": "user_admin",
      "editable": true
    }
  ]
}
```

**合并判断以 sidecar 为准**，内嵌标记为辅助。

**Bridge 导出流程（Docmost → Canonical Wiki Repo）**：

```text
1. Bridge 导出 Docmost 页面正文（可能丢失 HTML 注释）
2. wiki-core 读取 page_block_metadata 获取 block 清单
3. 对每个 block：
   a. 按 block_id 定位正文区域（通过 heading 匹配或 content_hash 模糊匹配）
   b. 计算新 content_hash
   c. 与 sidecar 中记录的 content_hash 对比
   d. 若 owner = graphify 且 hash 变化 → 说明用户编辑了 Graphify 区块 → 转为 human 所有权
   e. 若 owner = human 且 hash 变化 → 正常人工修订，更新 hash 和 last_editor
   f. 若 hash 未变 → 无操作
4. 重新注入 HTML 注释标记到 Canonical Wiki Repo 的 Markdown
5. 更新 page_block_metadata
```

**Graphify 更新流程**：

```text
1. wiki-core 读取 page_block_metadata
2. owner = graphify 的 block → 允许覆盖
3. owner = human 的 block → 不碰，如果 Graphify 对同区域有新内容 → 生成 proposal
4. 更新 sidecar metadata 中 graphify block 的 content_hash 和 graphify_run_id
```

### 9.8 冲突策略

| 场景 | 策略 |
|---|---|
| **Graphify slug 与现有页面 slug 冲突** | 查 Canonical Wiki Repo 的 `page_id`。如果 page_id 匹配（同一逻辑页面），执行更新；如果 page_id 不匹配（不同页面撞 slug），Graphify 侧 slug 追加 `_gf_{run_id_short}` 后缀。 |
| **Graphify 节点 label 改名** | god_node page_id 绑定 `stable_key`（基于 `norm_label + type`，见 §8A.3），不绑定 graph.json `node.id`。若 label 改名但 `norm_label` 不变，page_id 不变；若 `norm_label` 变化导致 `stable_key` 变化，graph-core 通过 `graph_node_aliases` 匹配旧身份（见 §8A.4）。frontmatter `title` 更新为新 label，文件名 slug 如果变化则执行 rename（git mv），旧路径写 redirect。 |
| **同一 god node 多次生成** | page_id = `{space}.god-node.{stable_key[:12]}`，绑定 graph-core `stable_key`（见 §8A.3），不绑定 graph.json `node.id`。graph.json `node.id` 仅作为 `node_key`（run 内保真），跨 run 页面身份、反馈、治理、citation 均绑定 `stable_key`。多次运行只更新 `graphify:managed` 区块和 frontmatter `version`、`graphify_run_id`。 |
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
