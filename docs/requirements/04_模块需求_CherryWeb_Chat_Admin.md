# 04. 模块需求：Cherry Web、Chat、Admin

## 1. 模块目标

Cherry Web 是用户进入平台的主入口，负责 AI 聊天、Agent、GraphRAG 结果展示、知识引用、会话管理和基础用户体验。Admin Console 是管理入口，负责模型、用户、权限、Graphify 任务、上传归档、索引和审计。

## 2. Cherry Web 前端

> **视觉规范**: 所有前端 UI 实现须遵循 `docs/design/12_UI设计规范_CherryStudio风格对齐.md`，使用 CSS token 体系，禁止硬编码色值。

### 2.1 基础页面

| 页面 | 功能 |
|---|---|
| 登录页 | 用户登录、SSO 入口、忘记密码。 |
| 工作台首页 | 最近会话、最近 Wiki 更新、可访问 Spaces、Graphify 状态。 |
| Chat 页面 | 流式聊天、知识空间选择、引用展示。图谱解释：Phase 3 启用。 |
| 会话列表 | 会话搜索、收藏、归档、删除。 |
| Wiki 跳转页 | Phase 1：打开 Cherry Web 内置只读 Wiki；Phase 2+：可跳转 Docmost 页面，携带页面版本和段落定位。 |
| 上传中心 | 上传资料、查看解析和 Graphify 状态。 |
| 任务中心 | 查看个人或 Space 级任务。 |

### 2.2 Chat 页面需求

#### 输入区

- 支持多轮对话。
- 支持选择模型。
- 支持选择知识范围：一个或多个有权限 Space。
- 支持开启/关闭 GraphRAG 解释。
- 支持”数据库”开关：开启后允许 Agent 查询内网数据库、生成图表。仅当当前 Space 配置了数据库连接且 `database_config.enabled = true` 时可见。选择多个 Space 时，如果部分 Space 配置了数据库，数据库开关仅对配置了 `database_config` 的 Space 生效，未配置数据库的 Space 不受影响。
- 支持”深度分析”开关：开启后强制走 Claude Code Agent 多轮推理，适用于复杂关系、架构推理类问题。
- 支持附件上传，但附件不会直接作为临时上下文，而是进入上传归档和 Graphify 流程；如需临时分析，应单独标记为”临时会话附件”。

#### 输出区

##### 回答状态机

每条 AI 回答在前端有明确的状态流转，UI 必须据此展示对应状态指示：

```text
pending_retrieval → generating → completed
                                ↘ failed
pending_retrieval → failed（检索阶段失败）
generating → aborted（用户主动取消）
```

| 状态 | UI 表现 |
|---|---|
| `pending_retrieval` | 显示"正在检索知识库..."动画（使用 `--color-primary` 色调的脉冲加载指示器） |
| `generating` | 显示流式文字 + 打字光标（光标色 `--color-primary`） |
| `completed` | 回答完整展示，引用卡片可点击（卡片使用 `--color-surface` 背景、`--color-border` 边框） |
| `failed` | 显示错误信息（`--color-error` 文字、`--color-error-soft` 背景）+ 重试按钮（`--color-primary` 主按钮） |
| `aborted` | 显示已生成的部分内容 + "已中止"标记（`--color-warning` 色标签） |

##### 回答结构

每条 AI 回答必须结构化返回：

```json
{
  "answer": "...",
  "answer_source": "knowledge_base",
  "citations": [
    {
      "type": "wiki_page",
      "page_id": "wiki.auth.sso",
      "page_title": "统一认证与 SSO",
      "page_version": 12,
      "current_page_version": 14,
      "section_id": "sec.oauth-flow",
      "quote": "...",
      "score": 0.87
    }
  ],
  "graph_paths": [
    {
      "path_id": "path_001",
      "nodes": ["SSO", "OAuth2", "Token Refresh"],
      "edges": ["uses", "issues"],
      "confidence": "EXTRACTED"
    }
  ],
  "retrieval_debug": {
    "visible_to_admin_only": true
  }
}
```

`answer_source` 字段标识回答知识来源：

| 值 | 含义 | UI 标注 | 条件 |
|---|---|---|---|
| `knowledge_base` | 基于 Published Wiki 检索 | 默认，显示引用卡片（`--color-surface` 背景、`--color-border` 边框） | — |
| `model_knowledge` | 知识库无命中，基于模型自有知识 | 显示 `--color-warning-soft` 背景 + `--color-warning` 文字的警告横幅："⚠ 此回答基于模型通用知识，非知识库引用，准确性未经验证" | 仅当 `strict_knowledge_only = false` |
| `mixed` | 部分基于知识库、部分基于模型补充 | 引用部分正常显示，模型补充部分使用 `--color-warning-soft` 背景单独标注 | 仅当 `strict_knowledge_only = false` |
| `no_hit` | 知识库无命中且严格模式 | 显示 `--color-info` 色调引导卡片："当前知识库没有可引用资料，请上传或发布相关 Wiki" | 当 `strict_knowledge_only = true` |

##### 无知识命中策略

行为由 Space 级配置 `strict_knowledge_only` 决定（默认 `true`），管理员可在 Admin Console 按 Space 切换。

**严格模式（`strict_knowledge_only = true`，默认）：**

1. **拒答事实性内容** — 不使用模型通用知识回答企业知识类问题
2. **引导上传** — 返回提示："当前知识库没有可引用资料，请上传或发布相关 Wiki"
3. **`answer_source = no_hit`** — 不伪造引用，`citations` 为空数组
4. **审计记录** — 标记为 `no_retrieval_hit`，供管理员分析知识覆盖率

**宽松模式（`strict_knowledge_only = false`，管理员手动开启）：**

1. **允许模型补充** — 模型可基于自有知识回答，但必须标注
2. **必须标注** — `answer_source` 设为 `model_knowledge`，前端显示明确警告
3. **不伪造引用** — `citations` 数组为空，不生成虚假引用
4. **不计入企业知识审计** — `model_knowledge` 回答不纳入"知识库回答"统计
5. **建议上传** — 回答末尾附加提示："如需更准确的回答，建议上传相关资料至知识库"
6. **审计记录** — 标记为 `no_retrieval_hit`

##### 引用版本提示

当 `citation.page_version < citation.current_page_version` 时，UI 必须在引用卡片上显示提示：

- 标注文字："引用历史版本 v{page_version}，当前已更新至 v{current_page_version}"
- 提供"查看最新版本"链接
- 引用卡片使用 `--color-warning-soft` 背景 + `--color-border-strong` 虚线边框进行视觉区分

#### 引用展示

- 引用卡片显示页面标题、段落标题、版本、更新时间。
- 点击引用跳转 Docmost 页面或 Cherry 内置 Wiki 只读视图。
- 如果引用来自图谱节点，应展示节点所在页面和源段落。
- 如果引用关系为 `INFERRED` 或 `AMBIGUOUS`，必须使用 `--color-status-degraded-text` 色标签 + `--color-status-degraded-bg` 背景明确标注置信度等级。

#### 图谱解释展示

- 展示与答案相关的 3–5 条图谱路径。
- 支持展开节点详情、关系类型、置信度、来源页面。
- 支持“这个关系不准确”反馈。

## 3. Chat Engine 后端

### 3.1 主要职责

1. 会话状态管理。
2. 查询路由：根据意图和开关判定走静态 RAG 快速路径还是 Claude Code Agent 深度路径（见 Doc 23 §2）。
3. 静态 RAG 路径：模型调用和流式输出、Prompt 组装和上下文压缩。
4. Agent 深度路径：spawn Claude Code 子进程，注入 CLAUDE.md 规则和 CLI 工具环境，SSE 流式转发。
5. 引用和图谱路径回传。
6. 图表数据转发（Agent 路径下 `cherrydb chart` 输出的 ECharts JSON）。
7. 审计日志（含 Agent 路径下的所有 SQL 执行记录）。

### 3.2 请求协议

```http
POST /api/chat/completions
Content-Type: application/json
```

```json
{
  "conversation_id": "conv_001",
  "model_id": "gpt-4.1",
  "space_ids": ["space_rd"],
  "message": "我们的单点登录流程是什么？",
  "retrieval_mode": "hybrid_text",
  "include_graph_explanation": false,
  "enable_database": false,
  "enable_deep_analysis": false,
  "stream": true
}
```

`enable_database` 和 `enable_deep_analysis` 为 Phase 3+ 新增字段，Phase 1 忽略。当任一为 `true` 时，Chat Engine 走 Claude Code Agent 深度路径而非静态 RAG。详见 [Doc 23](../design/23_Agent架构与CLI工具设计.md)。

### 3.3 SSE 事件

> 完整协议定义见 `docs/design/11_API规范.md` §10 Chat API。

| 事件 | 阶段 | 说明 | 前端状态迁移 |
|---|---|---|---|
| `retrieval.started` | 检索 | 检索开始 | → `pending_retrieval` |
| `retrieval.completed` | 检索 | 检索完成 | — |
| `retrieval.failed` | 检索 | 检索失败（可降级） | → `failed` 或降级继续 |
| `rerank.completed` | 检索 | 重排完成 | — |
| `message.delta` | 生成 | LLM token 增量 | → `generating` |
| `citation.added` | 生成 | 新引用产生 | — |
| `graph_path.added` | 生成 | 图谱路径产生 | — |
| `message.completed` | 完成 | 回答完成 | → `completed` |
| `message.error` | 错误 | 不可恢复错误 | → `failed` |
| `usage.reported` | 完成 | Token 用量 | — |
| `chart.data` | 生成 | 图表数据（ECharts JSON） | — |
| `agent.tool_use` | 生成 | Agent 正在调用工具（仅深度路径） | — |

前端根据 SSE 事件驱动状态迁移，用户点击"停止生成"发送 abort 信号后状态置为 `aborted`。

`chart.data` 事件携带 ECharts 配置 JSON，前端使用 ECharts 组件渲染。`agent.tool_use` 事件用于深度分析模式下展示 Agent 正在执行的操作（如"正在查询数据库..."），增强用户感知。

## 4. Admin Console

### 4.1 用户管理

- 创建、禁用、恢复用户。
- 重置密码或绑定 SSO。
- 查看用户所属 Groups。
- 查看用户最近登录、上传、编辑、问答行为。

### 4.2 Group 管理

- 创建 Group。
- 添加/移除成员。
- 绑定 Space 权限。
- 绑定模型权限。
- 绑定功能权限，例如上传、编辑、触发 Graphify。

### 4.3 Space 管理

一个 Space 代表一个知识权限域，对应：

- 一个 Docmost Space。
- 一个 Canonical Wiki Repo 子目录或分支。
- 一个 Graphify corpus。
- 一组向量/图谱/全文索引范围。
- 一组 ACL。
- 可选：一个内网数据库连接。

Space 配置项：

```json
{
  "space_id": "space_rd_platform",
  "name": "研发平台部",
  "docmost_space_id": "dm_space_123",
  "wiki_repo_path": "spaces/rd-platform",
  "graphify_mode": "deep",
  "auto_run_graphify": true,
  "upload_enabled": true,
  "manual_edit_enabled": true,
  "publish_policy": "editor_publish",
  "database_config": {
    "enabled": false,
    "dsn": "",
    "allowed_tables": [],
    "masked_columns": [],
    "description": ""
  }
}
```

`database_config` 控制该 Space 是否允许用户通过 Chat 查询内网数据库（见 Doc 23 §6）。`enabled` 为 `true` 时，前端 Chat 页面显示"数据库"开关。

### 4.4 模型管理

- Chat Model。
- Embedding Model。
- Rerank Model。
- Vision Model。
- Transcription Model。
- 每个模型配置供应商、API key、base URL、限流、可见 Group。

### 4.5 Graphify 任务管理

列表字段：

| 字段 | 说明 |
|---|---|
| run_id | Graphify 运行 ID。 |
| space_id | 所属 Space。 |
| trigger_type | upload / page_edit / manual / scheduled。 |
| mode | build / update / cluster-only / merge。 |
| status | pending/running/indexing/completed/failed。 |
| input_version | 输入 Wiki 版本。 |
| output_version | 输出 graph 版本。 |
| duration | 耗时。 |
| tokens/cost | 模型调用成本，可选。 |
| error | 失败摘要。 |

操作：

- 查看日志。
- 下载输出。
- 重试。
- 取消。
- 回滚到上个 graph 版本。
- 触发索引重建。

### 4.6 索引管理

- 查看每个 Space 的 Wiki 页面数量、chunk 数、节点数、边数。
- 查看索引版本。
- 触发全量重建或增量更新。
- 查看最近失败 chunk。
- 查看低质量页面和孤立节点。

### 4.7 审计日志

必须记录：

- 登录/登出。
- 上传/删除/归档。
- 页面创建/编辑/删除/发布。
- 权限变更。
- Graphify 运行。
- 索引重建。
- Chat 请求和引用来源。
- 管理员配置变更。

## 5. API 模块边界

```text
Chat API         只处理对话和模型流。
Knowledge API    只处理检索、索引、引用和 GraphRAG。
Wiki API         只处理 Graphify Wiki 元数据，不替代 Docmost 编辑 API。
Graphify API     只处理 Graphify 任务、输出、图谱查询。
Upload API       只处理上传归档和解析任务。
Admin API        只处理管理配置。
```

不得在 Chat API 中直接访问 Docmost 数据库或源文件归档。Chat API 只读已发布索引。

## 6. Phase 1 验收

1. 用户登录后可以发起流式聊天。
2. 用户可以选择自己有权限的 Space。
3. Chat Engine 调用 wiki_only / hybrid_text 检索（即 Vector + BM25，静态 RAG 快速路径）。
4. 回答带 Wiki 引用。
5. 管理员可以创建用户、Group、Space。
6. 管理员可以查看 Graphify 任务和索引状态。
7. 权限过滤有效。

### Phase 3 验收（本阶段不做）

- Claude Code Agent 深度路径可用，支持多轮 tool-use 循环。
- `graphify query/path/explain` CLI 可通过 Agent 调用，图谱关系可解释。
- "深度分析"开关有效，复杂问题走 Agent 路径。
- Agent 路径回答包含引用来源标注。

### Phase 3+ 数据库验收（本阶段不做）

- 管理员可为 Space 配置数据库连接（DSN + 表白名单 + 列脱敏）。
- "数据库"开关仅在配置了数据库的 Space 中可见。
- 用户开启开关后，Agent 可通过 `cherrydb` CLI 查询数据库。
- `cherrydb chart` 输出的 ECharts JSON 可被前端渲染为图表。
- 所有 SQL 执行记录写入审计日志。
