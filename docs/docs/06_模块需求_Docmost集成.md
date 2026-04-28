# 06. 模块需求：Docmost 集成

## 1. 模块定位

Docmost 被选为 Wiki 网页和多人协作编辑工具。它在本项目中的角色是 `Docmost Shell`：

```text
Docmost = Graphify Wiki 的浏览/编辑/协作/权限 UI
Graphify Wiki = 唯一知识源
Cherry Web = 聊天、GraphRAG、管理和任务编排入口
```

Docmost 的页面内容必须与 Canonical Wiki Repo 同步。任何脱离 Canonical Wiki Repo 的 Docmost 页面，都不能进入 Chat 检索。

## 2. 外部能力依据

Docmost 支持实时协作、Spaces、权限管理、Groups、评论、页面历史、搜索、文件附件等能力。官方安装文档推荐 Docker 部署，并依赖 PostgreSQL 和 Redis。Docmost 官方文档还说明 API 和 MCP 是 Enterprise 功能，需要有效企业授权。因此本项目集成时必须选择以下路线之一：

1. **Docmost Enterprise 路线**：使用官方 REST API/MCP 做同步。
2. **Docmost Fork 路线**：Fork Docmost core，在服务端增加内部同步 API、webhook 和导入导出能力。
3. **导入导出降级路线**：利用 Docmost Markdown/HTML/ZIP 导入导出能力做批处理同步，适合 MVP 验证，不适合长期生产。

推荐路线：**MVP 可用导入导出 + 后台轮询，生产采用 Enterprise API 或 Fork 增强。**

## 3. 集成目标

1. Graphify 生成的 Wiki 页面可以进入 Docmost Space。
2. 用户可在 Docmost 中修改页面。
3. 修改后内容同步回 Canonical Wiki Repo。
4. Docmost Space 权限与 Cherry Group 权限一致。
5. 上传资料可以在 Docmost 页面中作为附件/证据展示，但不直接作为问答源。
6. Docmost 页面可展示 Graphify 状态、索引状态和相关图谱。

## 4. Space 映射

| Cherry 概念 | Docmost 概念 | 说明 |
|---|---|---|
| Workspace/Tenant | Workspace | 一个企业或组织。 |
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
  "publish_policy": "editor_publish"
}
```

## 5. 同步模式

### 5.1 Graphify → Docmost

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
- 保留 Graphify managed/human curated 区块标记。
- 页面导入失败时不影响已发布版本。

### 5.2 Docmost → Graphify Wiki

```text
Docmost page saved
  → export or API read
  → convert to canonical markdown
  → validate frontmatter
  → commit to Canonical Wiki Repo
  → create graphify update job
  → reindex page/chunks/nodes/edges
```

要求：

- 每次保存生成 page_version。
- 同步失败时页面标记为 `sync_pending`。
- 冲突时标记为 `conflict_required`。
- 不得跳过权限检查。

## 6. Docmost Bridge

### 6.1 职责

`docmost-bridge` 是 Cherry 平台和 Docmost 的适配层。

职责：

1. 管理 Docmost Space 创建与绑定。
2. 同步 Groups 和成员。
3. 导入 Graphify Wiki 页面。
4. 导出 Docmost 页面到 Markdown。
5. 监听或轮询页面变更。
6. 处理附件映射。
7. 提供同步状态 API。

### 6.2 不允许行为

1. 不允许 Chat API 直接访问 Docmost 数据库。
2. 不允许 Docmost 页面绕过 Canonical Wiki Repo 直接进入索引。
3. 不允许把 Docmost 附件直接作为 Chat 检索上下文。
4. 不允许权限不同步时发布页面。

## 7. 页面增强需求

Docmost 原生页面需要在 Cherry Web 中补充以下增强能力，可以通过浏览器扩展式嵌入、反向代理注入、Docmost Fork 或旁路面板实现：

1. Graphify 状态面板。
2. 页面索引状态。
3. 来源文件列表。
4. 相关图谱节点。
5. 相关 Wiki 页面。
6. 候选更新提醒。
7. 低置信关系审核入口。
8. 一键触发本页面重新索引。

## 8. 权限同步

### 8.1 权限级别

| Cherry 权限 | Docmost 权限 | 说明 |
|---|---|---|
| `space:view` | Can View | 可浏览页面和被 Chat 检索引用。 |
| `space:edit` | Can Edit | 可编辑页面。 |
| `space:admin` | Full Access | 可管理 Space。 |
| `upload:create` | 附件/上传权限 | 可上传资料。 |
| `graphify:run` | 无直接对应 | Cherry 管理后台控制。 |

### 8.2 权限一致性检查

每日或每次权限变更后执行：

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

## 9. 附件处理

Docmost 支持附件，但在本项目中附件必须纳入 Source Archive：

1. 用户在 Docmost 上传附件。
2. Bridge 捕获附件或定时同步附件。
3. 附件写入 Source Archive。
4. 创建解析任务。
5. Graphify 更新页面和图谱。
6. 附件作为页面证据展示。

## 10. MVP 验收

1. Cherry 管理后台创建 Space 时能创建或绑定 Docmost Space。
2. Graphify 生成的 Markdown 页面能导入 Docmost。
3. 用户在 Docmost 修改页面后，Canonical Wiki Repo 有对应版本更新。
4. 修改页面后 Graphify 和索引任务自动触发。
5. Chat 引用能跳转到 Docmost 页面。
6. 无权限用户不能打开 Docmost 页面，也不能通过 Chat 看到其内容。

## 11. 关键风险

| 风险 | 缓解 |
|---|---|
| Docmost API/MCP 是企业功能 | 采购企业授权或 Fork 实现内部同步接口。 |
| 导入导出批处理延迟高 | MVP 可接受，生产用 API/webhook。 |
| 富文本转 Markdown 丢失格式 | 定义受支持格式白名单，复杂块转附件或 HTML 块。 |
| 权限不同步 | 增加权限一致性任务和检索熔断。 |
| 人工编辑破坏 Frontmatter | Bridge 导出时自动修复并提示。 |
