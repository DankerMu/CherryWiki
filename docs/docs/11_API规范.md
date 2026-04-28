# 11. API 规范

## 1. 设计原则

1. API 统一以 `/api` 开头。
2. 所有请求带 `tenant_id` 上下文，由 token 解析，不从客户端明文信任。
3. 所有响应使用统一错误格式。
4. 流式聊天使用 SSE。
5. 后台任务使用 job_id 查询状态。
6. 不允许前端直接访问 Worker。
7. Docmost 同步通过 `docmost-bridge`，不要把 Docmost API 暴露给 Chat Engine。

## 2. 统一响应

```json
{
  "data": {},
  "meta": {
    "request_id": "req_001"
  }
}
```

错误：

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "无权访问该 Space",
    "details": {}
  },
  "meta": {
    "request_id": "req_001"
  }
}
```

## 3. Auth API

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录。 |
| POST | `/api/auth/logout` | 登出。 |
| GET | `/api/auth/me` | 当前用户。 |
| POST | `/api/auth/refresh` | 刷新 token。 |

## 4. Space API

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/spaces` | 查询可访问 Space。 |
| POST | `/api/spaces` | 创建 Space。 |
| GET | `/api/spaces/{space_id}` | 查询详情。 |
| PATCH | `/api/spaces/{space_id}` | 更新配置。 |
| GET | `/api/spaces/{space_id}/stats` | 知识统计。 |

## 5. Upload API

```http
POST /api/spaces/{space_id}/uploads
Content-Type: multipart/form-data
```

响应：

```json
{
  "data": {
    "source_document_id": "src_001",
    "ingestion_job_id": "job_001",
    "status": "uploaded"
  }
}
```

其他接口：

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/uploads/{source_document_id}` | 查看上传资料。 |
| GET | `/api/uploads/{source_document_id}/status` | 查看处理状态。 |
| POST | `/api/uploads/{source_document_id}/reprocess` | 重新解析。 |

## 6. Graphify API

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/spaces/{space_id}/graphify/runs` | 创建 Graphify 任务。 |
| GET | `/api/graphify/runs` | 查询任务列表。 |
| GET | `/api/graphify/runs/{run_id}` | 查询任务详情。 |
| POST | `/api/graphify/runs/{run_id}/cancel` | 取消任务。 |
| POST | `/api/graphify/runs/{run_id}/retry` | 重试任务。 |
| GET | `/api/graphify/runs/{run_id}/report` | 获取报告。 |
| GET | `/api/graphify/runs/{run_id}/graph` | 获取图谱摘要。 |

创建任务请求：

```json
{
  "mode": "update",
  "trigger_type": "manual",
  "input_scope": {
    "page_ids": ["rd.auth.sso"],
    "source_document_ids": ["src_001"]
  },
  "options": {
    "wiki": true,
    "no_viz": false,
    "directed": false
  }
}
```

## 7. Wiki API

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/spaces/{space_id}/wiki/pages` | 查询页面。 |
| GET | `/api/wiki/pages/{page_id}` | 查询页面元数据。 |
| GET | `/api/wiki/pages/{page_id}/versions` | 查询版本。 |
| POST | `/api/wiki/pages/{page_id}/publish` | 发布版本。 |
| POST | `/api/wiki/pages/{page_id}/rollback` | 回滚。 |
| GET | `/api/wiki/pages/{page_id}/citations` | 查询来源证据。 |
| GET | `/api/wiki/pages/{page_id}/graph` | 查询页面相关图谱。 |

注意：正文编辑由 Docmost 承担，Cherry Wiki API 不替代 Docmost 编辑器。

## 8. Graph API

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/graph/nodes` | 搜索节点。 |
| GET | `/api/graph/nodes/{node_id}` | 节点详情。 |
| GET | `/api/graph/nodes/{node_id}/neighbors` | 邻居。 |
| POST | `/api/graph/path` | 最短路径。 |
| POST | `/api/graph/query` | 自然语言图谱查询。 |
| GET | `/api/graph/communities` | 社区列表。 |

路径查询：

```json
{
  "space_ids": ["space_rd"],
  "source_label": "SSO",
  "target_label": "权限校验",
  "max_hops": 4,
  "include_inferred": true,
  "include_ambiguous": false
}
```

## 9. Chat API

```http
POST /api/chat/completions
```

请求：

```json
{
  "conversation_id": "conv_001",
  "model_id": "gpt-4.1",
  "space_ids": ["space_rd"],
  "message": "SSO 和权限校验是什么关系？",
  "retrieval_mode": "graph_rag",
  "include_graph_explanation": true,
  "stream": true
}
```

SSE 事件：

```text
event: retrieval.started
data: {"query_id":"rq_001"}

event: message.delta
data: {"text":"..."}

event: citation.added
data: {"page_id":"rd.auth.sso","section_id":"sec_1"}

event: graph_path.added
data: {"path_id":"path_001"}

event: message.completed
data: {"message_id":"msg_001"}
```

## 10. Admin API

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/admin/users` | 用户列表。 |
| POST | `/api/admin/users` | 创建用户。 |
| GET | `/api/admin/groups` | Group 列表。 |
| POST | `/api/admin/groups` | 创建 Group。 |
| GET | `/api/admin/models` | 模型列表。 |
| POST | `/api/admin/models` | 添加模型。 |
| GET | `/api/admin/audit-logs` | 审计日志。 |
| GET | `/api/admin/jobs` | 任务列表。 |
| GET | `/api/admin/system/health` | 健康状态。 |

## 11. Webhook / Bridge API

Docmost Bridge 内部接口：

| Method | Path | 说明 |
|---|---|---|
| POST | `/internal/docmost/events/page-updated` | 页面变更事件。 |
| POST | `/internal/docmost/events/attachment-uploaded` | 附件上传事件。 |
| POST | `/internal/docmost/sync/pull` | 从 Docmost 拉取。 |
| POST | `/internal/docmost/sync/push` | 推送到 Docmost。 |

内部接口必须只在内网或服务网格内可访问。

## 12. OpenAPI 草案

详见 [`../schemas/openapi.yaml`](../schemas/openapi.yaml)。
