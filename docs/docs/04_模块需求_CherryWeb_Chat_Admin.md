# 04. 模块需求：Cherry Web、Chat、Admin

## 1. 模块目标

Cherry Web 是用户进入平台的主入口，负责 AI 聊天、Agent、GraphRAG 结果展示、知识引用、会话管理和基础用户体验。Admin Console 是管理入口，负责模型、用户、权限、Graphify 任务、上传归档、索引和审计。

## 2. Cherry Web 前端

### 2.1 基础页面

| 页面 | 功能 |
|---|---|
| 登录页 | 用户登录、SSO 入口、忘记密码。 |
| 工作台首页 | 最近会话、最近 Wiki 更新、可访问 Spaces、Graphify 状态。 |
| Chat 页面 | 流式聊天、知识空间选择、引用展示、图谱解释。 |
| 会话列表 | 会话搜索、收藏、归档、删除。 |
| Wiki 跳转页 | 从引用打开 Docmost 页面，并携带页面版本和段落定位。 |
| 上传中心 | 上传资料、查看解析和 Graphify 状态。 |
| 任务中心 | 查看个人或 Space 级任务。 |

### 2.2 Chat 页面需求

#### 输入区

- 支持多轮对话。
- 支持选择模型。
- 支持选择知识范围：一个或多个有权限 Space。
- 支持开启/关闭 GraphRAG 解释。
- 支持附件上传，但附件不会直接作为临时上下文，而是进入上传归档和 Graphify 流程；如需临时分析，应单独标记为“临时会话附件”。

#### 输出区

每条 AI 回答必须结构化返回：

```json
{
  "answer": "...",
  "citations": [
    {
      "type": "wiki_page",
      "page_id": "wiki.auth.sso",
      "page_title": "统一认证与 SSO",
      "page_version": 12,
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

#### 引用展示

- 引用卡片显示页面标题、段落标题、版本、更新时间。
- 点击引用跳转 Docmost 页面或 Cherry 内置 Wiki 只读视图。
- 如果引用来自图谱节点，应展示节点所在页面和源段落。
- 如果引用关系为 `INFERRED` 或 `AMBIGUOUS`，必须明显标注。

#### 图谱解释展示

- 展示与答案相关的 3–5 条图谱路径。
- 支持展开节点详情、关系类型、置信度、来源页面。
- 支持“这个关系不准确”反馈。

## 3. Chat Engine 后端

### 3.1 主要职责

1. 会话状态管理。
2. 模型调用和流式输出。
3. GraphRAG 检索编排。
4. Prompt 组装和上下文压缩。
5. 工具调用和 MCP Gateway 对接。
6. 引用和图谱路径回传。
7. 审计日志。

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
  "retrieval_mode": "graph_rag",
  "include_graph_explanation": true,
  "stream": true
}
```

### 3.3 SSE 事件

| 事件 | 说明 |
|---|---|
| `message.delta` | LLM token 增量。 |
| `retrieval.started` | 检索开始。 |
| `retrieval.result` | 检索摘要，仅管理员可看到 debug。 |
| `citation.added` | 新引用产生。 |
| `graph_path.added` | 图谱路径产生。 |
| `message.completed` | 回答完成。 |
| `error` | 错误。 |

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
  "publish_policy": "editor_publish"
}
```

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
3. Chat Engine 可以调用 GraphRAG 检索。
4. 回答带 Wiki 引用。
5. 管理员可以创建用户、Group、Space。
6. 管理员可以查看 Graphify 任务和索引状态。
7. 权限过滤有效。
