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

成功：

```json
{
  "data": {},
  "meta": {
    "request_id": "req_001",
    "pagination": {
      "page": 1,
      "per_page": 20,
      "total": 100,
      "has_next": true
    }
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

## 3. 通用约定

### 3.1 分页

所有列表接口统一支持：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | 1 | 页码（从 1 开始） |
| `per_page` | int | 20 | 每页条数（max 100） |
| `sort` | string | `-created_at` | 排序字段，`-` 前缀表示降序 |

### 3.2 Rate Limit

| 类别 | 限制 | 返回 Header |
|---|---|---|
| 公开 API（认证后） | 600 req/min/user | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| Chat completions | 30 req/min/user | 同上 |
| Upload | 10 req/min/user | 同上 |
| Admin API | 300 req/min/user | 同上 |
| Bridge 内部 | 1000 req/min/service | 同上 |

超限返回 `429 Too Many Requests`。

### 3.3 幂等性

写入类接口支持 `X-Idempotency-Key` header（客户端生成 UUID）。服务端对同一 key 在 24h 内返回相同结果。重复请求返回 `200 OK` + `X-Idempotent-Replayed: true`。

### 3.4 通用错误码

| Code | HTTP Status | 说明 |
|---|---|---|
| `UNAUTHENTICATED` | 401 | 未登录或 token 过期 |
| `PERMISSION_DENIED` | 403 | 无权限 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VALIDATION_ERROR` | 422 | 请求参数不合法 |
| `RATE_LIMITED` | 429 | 超限 |
| `CONFLICT` | 409 | 资源冲突 |
| `INTERNAL_ERROR` | 500 | 服务端异常 |

---

## 4. Auth API

### POST `/api/auth/login`

| 项目 | 说明 |
|---|---|
| 权限点 | 无（公开） |
| 幂等策略 | 无需幂等 |
| 审计动作 | `auth.login` |
| Rate Limit | 10 req/min/IP |

输入：

```json
{
  "email": "user@example.com",
  "password": "..."
}
```

输出：

```json
{
  "data": {
    "access_token": "eyJ...",
    "expires_in": 3600,
    "user": {
      "id": "usr_001",
      "email": "user@example.com",
      "name": "Alice",
      "role": "editor",
      "groups": ["grp_rd"]
    }
  }
}
```

响应同时设置 `Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=604800`。浏览器端 refresh token 仅通过 HttpOnly Cookie 保存，不在 JSON body 中返回。

错误码：

| Code | 说明 |
|---|---|
| `INVALID_CREDENTIALS` | 邮箱或密码错误 |
| `ACCOUNT_LOCKED` | 连续失败锁定（5 次/15min） |
| `ACCOUNT_DISABLED` | 账户已禁用 |

### POST `/api/auth/logout`

| 项目 | 说明 |
|---|---|
| 权限点 | 已认证即可 |
| 审计动作 | `auth.logout` |

输入：无（Bearer token + 自动携带的 `refresh_token` Cookie）。如果 Cookie 存在，服务端撤销对应 refresh session；无 Cookie 时仍清理 Cookie 并返回成功。

输出：`{ "data": { "success": true } }`

### GET `/api/auth/me`

| 项目 | 说明 |
|---|---|
| 权限点 | 已认证即可 |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "id": "usr_001",
    "email": "user@example.com",
    "name": "Alice",
    "role": "editor",
    "groups": [
      { "id": "grp_rd", "name": "研发组" }
    ],
    "spaces": [
      { "id": "space_rd", "name": "研发知识库", "role": "editor" }
    ]
  }
}
```

### POST `/api/auth/refresh`

| 项目 | 说明 |
|---|---|
| 权限点 | 无（用 `refresh_token` HttpOnly Cookie） |
| 审计动作 | `auth.token_refresh` |

输入：无 JSON body。浏览器通过 `credentials: include` 自动携带 `refresh_token` Cookie。

输出：

```json
{
  "data": {
    "access_token": "eyJ...",
    "expires_in": 3600
  }
}
```

响应同时轮换 `Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=604800`。

错误码：

| Code | 说明 |
|---|---|
| `INVALID_REFRESH_TOKEN` | refresh token 无效或已过期 |
| `TOKEN_REVOKED` | 已被撤销 |

### Auth refresh/logout 迁移说明

- 浏览器客户端不得读取、缓存或提交 JSON body 中的 `refresh_token`；登录和刷新响应 body 只包含 `access_token`、`expires_in` 以及登录时的 `user`。
- 前端请求 `/api/auth/login`、`/api/auth/refresh`、`/api/auth/logout` 必须使用 `credentials: include`，由浏览器自动管理 `refresh_token` Cookie。
- 旧客户端如果仍依赖 body `refresh_token` 刷新或登出，需要迁移到 Cookie Jar；当前浏览器 Auth API 不保留 JSON body refresh-token 模式。若未来恢复机器客户端 body token 模式，必须使用独立端点或在 OpenAPI 中作为非浏览器模式单独声明。

---

## 5. Space API

### GET `/api/spaces`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view`（仅返回有权限的 Space） |
| 审计动作 | 无 |
| 过滤 | `?status=active&search=keyword` |
| 排序 | `?sort=-updated_at` |

输出：

```json
{
  "data": [
    {
      "id": "space_rd",
      "name": "研发知识库",
      "slug": "rd",
      "status": "active",
      "docmost_space_id": "dm_space_abc",
      "stats": {
        "page_count": 42,
        "source_count": 15,
        "node_count": 320
      },
      "created_at": "2026-01-01T00:00:00Z",
      "updated_at": "2026-04-28T10:00:00Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 3, "has_next": false } }
}
```

### POST `/api/spaces`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:admin` 或 Admin 角色 |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `space.create` |

输入：

```json
{
  "name": "产品知识库",
  "slug": "product",
  "description": "产品团队共享知识"
}
```

输出：

```json
{
  "data": {
    "id": "space_product",
    "name": "产品知识库",
    "slug": "product",
    "status": "active",
    "docmost_space_id": "dm_space_xyz",
    "created_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `SPACE_SLUG_CONFLICT` | slug 已存在 |
| `SPACE_LIMIT_EXCEEDED` | 超出 Space 数量限制 |

### GET `/api/spaces/{space_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "id": "space_rd",
    "name": "研发知识库",
    "slug": "rd",
    "description": "研发团队知识库",
    "status": "active",
    "docmost_space_id": "dm_space_abc",
    "wiki_repo_path": "/data/wiki/space_rd",
    "index_consistency_status": "healthy",
    "config": {
      "auto_graphify": true,
      "graphify_schedule": "on_change",
      "default_retrieval_mode": "hybrid_text"
    },
    "stats": {
      "page_count": 42,
      "source_count": 15,
      "node_count": 320,
      "edge_count": 580,
      "last_graphify_at": "2026-04-27T18:00:00Z"
    },
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-04-28T10:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `SPACE_NOT_FOUND` | Space 不存在 |

### PATCH `/api/spaces/{space_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:admin` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `space.update` |

输入：

```json
{
  "name": "研发知识库（新）",
  "config": {
    "auto_graphify": false
  }
}
```

输出：更新后的完整 Space 对象（同 GET）。

错误码：

| Code | 说明 |
|---|---|
| `SPACE_NOT_FOUND` | Space 不存在 |
| `SPACE_SLUG_CONFLICT` | slug 冲突 |

### GET `/api/spaces/{space_id}/stats`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "space_id": "space_rd",
    "page_count": 42,
    "source_count": 15,
    "node_count": 320,
    "edge_count": 580,
    "community_count": 12,
    "pending_ingestion_jobs": 2,
    "index_consistency": "healthy",
    "last_graphify_run": {
      "run_id": "run_099",
      "status": "completed",
      "completed_at": "2026-04-27T18:00:00Z"
    }
  }
}
```

---

## 6. Upload API

### POST `/api/spaces/{space_id}/uploads`

| 项目 | 说明 |
|---|---|
| 权限点 | `upload:create` |
| 幂等策略 | `X-Idempotency-Key`（基于文件 hash 去重） |
| 审计动作 | `upload.create` |
| Rate Limit | 10 req/min/user |
| Content-Type | `multipart/form-data`（文件上传）或 `application/json`（URL 抓取） |

输入方式一：文件上传（`multipart/form-data`）：

| Field | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | binary | 是 | 文件（max 50MB） |
| `title` | string | 否 | 自定义标题（默认用文件名） |
| `tags` | string[] | 否 | 标签 |
| `auto_graphify` | boolean | 否 | 上传后自动触发 Graphify（默认 false） |

输入方式二：URL 抓取（`application/json`）：

| Field | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string (URI) | 是 | 目标 URL（由 url-fetcher-worker 抓取，source_type=url） |
| `title` | string | 否 | 自定义标题（默认用页面 title） |
| `tags` | string[] | 否 | 标签 |
| `auto_graphify` | boolean | 否 | 抓取后自动触发 Graphify（默认 false） |

输出：

```json
{
  "data": {
    "source_document_id": "src_001",
    "space_id": "space_rd",
    "filename": "sso-design.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 102400,
    "content_hash": "sha256:abc...",
    "ingestion_job_id": "job_001",
    "status": "uploaded",
    "created_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `SPACE_NOT_FOUND` | Space 不存在 |
| `FILE_TOO_LARGE` | 超过 50MB |
| `UNSUPPORTED_FILE_TYPE` | 不支持的文件格式 |
| `DUPLICATE_FILE` | 相同 hash 文件已存在（返回已有 source_document_id） |
| `STORAGE_QUOTA_EXCEEDED` | Space 存储配额超限 |
| `SSRF_BLOCKED` | URL 指向内网/metadata/被拦截地址 |
| `MIME_MISMATCH` | 文件 magic bytes 与扩展名/Content-Type 不匹配 |
| `ZIP_BOMB_DETECTED` | ZIP 解压后超过大小限制（>500MB） |
| `PATH_TRAVERSAL_DETECTED` | ZIP 内含路径穿越条目（../../） |
| `ZIP_NESTING_EXCEEDED` | ZIP 嵌套超过 3 层 |

### GET `/api/uploads/{source_document_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | `upload:read` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "source_document_id": "src_001",
    "space_id": "space_rd",
    "filename": "sso-design.pdf",
    "title": "SSO 设计文档",
    "mime_type": "application/pdf",
    "size_bytes": 102400,
    "content_hash": "sha256:abc...",
    "tags": ["auth", "sso"],
    "status": "processed",
    "ingestion_job_id": "job_001",
    "chunk_count": 24,
    "created_at": "2026-04-28T12:00:00Z",
    "processed_at": "2026-04-28T12:05:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `SOURCE_DOCUMENT_NOT_FOUND` | 资料不存在 |

### GET `/api/uploads/{source_document_id}/status`

| 项目 | 说明 |
|---|---|
| 权限点 | `upload:read` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "source_document_id": "src_001",
    "ingestion_job_id": "job_001",
    "status": "processing",
    "progress": {
      "stage": "chunking",
      "percent": 65,
      "current_step": "splitting into chunks",
      "chunks_created": 16
    },
    "started_at": "2026-04-28T12:01:00Z",
    "estimated_completion": "2026-04-28T12:05:00Z"
  }
}
```

| status 枚举 | 说明 |
|---|---|
| `uploaded` | 已上传，等待处理 |
| `processing` | 处理中 |
| `processed` | 处理完成 |
| `failed` | 处理失败 |

### POST `/api/uploads/{source_document_id}/reprocess`

| 项目 | 说明 |
|---|---|
| 权限点 | `upload:create` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `upload.reprocess` |

输入：

```json
{
  "reason": "chunk strategy updated"
}
```

输出：

```json
{
  "data": {
    "source_document_id": "src_001",
    "ingestion_job_id": "job_002",
    "status": "uploaded"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `SOURCE_DOCUMENT_NOT_FOUND` | 资料不存在 |
| `REPROCESS_ALREADY_RUNNING` | 已有进行中的处理任务 |

---

## 7. Graphify API

### POST `/api/spaces/{space_id}/graphify/runs`

| 项目 | 说明 |
|---|---|
| 权限点 | `graphify:run` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `graphify.run.create` |

输入：

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

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `mode` | enum | 是 | `full` / `update` / `incremental` |
| `trigger_type` | enum | 是 | `manual` / `scheduled` / `auto` |
| `input_scope.page_ids` | string[] | 否 | 指定处理的页面 |
| `input_scope.source_document_ids` | string[] | 否 | 指定处理的源文档 |
| `options.wiki` | boolean | 否 | 是否生成 Wiki 页面（默认 true） |
| `options.no_viz` | boolean | 否 | 是否跳过可视化（默认 false） |
| `options.directed` | boolean | 否 | 是否生成有向图（默认 false） |

输出：

```json
{
  "data": {
    "run_id": "run_100",
    "space_id": "space_rd",
    "mode": "update",
    "trigger_type": "manual",
    "status": "queued",
    "created_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `SPACE_NOT_FOUND` | Space 不存在 |
| `GRAPHIFY_RUN_ALREADY_RUNNING` | 该 Space 已有运行中的 Graphify 任务 |
| `INVALID_INPUT_SCOPE` | input_scope 中引用了不存在的资源 |
| `EMPTY_INPUT_SCOPE` | 未指定任何输入且 Space 无可处理内容 |

### GET `/api/graphify/runs`

| 项目 | 说明 |
|---|---|
| 权限点 | `graphify:view` |
| 审计动作 | 无 |
| 过滤 | `?space_id=xxx&status=running&trigger_type=manual` |
| 排序 | `?sort=-created_at` |

输出：

```json
{
  "data": [
    {
      "run_id": "run_100",
      "space_id": "space_rd",
      "mode": "update",
      "trigger_type": "manual",
      "status": "running",
      "progress": { "percent": 45, "stage": "entity_extraction" },
      "created_at": "2026-04-28T12:00:00Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 5, "has_next": false } }
}
```

### GET `/api/graphify/runs/{run_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | `graphify:view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "run_id": "run_100",
    "space_id": "space_rd",
    "mode": "update",
    "trigger_type": "manual",
    "status": "completed",
    "progress": { "percent": 100, "stage": "done" },
    "input_scope": {
      "page_ids": ["rd.auth.sso"],
      "source_document_ids": ["src_001"]
    },
    "result": {
      "nodes_created": 15,
      "nodes_updated": 8,
      "edges_created": 32,
      "wiki_pages_generated": 3,
      "schema_version": "1.0.0",
      "graph_json_uri": "s3://cherry/graphify/run_100/graph.json",
      "report_uri": "s3://cherry/graphify/run_100/report.md"
    },
    "created_at": "2026-04-28T12:00:00Z",
    "started_at": "2026-04-28T12:00:05Z",
    "completed_at": "2026-04-28T12:10:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `GRAPHIFY_RUN_NOT_FOUND` | Run 不存在 |

### POST `/api/graphify/runs/{run_id}/cancel`

| 项目 | 说明 |
|---|---|
| 权限点 | `graphify:run` |
| 审计动作 | `graphify.run.cancel` |

输入：无

输出：

```json
{
  "data": {
    "run_id": "run_100",
    "status": "cancelling"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `GRAPHIFY_RUN_NOT_FOUND` | Run 不存在 |
| `GRAPHIFY_RUN_NOT_CANCELLABLE` | 当前状态不可取消（已完成/已取消） |

### POST `/api/graphify/runs/{run_id}/retry`

| 项目 | 说明 |
|---|---|
| 权限点 | `graphify:run` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `graphify.run.retry` |

输入：无

输出：

```json
{
  "data": {
    "run_id": "run_101",
    "parent_run_id": "run_100",
    "status": "queued"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `GRAPHIFY_RUN_NOT_FOUND` | Run 不存在 |
| `GRAPHIFY_RUN_NOT_RETRYABLE` | 当前状态不可重试（非 failed） |

### GET `/api/graphify/runs/{run_id}/report`

| 项目 | 说明 |
|---|---|
| 权限点 | `graphify:view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "run_id": "run_100",
    "report_format": "markdown",
    "content": "# Graphify Report\n...",
    "generated_at": "2026-04-28T12:10:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `GRAPHIFY_RUN_NOT_FOUND` | Run 不存在 |
| `REPORT_NOT_READY` | Run 未完成，报告尚不可用 |

### GET `/api/graphify/runs/{run_id}/graph`

| 项目 | 说明 |
|---|---|
| 权限点 | `graphify:view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "run_id": "run_100",
    "summary": {
      "node_count": 23,
      "edge_count": 40,
      "community_count": 4
    },
    "top_entities": [
      { "id": "node_sso", "label": "SSO", "type": "concept", "degree": 12 }
    ],
    "schema_version": "1.0.0"
  }
}
```

---

## 8. Wiki API

### GET `/api/spaces/{space_id}/wiki/pages`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |
| 过滤 | `?status=published&search=keyword&tag=auth` |
| 排序 | `?sort=-updated_at` |

输出：

```json
{
  "data": [
    {
      "page_id": "rd.auth.sso",
      "space_id": "space_rd",
      "title": "SSO 认证流程",
      "status": "published",
      "current_version_id": "ver_003",
      "indexed_version_id": "ver_003",
      "sync_status": "synced",
      "source": "graphify",
      "tags": ["auth", "sso"],
      "updated_at": "2026-04-28T10:00:00Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 42, "has_next": true } }
}
```

### GET `/api/spaces/{space_id}/wiki/pages/{page_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "page_id": "rd.auth.sso",
    "space_id": "space_rd",
    "title": "SSO 认证流程",
    "status": "published",
    "source": "graphify",
    "current_version": {
      "version_id": "ver_003",
      "content_hash": "sha256:def...",
      "created_at": "2026-04-28T10:00:00Z",
      "author": "graphify"
    },
    "indexed_version": {
      "version_id": "ver_003",
      "indexed_at": "2026-04-28T10:05:00Z"
    },
    "docmost_page_id": "dm_page_123",
    "sync_status": "synced",
    "tags": ["auth", "sso"],
    "citations_count": 5,
    "related_nodes_count": 8
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `WIKI_PAGE_NOT_FOUND` | 页面不存在 |

### GET `/api/spaces/{space_id}/wiki/pages/{page_id}/versions`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |
| 排序 | `?sort=-created_at` |

输出：

```json
{
  "data": [
    {
      "version_id": "ver_003",
      "content_hash": "sha256:def...",
      "author": "graphify",
      "source_run_id": "run_100",
      "status": "current",
      "created_at": "2026-04-28T10:00:00Z"
    },
    {
      "version_id": "ver_002",
      "content_hash": "sha256:abc...",
      "author": "user:usr_001",
      "status": "archived",
      "created_at": "2026-04-25T08:00:00Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 3, "has_next": false } }
}
```

### POST `/api/spaces/{space_id}/wiki/pages/{page_id}/publish`

| 项目 | 说明 |
|---|---|
| 权限点 | `wiki:publish` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `wiki.page.publish` |

输入：

```json
{
  "version_id": "ver_003",
  "publish_note": "经审核确认准确性"
}
```

输出：

```json
{
  "data": {
    "page_id": "rd.auth.sso",
    "version_id": "ver_003",
    "status": "published",
    "published_at": "2026-04-28T12:00:00Z",
    "published_by": "usr_001"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `WIKI_PAGE_NOT_FOUND` | 页面不存在 |
| `VERSION_NOT_FOUND` | 版本不存在 |
| `VERSION_ALREADY_PUBLISHED` | 该版本已发布 |

### POST `/api/spaces/{space_id}/wiki/pages/{page_id}/rollback`

| 项目 | 说明 |
|---|---|
| 权限点 | `wiki:rollback` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `wiki.page.rollback` |

输入：

```json
{
  "target_version_id": "ver_002",
  "reason": "ver_003 包含错误信息"
}
```

输出：

```json
{
  "data": {
    "page_id": "rd.auth.sso",
    "rolled_back_to": "ver_002",
    "new_version_id": "ver_004",
    "status": "published",
    "rolled_back_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `WIKI_PAGE_NOT_FOUND` | 页面不存在 |
| `VERSION_NOT_FOUND` | 目标版本不存在 |

### GET `/api/spaces/{space_id}/wiki/pages/{page_id}/citations`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": [
    {
      "citation_id": "cite_001",
      "source_document_id": "src_001",
      "source_title": "SSO 设计文档",
      "chunk_id": "chunk_012",
      "excerpt": "SSO 采用 SAML 2.0 协议...",
      "confidence": 0.92,
      "page_section": "认证协议选型"
    }
  ]
}
```

### GET `/api/spaces/{space_id}/wiki/pages/{page_id}/graph`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "page_id": "rd.auth.sso",
    "nodes": [
      { "id": "node_sso", "label": "SSO", "type": "concept" },
      { "id": "node_saml", "label": "SAML 2.0", "type": "protocol" }
    ],
    "edges": [
      { "source": "node_sso", "target": "node_saml", "relation": "uses", "weight": 0.85 }
    ]
  }
}
```

### POST `/api/spaces/{space_id}/wiki/pages/{page_id}/reindex`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:admin` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `wiki.page.reindex` |

输入：无

输出：

```json
{
  "data": {
    "page_id": "rd.auth.sso",
    "reindex_job_id": "job_reindex_001",
    "status": "queued"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `WIKI_PAGE_NOT_FOUND` | 页面不存在 |
| `REINDEX_ALREADY_RUNNING` | 已有重索引任务运行中 |

### GET `/api/spaces/{space_id}/wiki/consistency`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:admin` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "space_id": "space_rd",
    "status": "healthy",
    "checked_at": "2026-04-28T11:00:00Z",
    "pages_total": 42,
    "pages_consistent": 42,
    "pages_inconsistent": 0,
    "inconsistencies": []
  }
}
```

---

## 9. Graph API

### GET `/api/graph/nodes`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view`（按 ACL 过滤节点） |
| 审计动作 | 无 |
| 过滤 | `?space_ids=space_rd&type=concept&search=SSO&min_degree=3` |
| 排序 | `?sort=-degree` |

输出：

```json
{
  "data": [
    {
      "id": "node_sso",
      "label": "SSO",
      "type": "concept",
      "space_id": "space_rd",
      "degree": 12,
      "community_id": "comm_auth",
      "properties": {
        "description": "Single Sign-On 认证机制",
        "source_pages": ["rd.auth.sso"]
      }
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 320, "has_next": true } }
}
```

### GET `/api/graph/nodes/{node_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view`（需对节点所属 Space 有权限） |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "id": "node_sso",
    "label": "SSO",
    "type": "concept",
    "space_id": "space_rd",
    "degree": 12,
    "community_id": "comm_auth",
    "properties": {
      "description": "Single Sign-On 认证机制",
      "source_pages": ["rd.auth.sso"],
      "source_documents": ["src_001"]
    },
    "edges_in": [
      { "source": "node_oauth", "relation": "extends", "weight": 0.7 }
    ],
    "edges_out": [
      { "target": "node_saml", "relation": "uses", "weight": 0.85 }
    ]
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `GRAPH_NODE_NOT_FOUND` | 节点不存在 |

### GET `/api/graph/nodes/{node_id}/neighbors`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |
| 过滤 | `?max_hops=2&relation_type=uses&min_weight=0.5` |

输出：

```json
{
  "data": {
    "center": "node_sso",
    "neighbors": [
      {
        "node": { "id": "node_saml", "label": "SAML 2.0", "type": "protocol" },
        "relation": "uses",
        "weight": 0.85,
        "hops": 1
      }
    ],
    "total_neighbors": 12
  }
}
```

### POST `/api/graph/path`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |

输入：

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

输出：

```json
{
  "data": {
    "paths": [
      {
        "path_id": "path_001",
        "hops": 2,
        "total_weight": 1.65,
        "nodes": [
          { "id": "node_sso", "label": "SSO" },
          { "id": "node_token", "label": "Token" },
          { "id": "node_perm", "label": "权限校验" }
        ],
        "edges": [
          { "source": "node_sso", "target": "node_token", "relation": "generates", "weight": 0.9 },
          { "source": "node_token", "target": "node_perm", "relation": "consumed_by", "weight": 0.75 }
        ]
      }
    ],
    "total_paths_found": 3
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `GRAPH_NODE_NOT_FOUND` | source 或 target 节点不存在 |
| `NO_PATH_FOUND` | 无可达路径 |
| `MAX_HOPS_EXCEEDED` | max_hops 超过系统上限（10） |

### POST `/api/graph/query`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | `graph.query` |

输入：

```json
{
  "space_ids": ["space_rd"],
  "query": "SSO 和权限校验之间有哪些中间实体？",
  "max_results": 10
}
```

输出：

```json
{
  "data": {
    "query_id": "gq_001",
    "interpretation": "查找 SSO → 权限校验 路径上的中间节点",
    "results": [
      {
        "node": { "id": "node_token", "label": "Token", "type": "artifact" },
        "relevance": 0.92,
        "context": "SSO 生成 Token，权限校验消费 Token"
      }
    ],
    "subgraph": {
      "nodes": [],
      "edges": []
    }
  }
}
```

### GET `/api/graph/communities`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |
| 过滤 | `?space_ids=space_rd&min_size=3` |

输出：

```json
{
  "data": [
    {
      "community_id": "comm_auth",
      "label": "认证与授权",
      "space_id": "space_rd",
      "node_count": 15,
      "density": 0.72,
      "top_nodes": [
        { "id": "node_sso", "label": "SSO", "degree": 12 }
      ]
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 12, "has_next": false } }
}
```

---

## 10. Chat API

### POST `/api/chat/completions`

| 项目 | 说明 |
|---|---|
| 权限点 | `chat:use` + `model:use`（对指定模型） |
| 幂等策略 | 无（幂等由 conversation_id + message 自然去重） |
| 审计动作 | `chat.completion` |
| Rate Limit | 30 req/min/user |

输入：

```json
{
  "conversation_id": "conv_001",
  "model_id": "gpt-4.1",
  "space_ids": ["space_rd"],
  "message": "SSO 和权限校验是什么关系？",
  "retrieval_mode": "hybrid_text",
  "include_graph_explanation": true,
  "enable_database": false,
  "enable_deep_analysis": false,
  "stream": true,
  "options": {
    "temperature": 0.7,
    "max_tokens": 2048
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `conversation_id` | string | 否 | 会话 ID（新会话不传） |
| `model_id` | string | 是 | 模型 ID |
| `space_ids` | string[] | 是 | 检索范围（需有 `space:view` 权限） |
| `message` | string | 是 | 用户消息 |
| `retrieval_mode` | enum | 否 | `wiki_only` / `hybrid_text` / `graph_rag` / `path_first` / `community_first` / `debug`（默认 `hybrid_text`） |
| `include_graph_explanation` | boolean | 否 | 是否返回图谱推理过程（默认 false） |
| `enable_database` | boolean | 否 | 开启后允许 Agent 查询内网数据库（Phase 3+，默认 false） |
| `enable_deep_analysis` | boolean | 否 | 开启后强制走 Claude Code Agent 深度路径（Phase 3+，默认 false） |
| `stream` | boolean | 否 | 是否使用 SSE 流式（默认 true） |
| `options.temperature` | float | 否 | 温度（0-2，默认 0.7） |
| `options.max_tokens` | int | 否 | 最大输出 token（默认 2048） |

当 `enable_database` 或 `enable_deep_analysis` 为 `true` 时，Chat Engine 走 Claude Code Agent 深度路径而非静态 RAG。详见 [Doc 27](27_Agent架构与CLI工具设计.md)。

**SSE 事件协议：**

每个 SSE event 的 `data` 字段必须包含以下公共元数据：

```json
{
  "request_id": "req_001",
  "conversation_id": "conv_001",
  "message_id": "msg_001",
  "seq": 1,
  "timestamp": "2026-04-28T12:00:00.123Z",
  "...": "事件特有字段"
}
```

| 公共字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 本次请求唯一 ID |
| `conversation_id` | string | 会话 ID |
| `message_id` | string | 本次回复消息 ID（首个事件中分配） |
| `seq` | integer | 事件序列号（从 1 递增，用于断线重连恢复） |
| `timestamp` | string | ISO 8601 毫秒精度时间戳 |

断线重连：客户端通过 `Last-Event-ID: {message_id}:{seq}` header 重连，服务端从 seq+1 开始重放。

**SSE 事件类型：**

| 事件 | 阶段 | 说明 |
|---|---|---|
| `retrieval.started` | 检索 | 开始检索 |
| `retrieval.completed` | 检索 | 检索完成，返回命中摘要 |
| `retrieval.failed` | 检索 | 检索失败（降级为无 RAG 回复或终止） |
| `rerank.completed` | 检索 | 重排完成 |
| `message.delta` | 生成 | 增量文本 |
| `citation.added` | 生成 | 新增引用 |
| `graph_path.added` | 生成 | 新增图谱路径 |
| `message.completed` | 完成 | 生成完毕 |
| `message.error` | 错误 | 流式过程中发生不可恢复错误 |
| `chart.data` | 生成 | 图表数据（ECharts JSON，仅深度路径 `cherrydb chart` 输出） |
| `agent.tool_use` | 生成 | Agent 正在调用工具（仅深度路径，展示执行过程如"正在查询数据库..."） |
| `usage.reported` | 完成 | Token 用量和计费信息 |

**完整事件流示例（stream=true）：**

```text
event: retrieval.started
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":1,"timestamp":"2026-04-28T12:00:00.100Z","query_id":"rq_001","retrieval_mode":"graph_rag"}

event: retrieval.completed
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":2,"timestamp":"2026-04-28T12:00:00.350Z","query_id":"rq_001","chunks_retrieved":8,"paths_found":3}

event: rerank.completed
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":3,"timestamp":"2026-04-28T12:00:00.420Z","query_id":"rq_001","final_chunks":5,"rerank_model":"cross-encoder-v1"}

event: message.delta
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":4,"timestamp":"2026-04-28T12:00:00.500Z","text":"SSO（Single Sign-On）与权限校验"}

event: message.delta
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":5,"timestamp":"2026-04-28T12:00:00.550Z","text":"之间的关系是..."}

event: citation.added
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":6,"timestamp":"2026-04-28T12:00:00.600Z","citation_id":"cite_001","page_id":"rd.auth.sso","section_id":"sec_1","excerpt":"SSO 生成的 Token 被权限校验模块消费..."}

event: graph_path.added
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":7,"timestamp":"2026-04-28T12:00:00.650Z","path_id":"path_001","nodes":["SSO","Token","权限校验"],"relations":["generates","consumed_by"]}

event: message.completed
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":8,"timestamp":"2026-04-28T12:00:01.200Z","finish_reason":"stop"}

event: usage.reported
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":9,"timestamp":"2026-04-28T12:00:01.201Z","tokens_used":{"input":1200,"output":450,"retrieval":320},"latency_ms":{"retrieval":320,"rerank":70,"generation":780,"total":1101}}
```

**错误事件示例：**

```text
event: retrieval.failed
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":3,"timestamp":"2026-04-28T12:00:00.500Z","error_code":"RETRIEVAL_TIMEOUT","message":"Vector store query timeout after 5000ms","fallback":"no_rag"}

event: message.error
data: {"request_id":"req_001","conversation_id":"conv_001","message_id":"msg_001","seq":6,"timestamp":"2026-04-28T12:00:02.000Z","error_code":"MODEL_OVERLOADED","message":"Model service unavailable","retryable":true,"retry_after_ms":5000}
```

**事件字段参考：**

| 事件 | 特有字段 |
|---|---|
| `retrieval.started` | `query_id`, `retrieval_mode` |
| `retrieval.completed` | `query_id`, `chunks_retrieved`, `paths_found` |
| `retrieval.failed` | `error_code`, `message`, `fallback` (`no_rag` / `terminate`) |
| `rerank.completed` | `query_id`, `final_chunks`, `rerank_model` |
| `message.delta` | `text` |
| `citation.added` | `citation_id`, `page_id`, `section_id`, `excerpt` |
| `graph_path.added` | `path_id`, `nodes`, `relations` |
| `message.completed` | `finish_reason` (`stop` / `max_tokens` / `content_filter`) |
| `message.error` | `error_code`, `message`, `retryable`, `retry_after_ms` |
| `chart.data` | `chart_type` (`bar`/`line`/`pie`), `echarts_option` (完整 ECharts 配置 JSON) |
| `agent.tool_use` | `tool_name` (如 `cherrydb query`/`graphify query`), `tool_input` (工具参数摘要) |
| `usage.reported` | `tokens_used`, `latency_ms` |

**非流式响应（stream=false）：**

```json
{
  "data": {
    "message_id": "msg_001",
    "conversation_id": "conv_001",
    "content": "SSO（Single Sign-On）与权限校验...",
    "citations": [
      { "citation_id": "cite_001", "page_id": "rd.auth.sso", "excerpt": "..." }
    ],
    "graph_paths": [
      { "path_id": "path_001", "nodes": ["SSO", "Token", "权限校验"] }
    ],
    "tokens_used": { "input": 1200, "output": 450 }
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `MODEL_NOT_FOUND` | 模型不存在或未启用 |
| `MODEL_PERMISSION_DENIED` | 无权使用该模型 |
| `SPACE_NOT_FOUND` | Space 不存在 |
| `CONVERSATION_NOT_FOUND` | 会话不存在 |
| `MESSAGE_TOO_LONG` | 消息超过模型输入限制 |
| `RETRIEVAL_TIMEOUT` | 检索超时 |
| `MODEL_OVERLOADED` | 模型服务过载 |

---

## 11. Admin API

### GET `/api/admin/users`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:user_manage` |
| 审计动作 | 无 |
| 过滤 | `?role=editor&status=active&search=keyword` |
| 排序 | `?sort=-created_at` |

输出：

```json
{
  "data": [
    {
      "id": "usr_001",
      "email": "alice@example.com",
      "name": "Alice",
      "role": "editor",
      "status": "active",
      "groups": ["grp_rd"],
      "last_login_at": "2026-04-28T08:00:00Z",
      "created_at": "2026-01-01T00:00:00Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 50, "has_next": true } }
}
```

### POST `/api/admin/users`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:user_manage` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `admin.user.create` |

输入：

```json
{
  "email": "bob@example.com",
  "name": "Bob",
  "role": "editor",
  "groups": ["grp_rd"],
  "send_invite": true
}
```

输出：

```json
{
  "data": {
    "id": "usr_002",
    "email": "bob@example.com",
    "name": "Bob",
    "role": "editor",
    "status": "invited",
    "created_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `USER_EMAIL_CONFLICT` | 邮箱已存在 |
| `INVALID_ROLE` | 角色不合法 |
| `GROUP_NOT_FOUND` | 指定 Group 不存在 |

### GET `/api/admin/groups`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:user_manage` |
| 审计动作 | 无 |

输出：

```json
{
  "data": [
    {
      "id": "grp_rd",
      "name": "研发组",
      "member_count": 12,
      "spaces": [
        { "space_id": "space_rd", "role": "editor" }
      ],
      "created_at": "2026-01-01T00:00:00Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 5, "has_next": false } }
}
```

### POST `/api/admin/groups`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:user_manage` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `admin.group.create` |

输入：

```json
{
  "name": "产品组",
  "member_ids": ["usr_003", "usr_004"],
  "space_permissions": [
    { "space_id": "space_product", "role": "editor" }
  ]
}
```

输出：

```json
{
  "data": {
    "id": "grp_product",
    "name": "产品组",
    "member_count": 2,
    "created_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `GROUP_NAME_CONFLICT` | Group 名称已存在 |
| `USER_NOT_FOUND` | 指定成员不存在 |
| `SPACE_NOT_FOUND` | 指定 Space 不存在 |

### GET `/api/admin/models`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:model_manage` |
| 审计动作 | 无 |

输出：

```json
{
  "data": [
    {
      "id": "model_gpt41",
      "name": "GPT-4.1",
      "provider": "openai",
      "status": "active",
      "config": {
        "endpoint": "https://api.openai.com/v1",
        "max_tokens": 8192,
        "supports_streaming": true
      },
      "usage_stats": {
        "total_requests_30d": 1200,
        "avg_latency_ms": 850
      }
    }
  ]
}
```

### POST `/api/admin/models`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:model_manage` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `admin.model.create` |

输入：

```json
{
  "name": "Claude Sonnet 4",
  "provider": "anthropic",
  "config": {
    "endpoint": "https://api.anthropic.com/v1",
    "api_key_ref": "secret:anthropic_key",
    "max_tokens": 8192,
    "supports_streaming": true
  },
  "allowed_roles": ["editor", "admin"]
}
```

输出：

```json
{
  "data": {
    "id": "model_claude_sonnet4",
    "name": "Claude Sonnet 4",
    "provider": "anthropic",
    "status": "active",
    "created_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `MODEL_NAME_CONFLICT` | 模型名称已存在 |
| `INVALID_PROVIDER` | 不支持的 provider |
| `SECRET_NOT_FOUND` | api_key_ref 引用的密钥不存在 |

### GET `/api/admin/audit-logs`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:audit_view` |
| 审计动作 | 无 |
| 过滤 | `?actor_id=usr_001&action=graphify.run.create&space_id=space_rd&from=2026-04-01&to=2026-04-28` |
| 排序 | `?sort=-timestamp` |

输出：

```json
{
  "data": [
    {
      "audit_id": "audit_001",
      "action": "graphify.run.create",
      "actor_id": "usr_001",
      "actor_name": "Alice",
      "space_id": "space_rd",
      "resource_type": "graphify_run",
      "resource_id": "run_100",
      "details": { "mode": "update", "trigger_type": "manual" },
      "ip": "192.168.1.100",
      "timestamp": "2026-04-28T12:00:00Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 50, "total": 1200, "has_next": true } }
}
```

### GET `/api/admin/jobs`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:audit_view` |
| 审计动作 | 无 |
| 过滤 | `?type=ingestion&status=running&space_id=space_rd` |
| 排序 | `?sort=-created_at` |

输出：

```json
{
  "data": [
    {
      "job_id": "job_001",
      "type": "ingestion",
      "status": "running",
      "space_id": "space_rd",
      "progress": { "percent": 65, "stage": "chunking" },
      "created_at": "2026-04-28T12:01:00Z",
      "started_at": "2026-04-28T12:01:05Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "per_page": 20, "total": 8, "has_next": false } }
}
```

### GET `/api/admin/system/health`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:audit_view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "status": "healthy",
    "version": "0.2.0",
    "uptime_seconds": 86400,
    "components": {
      "database": { "status": "healthy", "latency_ms": 2 },
      "redis": { "status": "healthy", "latency_ms": 1 },
      "vector_store": { "status": "healthy", "latency_ms": 5 },
      "graph_store": { "status": "healthy", "latency_ms": 3 },
      "docmost_bridge": { "status": "healthy", "latency_ms": 12 },
      "object_storage": { "status": "healthy", "latency_ms": 8 }
    },
    "queues": {
      "ingestion": { "pending": 2, "processing": 1 },
      "graphify": { "pending": 0, "processing": 0 },
      "wiki_sync": { "pending": 0, "processing": 0 }
    }
  }
}
```

### GET `/api/admin/graphify/runs`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:audit_view` |
| 审计动作 | 无 |
| 过滤 | `?space_id=space_rd&status=failed` |

输出：同 §7 GET `/api/graphify/runs`，但不受 Space 权限过滤，返回全局数据。

### POST `/api/admin/graphify/runs/{run_id}/retry`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:model_manage` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `admin.graphify.retry` |

输入/输出/错误码：同 §7 POST retry。

### GET `/api/admin/consistency-checks`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:audit_view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": [
    {
      "check_id": "chk_001",
      "space_id": "space_rd",
      "status": "passed",
      "checked_at": "2026-04-28T06:00:00Z",
      "issues_found": 0
    }
  ]
}
```

### POST `/api/admin/spaces/{space_id}/rebuild-index`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:model_manage` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `admin.index.rebuild` |

输入：

```json
{
  "scope": "full",
  "reason": "schema migration"
}
```

输出：

```json
{
  "data": {
    "job_id": "job_rebuild_001",
    "space_id": "space_rd",
    "scope": "full",
    "status": "queued",
    "estimated_duration_minutes": 15
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `SPACE_NOT_FOUND` | Space 不存在 |
| `REBUILD_ALREADY_RUNNING` | 已有重建任务运行中 |

### GET `/api/admin/retrieval-traces/{trace_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:audit_view` |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "trace_id": "trace_001",
    "query": "SSO 和权限校验是什么关系？",
    "retrieval_mode": "graph_rag",
    "stages": [
      {
        "stage": "query_expansion",
        "duration_ms": 50,
        "output": { "expanded_queries": ["SSO authentication", "permission check"] }
      },
      {
        "stage": "vector_search",
        "duration_ms": 120,
        "output": { "chunks_retrieved": 8, "top_score": 0.94 }
      },
      {
        "stage": "graph_traversal",
        "duration_ms": 80,
        "output": { "paths_found": 3, "nodes_visited": 12 }
      },
      {
        "stage": "reranking",
        "duration_ms": 60,
        "output": { "final_chunks": 5 }
      }
    ],
    "total_duration_ms": 310,
    "created_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `TRACE_NOT_FOUND` | Trace 不存在 |

---

## 12. Webhook / Bridge API

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

## 13. Docmost Bridge 内部 API 详细定义

> 本节合并 TODO T-2.1.2 / T-7.2。  
> `/api/internal/docmost/*` = Cherry API 暴露，接收 Docmost 事件。  
> `/api/internal/bridge/*` = Docmost Fork 暴露，供 Cherry API / wiki-sync-worker 调用。  
> 所有接口不对普通用户开放。

### 13.1 认证

所有 Bridge 请求必须包含以下 header：

```http
Authorization: Bearer ${DOCMOST_BRIDGE_SECRET}
X-Bridge-Signature: hmac-sha256(payload + timestamp + nonce, DOCMOST_BRIDGE_SECRET)
X-Bridge-Event-Id: evt_...
X-Bridge-Timestamp: 2026-04-28T10:00:00Z
X-Bridge-Nonce: random-string
```

| Header | 用途 |
|---|---|
| `Authorization` | Bearer token 身份认证 |
| `X-Bridge-Signature` | HMAC-SHA256 签名校验请求完整性 |
| `X-Bridge-Event-Id` | 幂等键，服务端按此去重 |
| `X-Bridge-Timestamp` | 防重放：拒绝超过 5 分钟的请求 |
| `X-Bridge-Nonce` | 防重放：与 timestamp 配合确保唯一性 |

服务端校验流程：验证 Bearer token → 验证 timestamp 在窗口内 → 验证 HMAC 签名 → 按 `event_id` 幂等处理。重复事件返回 `200 OK`，标记 `deduplicated=true`。

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

---

## 14. 补充端点

### 14.1 Auth 补充

#### POST `/api/auth/password/change`

| 项目 | 说明 |
|---|---|
| 权限点 | 已认证即可 |
| 审计动作 | `auth.password_change` |

输入：

```json
{
  "current_password": "...",
  "new_password": "..."
}
```

输出：`{ "data": { "success": true } }`

错误码：

| Code | 说明 |
|---|---|
| `INVALID_CURRENT_PASSWORD` | 当前密码错误 |
| `PASSWORD_TOO_WEAK` | 新密码不符合强度要求 |

#### GET `/api/auth/sessions`

| 项目 | 说明 |
|---|---|
| 权限点 | 已认证即可 |
| 审计动作 | 无 |

输出：

```json
{
  "data": [
    {
      "id": "sess_001",
      "ip": "192.168.1.100",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2026-04-28T08:00:00Z",
      "last_used_at": "2026-04-28T12:00:00Z",
      "is_current": true
    }
  ]
}
```

#### DELETE `/api/auth/sessions/{session_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | 已认证即可（只能删自己的会话） |
| 审计动作 | `auth.session_revoke` |

输出：`{ "data": { "revoked": true } }`

错误码：`SESSION_NOT_FOUND`

### 14.2 Jobs API（用户级）

#### GET `/api/jobs/{job_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | 对 job 所属 Space 有 `space:view` 权限，或为 job 创建者 |
| 审计动作 | 无 |

输出：

```json
{
  "data": {
    "job_id": "job_001",
    "type": "ingestion",
    "space_id": "space_rd",
    "status": "running",
    "progress": { "percent": 65, "stage": "chunking" },
    "created_at": "2026-04-28T12:01:00Z",
    "started_at": "2026-04-28T12:01:05Z"
  }
}
```

错误码：`JOB_NOT_FOUND`

#### GET `/api/jobs/{job_id}/events`

| 项目 | 说明 |
|---|---|
| 权限点 | 同 GET job |
| 审计动作 | 无 |

输出：

```json
{
  "data": [
    { "event": "started", "timestamp": "2026-04-28T12:01:05Z", "detail": {} },
    { "event": "stage_changed", "timestamp": "2026-04-28T12:01:10Z", "detail": { "stage": "chunking" } },
    { "event": "progress", "timestamp": "2026-04-28T12:02:00Z", "detail": { "percent": 65 } }
  ]
}
```

#### POST `/api/jobs/{job_id}/cancel`

| 项目 | 说明 |
|---|---|
| 权限点 | job 创建者 或 `space:admin` |
| 幂等策略 | 重复取消返回当前状态 |
| 审计动作 | `job.cancel` |

输出：`{ "data": { "job_id": "job_001", "status": "cancelled" } }`

错误码：

| Code | 说明 |
|---|---|
| `JOB_NOT_FOUND` | Job 不存在 |
| `JOB_NOT_CANCELLABLE` | 已完成/已取消的 job 不可取消 |

### 14.3 Wiki 补充

#### GET `/api/spaces/{space_id}/wiki/pages/{page_id}/content`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:view` |
| 审计动作 | 无 |
| 参数 | `?version_id=ver_003`（可选，默认当前版本） |

输出：

```json
{
  "data": {
    "page_id": "rd.auth.sso",
    "version_id": "ver_003",
    "title": "SSO 认证流程",
    "content_markdown": "# SSO 认证流程\n...",
    "content_hash": "sha256:def...",
    "blocks": [
      { "block_id": "summary", "owner": "graphify", "editable": false },
      { "block_id": "implementation-notes", "owner": "human", "editable": true }
    ]
  }
}
```

错误码：`WIKI_PAGE_NOT_FOUND` / `VERSION_NOT_FOUND`

#### POST `/api/spaces/{space_id}/wiki/pages/{page_id}/proposals/{proposal_id}/accept`

| 项目 | 说明 |
|---|---|
| 权限点 | `wiki:publish` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `wiki.proposal.accept` |

输入：

```json
{
  "merge_strategy": "auto",
  "publish_note": "审核通过，自动合并"
}
```

输出：

```json
{
  "data": {
    "proposal_id": "prop_001",
    "status": "accepted",
    "new_version_id": "ver_004",
    "merged_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：

| Code | 说明 |
|---|---|
| `PROPOSAL_NOT_FOUND` | 提案不存在 |
| `PROPOSAL_ALREADY_RESOLVED` | 提案已接受或拒绝 |
| `MERGE_CONFLICT` | 自动合并冲突，需手动处理 |

#### POST `/api/spaces/{space_id}/wiki/pages/{page_id}/proposals/{proposal_id}/reject`

| 项目 | 说明 |
|---|---|
| 权限点 | `wiki:publish` |
| 审计动作 | `wiki.proposal.reject` |

输入：

```json
{
  "reason": "内容不准确，需要修正"
}
```

输出：

```json
{
  "data": {
    "proposal_id": "prop_001",
    "status": "rejected",
    "rejected_at": "2026-04-28T12:00:00Z"
  }
}
```

### 14.4 Admin Models 补充

#### PATCH `/api/admin/models/{model_id}`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:model_manage` |
| 审计动作 | `admin.model.update` |

输入：

```json
{
  "status": "disabled",
  "config": { "max_tokens": 16384 },
  "allowed_roles": ["admin"]
}
```

输出：更新后完整 ModelConfig 对象。

错误码：`MODEL_NOT_FOUND`

#### POST `/api/admin/models/{model_id}/test`

| 项目 | 说明 |
|---|---|
| 权限点 | `admin:model_manage` |
| 审计动作 | `admin.model.test` |
| 说明 | 发送测试请求到模型 endpoint，验证连通性和 API key |

输入：`{ "test_prompt": "Hello" }`

输出：

```json
{
  "data": {
    "model_id": "model_gpt41",
    "reachable": true,
    "latency_ms": 420,
    "response_preview": "Hello! How can I...",
    "error": null
  }
}
```

错误码：`MODEL_NOT_FOUND` / `MODEL_UNREACHABLE` / `MODEL_AUTH_FAILED`

### 14.5 Consistency 补充

#### POST `/api/spaces/{space_id}/consistency/check`

| 项目 | 说明 |
|---|---|
| 权限点 | `space:admin` |
| 幂等策略 | `X-Idempotency-Key` |
| 审计动作 | `space.consistency_check` |

输出：

```json
{
  "data": {
    "check_id": "chk_002",
    "space_id": "space_rd",
    "status": "running",
    "started_at": "2026-04-28T12:00:00Z"
  }
}
```

错误码：`CHECK_ALREADY_RUNNING`

---

## 15. 权限点映射汇总

| Endpoint | Method | 权限点 |
|---|---|---|
| `/api/auth/login` | POST | 无（公开） |
| `/api/auth/logout` | POST | 已认证 |
| `/api/auth/me` | GET | 已认证 |
| `/api/auth/refresh` | POST | 无（用 `refresh_token` HttpOnly Cookie） |
| `/api/auth/password/change` | POST | 已认证 |
| `/api/auth/sessions` | GET | 已认证 |
| `/api/auth/sessions/{id}` | DELETE | 已认证（仅自己） |
| `/api/spaces` | GET | `space:view`（过滤） |
| `/api/spaces` | POST | `space:admin` 或 Admin |
| `/api/spaces/{id}` | GET | `space:view` |
| `/api/spaces/{id}` | PATCH | `space:admin` |
| `/api/spaces/{id}/stats` | GET | `space:view` |
| `/api/spaces/{id}/uploads` | POST | `upload:create` |
| `/api/uploads/{id}` | GET | `upload:read` |
| `/api/uploads/{id}/status` | GET | `upload:read` |
| `/api/uploads/{id}/reprocess` | POST | `upload:create` |
| `/api/spaces/{id}/graphify/runs` | POST | `graphify:run` |
| `/api/graphify/runs` | GET | `graphify:view` |
| `/api/graphify/runs/{id}` | GET | `graphify:view` |
| `/api/graphify/runs/{id}/cancel` | POST | `graphify:run` |
| `/api/graphify/runs/{id}/retry` | POST | `graphify:run` |
| `/api/graphify/runs/{id}/report` | GET | `graphify:view` |
| `/api/graphify/runs/{id}/graph` | GET | `graphify:view` |
| `/api/spaces/{id}/wiki/pages` | GET | `space:view` |
| `/api/spaces/{id}/wiki/pages/{pid}` | GET | `space:view` |
| `/api/spaces/{id}/wiki/pages/{pid}/content` | GET | `space:view` |
| `/api/spaces/{id}/wiki/pages/{pid}/versions` | GET | `space:view` |
| `/api/spaces/{id}/wiki/pages/{pid}/publish` | POST | `wiki:publish` |
| `/api/spaces/{id}/wiki/pages/{pid}/rollback` | POST | `wiki:rollback` |
| `/api/spaces/{id}/wiki/pages/{pid}/citations` | GET | `space:view` |
| `/api/spaces/{id}/wiki/pages/{pid}/graph` | GET | `space:view` |
| `/api/spaces/{id}/wiki/pages/{pid}/reindex` | POST | `space:admin` |
| `/api/spaces/{id}/wiki/pages/{pid}/proposals/{ppid}/accept` | POST | `wiki:publish` |
| `/api/spaces/{id}/wiki/pages/{pid}/proposals/{ppid}/reject` | POST | `wiki:publish` |
| `/api/spaces/{id}/wiki/consistency` | GET | `space:admin` |
| `/api/spaces/{id}/consistency/check` | POST | `space:admin` |
| `/api/graph/nodes` | GET | `space:view`（ACL 过滤） |
| `/api/graph/nodes/{id}` | GET | `space:view` |
| `/api/graph/nodes/{id}/neighbors` | GET | `space:view` |
| `/api/graph/path` | POST | `space:view` |
| `/api/graph/query` | POST | `space:view` |
| `/api/graph/communities` | GET | `space:view` |
| `/api/chat/completions` | POST | `chat:use` + `model:use` + `space:view` |
| `/api/jobs/{id}` | GET | `space:view` 或 job 创建者 |
| `/api/jobs/{id}/events` | GET | 同上 |
| `/api/jobs/{id}/cancel` | POST | job 创建者 或 `space:admin` |
| `/api/admin/users` | GET/POST | `admin:user_manage` |
| `/api/admin/groups` | GET/POST | `admin:user_manage` |
| `/api/admin/models` | GET/POST | `admin:model_manage` |
| `/api/admin/models/{id}` | PATCH | `admin:model_manage` |
| `/api/admin/models/{id}/test` | POST | `admin:model_manage` |
| `/api/admin/audit-logs` | GET | `admin:audit_view` |
| `/api/admin/jobs` | GET | `admin:audit_view` |
| `/api/admin/system/health` | GET | `admin:audit_view` |
| `/api/admin/graphify/runs` | GET | `admin:audit_view` |
| `/api/admin/graphify/runs/{id}/retry` | POST | `admin:model_manage` |
| `/api/admin/consistency-checks` | GET | `admin:audit_view` |
| `/api/admin/spaces/{id}/rebuild-index` | POST | `admin:model_manage` |
| `/api/admin/retrieval-traces/{id}` | GET | `admin:audit_view` |

---

## 16. OpenAPI 草案

详见 [`../schemas/openapi.yaml`](../schemas/openapi.yaml)。
