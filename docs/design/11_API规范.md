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

两个命名空间，按调用方向划分：

**Cherry API 接收 Docmost 事件**（Docmost → Cherry API）：

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/internal/docmost/events/page-saved` | 页面保存事件。 |
| POST | `/api/internal/docmost/events/page-deleted` | 页面删除事件。 |
| POST | `/api/internal/docmost/events/attachment-created` | 附件上传事件。 |

**Docmost Fork 暴露 Bridge 能力**（Cherry API → Docmost）：

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/internal/bridge/pages/{docmost_page_id}/export` | 导出页面 Markdown。 |
| PUT | `/api/internal/bridge/pages/{docmost_page_id}/import` | 导入/更新页面。 |
| GET | `/api/internal/bridge/attachments/{attachment_id}/download` | 下载附件。 |
| GET | `/api/internal/bridge/spaces/{docmost_space_id}/sync-status` | 同步状态。 |
| GET | `/api/internal/bridge/health` | Bridge 健康检查。 |

所有接口仅内网可访问，使用 `DOCMOST_BRIDGE_SECRET` HMAC 签名认证。

## 12. OpenAPI 草案

详见 [`../schemas/openapi.yaml`](../schemas/openapi.yaml)。

## 13. Docmost Bridge 内部 API 详细定义

> 本节合并 TODO T-2.1.2 / T-7.2。  
> `/api/internal/docmost/*` = Cherry API 暴露，接收 Docmost 事件。  
> `/api/internal/bridge/*` = Docmost Fork 暴露，供 Cherry API / wiki-sync-worker 调用。  
> 所有接口不对普通用户开放。

### 13.1 认证

所有请求必须包含：

```http
Authorization: Bearer ${DOCMOST_BRIDGE_SECRET}
X-Bridge-Event-Id: evt_...
X-Bridge-Signature: hmac-sha256(payload, DOCMOST_BRIDGE_SECRET)
```

服务端按 `event_id` 幂等处理。重复事件返回 `200 OK`，并标记 `deduplicated=true`。

### 13.2 页面保存事件

```http
POST /api/internal/docmost/events/page-saved
```

调用方：Docmost Fork。  
触发时机：Docmost 页面保存成功后。

请求：

```json
{
  "event_id": "evt_page_saved_001",
  "docmost_space_id": "dm_space_abc",
  "docmost_page_id": "dm_page_123",
  "actor_id": "dm_user_456",
  "title": "SSO 认证流程",
  "updated_at": "2026-04-28T10:00:00Z",
  "content_hash": "sha256...",
  "attachments": [
    {"attachment_id":"att_1","filename":"diagram.png","size_bytes":1024}
  ]
}
```

响应：

```json
{
  "accepted": true,
  "deduplicated": false,
  "sync_job_id": "job_sync_001"
}
```

错误处理：

| 状态 | 含义 | 重试 |
|---|---|---|
| 400 | payload 不合法 | 否 |
| 401/403 | bridge secret 错误 | 否，告警 |
| 409 | 版本冲突 | 否，转 `conflict_required` |
| 429 | 限流 | 是 |
| 500/503 | 服务异常 | 是，指数退避 |

### 13.3 附件事件

```http
POST /api/internal/docmost/events/attachment-created
```

请求：

```json
{
  "event_id": "evt_att_001",
  "docmost_space_id": "dm_space_abc",
  "docmost_page_id": "dm_page_123",
  "attachment_id": "att_1",
  "filename": "sso-design.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 102400,
  "download_url": "http://docmost:3000/api/internal/bridge/attachments/att_1/download",
  "created_at": "2026-04-28T10:01:00Z"
}
```

处理：写入 Source Archive，创建 ingestion job，不直接进入检索。

### 13.4 页面导出（Docmost Fork 暴露）

```http
GET /api/internal/bridge/pages/{docmost_page_id}/export?format=markdown
```

调用方：Cherry API / wiki-sync-worker → Docmost Fork。  
响应：

```json
{
  "docmost_page_id": "dm_page_123",
  "title": "SSO 认证流程",
  "format": "markdown",
  "content_markdown": "# SSO 认证流程\n...",
  "updated_at": "2026-04-28T10:00:00Z",
  "content_hash": "sha256..."
}
```

### 13.5 页面导入/更新（Docmost Fork 暴露）

```http
PUT /api/internal/bridge/pages/{docmost_page_id}/import
```

调用方：wiki-sync-worker → Docmost Fork。  
触发时机：Graphify → Docmost 同步或候选更新被接受。

请求：

```json
{
  "docmost_space_id": "dm_space_abc",
  "title": "SSO 认证流程",
  "content_markdown": "---\npage_id: rd.auth.sso\n---\n# SSO 认证流程\n...",
  "source": "graphify",
  "page_version_id": "ver_001",
  "overwrite_policy": "preserve_human_blocks"
}
```

### 13.6 同步状态（Docmost Fork 暴露）

```http
GET /api/internal/bridge/spaces/{docmost_space_id}/sync-status
```

响应：

```json
{
  "docmost_space_id": "dm_space_abc",
  "space_id": "space_rd",
  "status": "healthy",
  "pending_events": 0,
  "last_success_at": "2026-04-28T10:05:00Z"
}
```

## 14. Wiki API 补充

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/spaces/{space_id}/wiki/pages` | 查询 Wiki 页面列表。 |
| GET | `/api/spaces/{space_id}/wiki/pages/{page_id}` | 获取页面当前版本与索引版本。 |
| GET | `/api/spaces/{space_id}/wiki/pages/{page_id}/versions` | 页面版本列表。 |
| POST | `/api/spaces/{space_id}/wiki/pages/{page_id}/publish` | 发布页面版本。 |
| POST | `/api/spaces/{space_id}/wiki/pages/{page_id}/reindex` | 触发页面重索引。 |
| GET | `/api/spaces/{space_id}/wiki/consistency` | Space 一致性状态。 |

## 15. Admin API 补充

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/admin/graphify/runs` | Graphify run 列表。 |
| POST | `/api/admin/graphify/runs/{run_id}/retry` | 重试 run。 |
| GET | `/api/admin/consistency-checks` | 一致性检查列表。 |
| POST | `/api/admin/spaces/{space_id}/rebuild-index` | 重建 Space 索引。 |
| GET | `/api/admin/retrieval-traces/{trace_id}` | 检索调试详情。 |
