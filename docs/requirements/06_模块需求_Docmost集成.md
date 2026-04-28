# 06. 模块需求：Docmost 集成

## 1. 模块定位

Docmost 被选为 Wiki 网页和多人协作编辑工具。它在本项目中的角色是 `Docmost Shell`：

```text
Docmost Fork = Graphify Wiki 的浏览/编辑/协作/权限 UI
Graphify Wiki = 唯一知识源
Cherry Web = 聊天、GraphRAG、管理和任务编排入口
```

Docmost 的页面内容必须与 Canonical Wiki Repo 同步。任何脱离 Canonical Wiki Repo 的 Docmost 页面，都不能进入 Chat 检索。

## 2. 已确认集成路线

本项目不购买 Docmost Enterprise，不使用 Enterprise API/MCP 路线。采用：

```text
Fork docmost/docmost 开源版
  → 放入 external/docmost/
  → Docmost Fork 新增 /api/internal/bridge/* 路由组（导出/导入/同步状态）
  → 新增 page save 后 webhook → 通知 Cherry API /api/internal/docmost/*
  → Cherry API 接收事件后驱动 wiki-sync-worker
```

### 2.1 Fork 修改范围

| 范围 | 是否允许修改 | 说明 |
|---|---:|---|
| `/api/internal/bridge/**` | 是 | Docmost Fork 暴露的导出/导入/同步状态接口。 |
| page save lifecycle hook | 是 | 页面保存后 POST Cherry API `/api/internal/docmost/events/page-saved`。 |
| attachment event hook | 是 | 附件上传、删除、替换时发事件。 |
| Docmost 核心编辑器 | 否 | 不修改，以降低 upstream rebase 成本。 |
| Docmost 权限模型 | 否 | 只做映射和校验，不重写权限核心。 |
| Docmost 存储层 | 否 | 不改 DB schema，除非 Bridge 状态必须落库且经 ADR 批准。 |
| Docmost UI 大改 | 否 | 页面增强优先通过旁路面板或 Cherry Web 侧展示。 |

### 2.2 upstream 合并策略

1. `external/docmost` 保持独立 Fork 分支：`cherrygraph-bridge`。
2. 每月或每个 Phase 结束后 rebase upstream 主分支。
3. 冲突解决原则：优先保留 upstream，Bridge 路由层适配，不改核心代码。
4. 每次 rebase 后必须执行：页面保存、附件上传、Space 权限、Bridge webhook、双向同步回归测试。
5. Fork 改动清单见 [`22_Docmost_Fork_改动清单.md`](22_Docmost_Fork_改动清单.md)。

## 3. 集成目标

1. Graphify 生成的 Wiki 页面可以进入 Docmost Space。
2. 用户可在 Docmost 中修改页面。
3. 修改后内容同步回 Canonical Wiki Repo。
4. Docmost Space 权限与 Cherry Group 权限一致。
5. 上传资料可以在 Docmost 页面中作为附件/证据展示，但不直接作为问答源。
6. Docmost 页面可展示 Graphify 状态、索引状态和相关图谱。
7. Docmost Bridge 事件必须可追踪、可重试、可幂等。

## 4. Phase 边界

| Phase | Docmost 状态 |
|---|---|
| Phase 1 | 不接入 Docmost；Cherry Web 内置只读 Wiki。 |
| Phase 2 | 接入 Docmost Fork，支持 Graphify → Docmost 导入、Docmost → Canonical Wiki Repo 回写。 |
| Phase 3 | Docmost 页面可展示图节点、路径、置信度和引用关系。 |
| Phase 4 | 支持低置信关系审核、重复页面合并建议、知识治理面板。 |

## 5. Space 映射

| Cherry 概念 | Docmost 概念 | 说明 |
|---|---|---|
| Workspace/Tenant | Workspace | 一个企业或组织，当前默认单 tenant。 |
| Knowledge Space | Space | 一个知识权限域。 |
| Group | Group | 同步或映射成员权限。 |
| Wiki Page | Page | Graphify Wiki 页面。 |
| Attachment | Attachment | 上传证据和页面相关附件。 |

每个 Cherry Space 绑定一个 Docmost Space：

```json
{
  "space_id": "space_rd_platform",
  "docmost_space_id": "dm_space_abc",
  "wiki_repo_path": "spaces/rd-platform",
  "sync_mode": "two_way",
  "publish_policy": "editor_publish",
  "bridge_status": "healthy"
}
```

## 6. 同步模式

### 6.1 Graphify → Docmost

```text
Graphify wiki output
  → normalize markdown
  → merge with Canonical Wiki Repo
  → create/update Docmost page
  → attach source references
  → mark sync status
```

要求：

- 保留页面层级。
- 保留 Frontmatter 元数据，可在 Docmost 中隐藏或以元信息块展示。
- 保留段落锚点，用于 Chat 引用跳转。
- 保留 Graphify managed / human curated 区块标记。
- 页面导入失败时不影响已发布版本。

### 6.2 Docmost → Graphify Wiki

```text
Docmost page saved
  → Docmost POST Cherry API /api/internal/docmost/events/page-saved
  → Cherry API 通过 /api/internal/bridge/pages/{id}/export 拉取页面正文
  → convert to canonical markdown
  → validate frontmatter
  → optimistic lock check
  → commit to Canonical Wiki Repo
  → create graphify update job
  → reindex page/chunks/nodes/edges
```

要求：

- 每次保存生成 `page_version`。
- 同步失败时页面标记为 `sync_pending`。
- 冲突时标记为 `conflict_required`。
- 不得跳过权限检查。
- webhook 事件允许至少一次投递，Bridge 必须按 `event_id` 幂等。

## 7. Bridge 路由命名规范

两个命名空间，职责分离：

**Cherry API 接收 Docmost 事件**（Docmost → Cherry API）：

```text
POST /api/internal/docmost/events/page-saved
POST /api/internal/docmost/events/page-deleted
POST /api/internal/docmost/events/attachment-created
```

Docmost Fork 在 page/attachment lifecycle hook 中主动 POST 到 Cherry API。Cherry API 收到后驱动 wiki-sync-worker。

**Docmost Fork 暴露 Bridge 能力**（Cherry API → Docmost）：

```text
GET  /api/internal/bridge/pages/{docmost_page_id}/export?format=markdown
PUT  /api/internal/bridge/pages/{docmost_page_id}/import
GET  /api/internal/bridge/attachments/{attachment_id}/download
GET  /api/internal/bridge/spaces/{docmost_space_id}/sync-status
GET  /api/internal/bridge/health
```

Cherry API / wiki-sync-worker 调用 Docmost Fork 的这些接口完成页面拉取、导入和状态查询。

**鉴权**：所有接口使用 `DOCMOST_BRIDGE_SECRET` 做 HMAC-SHA256 签名校验，仅允许内网服务调用。

## 8. 页面增强需求

Docmost 页面增强优先在 Cherry Web 侧实现旁路面板；确需嵌入 Docmost 时通过最小 Fork 或反向代理注入实现。

1. Graphify 状态面板。
2. 页面索引状态。
3. 来源文件列表。
4. 相关图谱节点。
5. 相关 Wiki 页面。
6. 候选更新提醒。
7. 低置信关系审核入口。
8. 一键触发本页面重新索引。

## 9. 权限同步

### 9.1 权限级别

| Cherry 权限 | Docmost 权限 | 说明 |
|---|---|---|
| `space:view` | Can View | 可浏览页面和被 Chat 检索引用。 |
| `space:edit` | Can Edit | 可编辑页面。 |
| `space:admin` | Full Access | 可管理 Space。 |
| `upload:create` | 附件/上传权限 | 可上传资料。 |
| `graphify:run` | 无直接对应 | Cherry 管理后台控制。 |

### 9.2 权限一致性检查

每日、每次权限变更后、每次 Docmost rebase 后执行：

```text
Cherry group membership
  ↔ Docmost group membership
  ↔ Docmost space members
  ↔ index ACL envelope
```

如果不一致：

- 暂停相关 Space 的 Chat 检索。
- 管理后台显示告警。
- 触发权限修复任务。
- 审计记录 `permission_consistency_failed`。

## 10. 附件处理

Docmost 支持附件，但在本项目中附件必须纳入 Source Archive：

1. 用户在 Docmost 上传附件。
2. Bridge 捕获附件事件。
3. 附件写入 Source Archive。
4. 创建解析任务。
5. Graphify 更新页面和图谱。
6. 附件作为页面证据展示。

## 11. Phase 2 验收

1. Cherry 管理后台创建 Space 时能创建或绑定 Docmost Space。
2. Graphify 生成的 Markdown 页面能导入 Docmost。
3. 用户在 Docmost 修改页面后，Canonical Wiki Repo 有对应版本更新。
4. 修改页面后 Graphify 和索引任务自动触发。
5. Chat 引用能跳转到 Docmost 页面。
6. 无权限用户不能打开 Docmost 页面，也不能通过 Chat 看到其内容。
7. Bridge webhook 支持重试和幂等。
8. Docmost upstream rebase 后通过回归测试。

## 12. 关键风险

| 风险 | 缓解 |
|---|---|
| Docmost Fork 维护成本 | 最小改动原则，Bridge 层隔离，固定 rebase 节奏。 |
| 富文本转 Markdown 丢失格式 | 定义受支持格式白名单，复杂块转附件或 HTML 块。 |
| 权限不同步 | 增加权限一致性任务和检索熔断。 |
| 人工编辑破坏 Frontmatter | Bridge 导出时自动修复并提示。 |
| webhook 事件重复或丢失 | 事件幂等键、重试、死信队列、定时 reconcile。 |
