# 22. Graphify 集成架构勘误

> 生成时间：2026-05-02 | 基于 graphify 源码实际验证

## 1. 勘误背景

原设计文档多处将 `graphify --wiki` 视为 CLI binary 直接支持的命令。经源码验证（pinned commit `7359cdac` 及最新 `517f3c89`），发现原设计存在根本性架构误解。

## 2. 核心事实

### 2.1 graphify 是什么

graphify（PyPI 包名 `graphifyy`）是一个知识图谱生成工具，支持代码、文档、论文、图片、音视频等多种输入。它由两部分组成：

| 组件 | 运行方式 | 功能 |
|---|---|---|
| **CLI binary** (`graphify` 命令) | 终端直接调用 | 仅提供辅助工具：`query`、`path`、`explain`、`install`、`update`、`clone`、`watch` 等。**不包含完整 pipeline。** |
| **Claude Code skill** (`/graphify` 斜杠命令) | 在 Claude Code 内由 LLM 编排执行 | 完整 pipeline：detect → AST extract → LLM semantic extract → build → cluster → analyze → report → export → wiki |

文档中出现的 `/graphify ./raw --wiki` 是 Claude Code skill 的调用方式，**不是 CLI binary 的命令行参数**。

### 2.2 CLI binary 不支持 `--wiki`

实际 CLI 源码（`graphify/__main__.py:1507`）：

```python
else:
    print(f"error: unknown command '{cmd}'", file=sys.stderr)
    sys.exit(1)
```

`--wiki` 作为 `sys.argv[1]` 会命中 `else` 分支，报错退出。

### 2.3 完整 pipeline 需要 LLM 参与

graphify 的 7 步 pipeline 中，**Step 3（语义提取）需要 LLM**：

```
Step 1: detect()                          ← 纯 Python，文件分类
Step 2: extract() — AST                   ← 纯 Python，tree-sitter 结构提取（仅代码文件）
Step 3: semantic extraction               ← 需要 LLM：读文档/论文/图片，输出 nodes+edges JSON
Step 4: build_from_json()                 ← 纯 Python，NetworkX 图构建
Step 5: cluster() + analyze()             ← 纯 Python，Leiden 社区检测 + god nodes 分析
Step 6: to_json() + to_html() + to_wiki() ← 纯 Python，导出
Step 7: report.generate()                 ← 纯 Python，生成 GRAPH_REPORT.md
```

对于文档型输入（CherryWiki 的主要场景），AST 提取不产出有意义节点——**语义提取是图谱质量的核心**。

### 2.4 `wiki.py` 模块版本依赖

| 模块 | pinned commit (`7359cdac`) | 最新 (`517f3c89`) |
|---|---|---|
| `graphify/wiki.py` (`to_wiki()`) | **不存在** | 存在 |
| `graphify/build.py` | 存在 | 存在 |
| `graphify/cluster.py` | 存在 | 存在 |
| `graphify/analyze.py` | 存在 | 存在 |
| `graphify/export.py` | 存在 | 存在 |

当前 pinned ref 缺少 `to_wiki()`，必须更新到包含 `wiki.py` 的版本。

## 3. 原设计中的错误引用

| 文件 | 位置 | 错误内容 | 修正 |
|---|---|---|---|
| `docs/architecture/02_总体架构设计.md` | §4 数据流 Mermaid | `GF->>GF: 执行 graphify --wiki --update` | `GF->>GF: 调用 graphify Python API + LLM 语义提取` |
| `docs/architecture/02_总体架构设计.md` | §9 推荐组件 | `Worker: Python + Graphify CLI/library wrapper` | `Worker: Python + Graphify Python API + OpenAI-compatible LLM` |
| `docs/project/16_实施路线图与里程碑.md` | §2.2 Phase 1 交付物 | `自动执行 graphify --wiki，保存 graphify-out` | `调用 graphify Python API 生成知识图谱和 Wiki` |
| `docs/requirements/05_模块需求_GraphifyWiki唯一知识源.md` | §5.1 Job payload | `Graphify CLI/library 的 pinned 版本` | `Graphify Python 库的 pinned 版本` |
| `docs/requirements/05_模块需求_GraphifyWiki唯一知识源.md` | §6 状态机 | `执行 Graphify CLI` | `执行 Graphify Python pipeline（含 LLM 语义提取）` |
| `docs/design/21_Graphify_输出Schema契约.md` | §4.2 默认值 | `graphify --version` | 从 `pip show graphifyy` 或 pinned ref 获取 |
| `docs/design/21_Graphify_输出Schema契约.md` | §5 版本策略 | `v0.5.3` | 需更新到包含 `wiki.py` 的版本 |

## 4. 正确的集成架构

### 4.1 graphify-worker 调用方式

```python
# runner.py — 正确的调用方式（Python API + LLM）

# Step 1: 读取输入文档
docs = load_input_files(input_dir)

# Step 2: LLM 语义提取（调用 Deepseek Flash / 其他 OpenAI 兼容模型）
extraction = await llm_semantic_extract(docs, model_api_base, model_api_key, model_name)

# Step 3: 构建图
from graphify.build import build_from_json
G = build_from_json(extraction)

# Step 4: 社区聚类
from graphify.cluster import cluster, score_all
communities = cluster(G)
cohesion = score_all(G, communities)

# Step 5: 分析
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
gods = god_nodes(G)

# Step 6: 导出
from graphify.export import to_json, to_html
to_json(G, communities, str(output_dir / "graph.json"))
to_html(G, communities, str(output_dir / "graph.html"))

# Step 7: Wiki 生成
from graphify.wiki import to_wiki
to_wiki(G, communities, str(output_dir / "wiki"),
        community_labels=labels, cohesion=cohesion, god_nodes_data=gods)

# Step 8: 报告
from graphify.report import generate
report = generate(G, communities, cohesion, labels, gods, ...)
(output_dir / "GRAPH_REPORT.md").write_text(report)
```

### 4.2 LLM 语义提取

语义提取步骤使用 graphify skill.md 中定义的提取 prompt（Step B2），通过 OpenAI 兼容 API 调用 CherryWiki 配置的 LLM：

```python
async def llm_semantic_extract(docs, api_base, api_key, model):
    """调用 LLM 提取文档中的概念和关系"""
    from openai import AsyncOpenAI
    client = AsyncOpenAI(base_url=api_base, api_key=api_key)

    extraction_prompt = GRAPHIFY_EXTRACTION_PROMPT  # 来自 skill.md Step B2

    all_nodes, all_edges = [], []
    for chunk in chunk_files(docs, chunk_size=20):
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": extraction_prompt + file_contents}],
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        all_nodes.extend(result["nodes"])
        all_edges.extend(result["edges"])

    return {"nodes": deduplicate(all_nodes), "edges": all_edges}
```

### 4.3 环境变量配置

graphify-worker 需要的环境变量：

```yaml
# LLM 配置（语义提取用）
MODEL_API_BASE_URL: https://api.example.com/v1    # OpenAI 兼容端点
MODEL_API_KEY: sk-xxx                              # API 密钥
DEFAULT_CHAT_MODEL: deepseek-v4-flash              # 用于语义提取的模型

# Graphify 配置
GRAPHIFY_PINNED_REF: <包含 wiki.py 的 commit SHA>  # 需更新
GRAPHIFY_DEFAULT_MODE: full                         # full / deep
```

### 4.4 Dockerfile 更新

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl && rm -rf /var/lib/apt/lists/*

# 安装包含 wiki.py 的最新 graphify
ARG GRAPHIFY_REF=<新版本 commit SHA>
RUN pip install --no-cache-dir "git+https://github.com/safishamsi/graphify.git@${GRAPHIFY_REF}"

# 安装 openai SDK（LLM 语义提取用）
RUN pip install --no-cache-dir openai

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ src/
EXPOSE 9094
CMD ["python", "-m", "src"]
```

## 5. 影响范围

### 5.1 需要修改的代码

| 文件 | 变更 |
|---|---|
| `apps/graphify-worker/Dockerfile` | 更新 GRAPHIFY_REF，添加 `openai` 依赖 |
| `apps/graphify-worker/requirements.txt` | 添加 `openai` |
| `apps/graphify-worker/src/runner.py` | 重写：CLI subprocess → Python API + LLM 调用 |
| `docker-compose.yml` | graphify-worker 环境变量确保 `MODEL_API_BASE_URL`、`MODEL_API_KEY`、`DEFAULT_CHAT_MODEL` 正确传递 |

### 5.2 不受影响的部分

- **输出 Schema 不变**：graph.json、wiki/、GRAPH_REPORT.md 的结构与 Doc 21 定义一致
- **graph-core / wiki-core 导入逻辑不变**：它们只消费输出文件，不关心生成方式
- **Job 状态机不变**：`pending → preparing → running_graphify → parsing_output → ...` 流程保持
- **validation 逻辑不变**：runner.py 中的 `_validate_output()` 仍然适用

## 6. 决策记录

| 决策 | 理由 |
|---|---|
| 使用 Python API 而非 CLI subprocess | CLI binary 不支持 `--wiki`，且缺少完整 pipeline |
| 使用 OpenAI 兼容 API 调 LLM | CherryWiki 已配置 Deepseek Flash，成本低、速度快 |
| graphify-worker 不使用 Claude Code | graphify-worker 的语义提取使用 Deepseek Flash（低成本），不需要 Claude Code 的 agent 能力 |

> **注意**：本决策仅限 graphify-worker（图谱生成场景）。CherryWiki 的 Chat Agent 深度路径（Phase 3+）使用 Claude Code 作为 agent runtime，运行在 cherry-api 容器中而非 graphify-worker。详见 [Doc 27 Agent 架构与 CLI 工具设计](27_Agent架构与CLI工具设计.md) 及 ADR-010。
| 更新 graphify pinned ref | 当前 pinned commit 缺少 `wiki.py` 模块 |
