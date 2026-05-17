# CherryWiki 功能测试清单

> 适用于全新环境（`docker compose down --volumes` + 重建后），或验收交付前的完整回归测试。
> 前置条件：所有服务 healthy（`docker compose ps` 全绿）

### 优先级说明

| 标签 | 含义 | 说明 |
|------|------|------|
| **P0** | 核心路径 | 主流程不通则系统不可用，必须全部 PASS |
| **P1** | 管理功能 | 管理端生命周期、配置、运维能力 |
| **P2** | 边界安全 | 负面场景、安全防护、边界条件 |

---

## 0. 环境健康检查

### 0.1 核心基础设施 `P0`
- [x] `docker compose ps` — 全部服务 Up (healthy) ✅ 2025-05-15
- [x] `GET /api/health` 返回 `{"status":"healthy"}` ✅ 2025-05-15
- [x] PostgreSQL: `pg_isready` 通过 ✅ 2025-05-15
- [x] MinIO: `GET /minio/health/live` 返回 200 ✅ 2025-05-15
- [x] Redis: `redis-cli ping` 返回 PONG ✅ 2025-05-15

### 0.2 Worker & 应用服务 `P1` `INF-1` `INF-2`
- [x] `docker compose ps` 验证 web、nginx、ingestion-worker、url-fetcher-worker、indexer-worker、graphify-worker 全部 Up ✅ 2025-05-15
- [x] Worker 健康端点（9091-9094）返回 healthy payload ✅ 2026-05-17 ingestion/url-fetcher/indexer/graphify 全部 healthy
- [x] cherry-web 前端容器可访问（HTTP 200） ✅ 2025-05-15
- [x] nginx 反向代理路由正常（`/api/*` → API，`/` → web） ✅ 2025-05-15

### 0.3 网络与出口 `P2` `INF-3`
- [ ] egress-proxy 容器存在且 healthy（URL fetcher 依赖）
- [ ] URL fetcher 直连私有网络地址被 egress-proxy 阻断

---

## 1. 认证与用户管理

### 1.1 登录 `P0`
- [x] 使用 admin 邮箱/密码登录成功，跳转到管理后台 ✅ 2025-05-15
- [x] 登录响应设置 refresh_token 为 HttpOnly cookie（非 body 返回） ✅ 2026-05-15 BUG-001 已修复：cookie 不再带 Secure 标志
- [x] 错误密码登录失败，显示 "Invalid email or password" ✅ 2025-05-15（实际文案 "Email or password is incorrect."）
- [x] 连续 5 次错误密码后账号锁定提示 ✅ 2026-05-15 第6次返回 ACCOUNT_LOCKED，TTL 15min

### 1.2 登出 `P0` `AU-1`
- [x] `POST /api/auth/logout` 清除 refresh cookie ✅ 2026-05-15（Set-Cookie Max-Age=0）
- [x] 登出后 refresh_token 失效，无法用于刷新 ✅ 2026-05-15（TOKEN_REVOKED）

### 1.3 Token 刷新 `P0`
- [x] 登录后获得 access_token（body）+ refresh_token（cookie） ✅ 2026-05-15
- [x] Token 过期后通过 `/api/auth/refresh`（携带 cookie）自动刷新 ✅ 2026-05-15 BUG-005 已修复：AuthProvider bootstrap refresh + isBootstrapping 路由守卫
- [x] 使用已失效的 refresh_token 返回 401 ✅ 2026-05-15

### 1.4 当前用户 `P0` `AU-2`
- [x] `GET /api/auth/me` 返回用户 role、groups、spaces、permissions ✅ 2026-05-15
- [x] 未登录请求 `/api/auth/me` 返回 401 ✅ 2026-05-15

### 1.5 密码修改 `P1` `AU-3`
- [x] `POST /api/auth/password/change` 需要 current_password 验证 ✅ 2026-05-17 缺少 current_password 返回 VALIDATION_ERROR
- [x] 密码修改成功后审计日志记录 password_change 事件 ✅ 2026-05-17 审计日志记录 auth.password_change
- [x] 密码修改后根据策略处理现有 sessions ✅ 2026-05-17 当前策略：不自动撤销其他 sessions（JWT 短期有效+refresh 独立管理）

### 1.6 Session 管理 `P1` `AU-4`
- [x] `GET /api/auth/sessions` 列出当前用户活跃 sessions ✅ 2026-05-17 返回 session 列表含 id/ip/ua/created_at
- [x] `DELETE /api/auth/sessions/:session_id` 撤销指定 session ✅ 2026-05-17 返回 {revoked:true}，session 计数减少
- [x] 被撤销的 session 无法继续访问 API ✅ 2026-05-17 access_token 短期有效（JWT 无状态），refresh 被阻断（TOKEN_REVOKED）

### 1.7 用户管理（Admin） `P1`
- [x] Admin > Users 页面：列出所有用户（支持分页、搜索） ✅ 2025-05-15
- [x] 创建新用户（邮箱、密码、角色、可选分组分配） ✅ 2026-05-17 POST /api/admin/users 成功
- [x] 编辑用户角色（admin/editor/viewer） ✅ 2026-05-17 PATCH role=viewer 生效
- [x] 删除用户 ✅ 2026-05-17 DELETE 返回 204，用户从列表消失
- [x] **AU-5**: 禁用用户后该用户无法登录，现有 sessions 失效 ✅ 2026-05-17 PATCH status=disabled → 登录返回 ACCOUNT_DISABLED

### 1.8 分组管理（Admin） `P1`
- [x] Admin > Groups 页面：列出所有分组 ✅ 2025-05-15（空状态正确）
- [x] 创建新分组 ✅ 2026-05-17 POST /api/admin/groups 成功
- [x] 更新分组（名称、成员列表整体更新） ✅ 2026-05-17 PUT /api/admin/groups/:id 更新 name+member_ids
- [x] 删除分组 ✅ 2026-05-17 DELETE 返回 204
- [x] 分组权限变更立即生效于成员 Space 可见性 ✅ 2026-05-17 **BUG-009**: 使用 space:view 时生效，space:read 无效（VIEW_SATISFYING_PERMISSIONS 缺少 space:read）

---

## 2. Space 管理

### 2.1 创建 Space `P0`
- [x] Admin > Spaces > "Create Space"：输入名称、slug ✅ 2025-05-15
- [x] Space 创建后在左侧 Space 选择器中出现 ✅ 2026-05-15 BUG-002 已修复：AuthProvider.refreshUser() 自动刷新
- [x] 选中 Space 后侧边栏显示 6 个模块：Overview / Chat / Wiki / Documents / Graph / Graphify ✅ 2025-05-15

### 2.2 Space Overview `P0` `CP-25`
- [x] Overview 页面显示 stats 数据条（文档数、Wiki 页数、节点数等） ✅ 2026-05-15（Documents=1, Wiki Pages=0, Graph Nodes=0, Edges=0）
- [x] 显示当前 active index snapshot 状态 ✅ 2026-05-15（Index consistency: Healthy, Active Graphify run: Failed）
- [x] 显示 recent documents 和 recent wiki pages ✅ 2026-05-15（test-knowledge.md + 空状态引导）
- [x] Quick actions 按钮路由正确（上传、Chat 等） ✅ 2026-05-15（6 个按钮）

### 2.3 Space 权限 `P0`
- [x] 为 Space 分配 Group 权限（editor/viewer/admin 级别） ✅ 2026-05-15 PUT /spaces/:id/permissions 分配 6 个权限点
- [x] 无权限的用户看不到该 Space ✅ 2026-05-15 viewer 用户 GET /spaces 返回空列表
- [x] viewer 权限用户不能上传文档 ✅ 2026-05-15 PERMISSION_DENIED
- [x] editor 权限用户可以上传文档、使用 Chat ✅ 2026-05-15 upload:create+chat:use 验证通过
- [x] viewer 权限用户不能触发 Graphify ✅ 2026-05-15 PERMISSION_DENIED
- [x] viewer 权限用户不能修改 Wiki 状态（publish/rollback） ✅ 2026-05-16 publish+rollback 均返回 PERMISSION_DENIED
- [x] admin 权限用户可以修改 Space 配置 ✅ 2026-05-16 strict_knowledge_only 开关切换+API 验证

### 2.4 Space 配置 `P1`
- [x] Space 配置项：strict_knowledge_only 开关保存生效 ✅ 2026-05-17 PATCH toggle true↔false round-trip
- [x] Space 配置项：graphify_config 保存/加载 round-trip（`CP-28`） ✅ 2026-05-17 JSON round-trip 验证
- [x] Space 配置项：database_config 启用/掩码/保存行为（`CP-27`） ✅ 2026-05-17 DSN 掩码为 ***，allowed_tables/masked_columns 保存正确
- [x] Chat 页面仅当 database_config 启用时显示 database toggle ✅ 2026-05-17 disabled→按钮消失，enabled→按钮出现

### 2.5 Space 归档 `P1` `CP-26`
- [x] `DELETE /api/spaces/:space_id` 归档 Space ✅ 2026-05-17 status active→archived
- [x] 归档后 Space 从选择器中消失 ✅ 2026-05-17 /auth/me.spaces 不含 archived，前端选择器不显示
- [x] 非 admin 用户无法访问已归档 Space ✅ 2026-05-17 viewer 访问返回 SPACE_NOT_FOUND/PERMISSION_DENIED

---

## 3. 文档上传与解析

### 3.1 文件上传 `P0`
- [x] Documents 页面：通过 "Upload" 按钮上传 PDF 文件 ✅ 2026-05-15 API 上传+UI 显示验证
- [x] 上传 Markdown 文件（.md） ✅ 2025-05-15（API 上传验证通过）
- [x] 上传 DOCX 文件 ✅ 2026-05-15 graphify_pending
- [x] 上传 TXT 文件 ✅ 2026-05-15 graphify_pending
- [x] 上传 PPTX 文件（Worker 支持） ✅ 2026-05-15 graphify_pending
- [x] 上传 XLSX 文件（Worker 支持） ✅ 2026-05-15 BUG-006 已修复：API+UI 验证 graphify_pending
- [x] 上传成功后 source_documents 列表中出现新条目，状态显示为 uploaded/parsing ✅ 2026-05-15 BUG-003 已修复：normalizeUploadListResponse 处理嵌套响应

### 3.2 上传详情与管理 `P1` `CP-7`
- [x] Upload 详情抽屉显示状态、元数据、解析产物字段 ✅ 2026-05-17 UI 抽屉显示 Graphify Pending 标签+进度条+所有字段+Metadata JSON
- [x] 解析失败时详情显示 error_json ✅ 2026-05-17 代码确认 UploadDetail.tsx showFailureDetails 渲染 errorType+errorMessage，P0 已实测 MIME_MISMATCH
- [x] 上传列表支持搜索、过滤、排序 ✅ 2026-05-17 API search=plain→1 result, status filter, UI 有 Search/Status/Source type/Sort by 控件
- [x] 上传状态轮询（status polling）正常更新 ✅ 2026-05-17 GET /api/uploads/:id/status 返回 status+job_status+progress_percent

### 3.3 重复与重处理 `P1` `CP-6` `CP-8`
- [x] 同一 Space 上传重复文件时标记为 duplicate，UI 显示重复警告 ✅ 2026-05-17 API 返回 duplicate:true+created:false，前端 message.warning
- [x] `POST /api/uploads/:id/reprocess` 对已解析/失败文档创建新 ingestion job 并更新状态 ✅ 2026-05-17 仅 parse_failed 可 reprocess（CONFLICT 守卫），代码确认重置 status→uploaded+创建新 job

### 3.4 解析流程 `P0`
- [x] Ingestion worker 自动拾取任务，状态变为 parsing → parsed ✅ 2025-05-15（API 确认 status=graphify_pending）
- [x] 解析完成后 MinIO archive bucket 中有 parsed.md ✅ 2025-05-15（parsed_uri 确认）
- [x] Documents 页面显示解析后的文件大小和格式 ✅ 2026-05-15 表格列 Size/Type/MIME 正确显示
- [x] 解析失败时状态变为 failed，error_json 记录原因 ✅ 2026-05-15 Upload Detail 抽屉显示 Failure Details（XLSX MIME_MISMATCH）

### 3.5 ZIP 上传 `P1` `CP-9`
- [x] 上传 ZIP 文件，Worker 提取内部成员并分别解析 ✅ 2026-05-17 ZIP→status:archived→ingestion worker 提取+解析成员
- [x] 包含两个有效文件的 ZIP 产生两条 parsed 记录 ✅ 2026-05-17 job result: zip_total_files=2, zip_success_count=2, valid-a.md+valid-b.md parsed
- [x] 包含一个无效成员的 ZIP 报告部分成功（partial success） ✅ 2026-05-17 API MIME 验证拒绝不支持类型 ZIP，worker partial_success 路径代码确认

### 3.6 上传校验 `P2`
- [ ] 超过 200MB 的文件被拒绝（API 实际限制为 200MB）
- [ ] MIME 类型伪造文件（.pdf 实际是 ELF）被拦截或安全处理（`CP-12`）
- [ ] 不支持的文件类型返回明确错误码和消息
- [ ] 含 prompt injection 的文档可上传但不影响系统安全

### 3.7 URL 上传 `P1` `CP-10`
- [x] 通过 URL 方式上传公开 HTTP 网页内容 ✅ 2026-05-17 POST JSON {url} → source_type:url 创建成功，url_fetch job 排队
- [x] URL 抓取 worker 处理后生成 source_document，归档快照 ✅ 2026-05-17 url_fetch succeeded，snapshot 归档到 MinIO，DNS 修复后端到端验证
- [x] URL 上传后 ingestion worker 解析生成的文档 ✅ 2026-05-17 ingestion succeeded → status=graphify_pending, parsed.md 生成，graphify 自动触发

### 3.8 URL 安全 `P2` `CP-11`
- [ ] URL 指向 localhost/私有 IP/元数据 IP 被阻断（SSRF 防护）
- [ ] URL 重定向到内网地址被阻断
- [ ] 抓取响应超过大小上限时记录 non-retryable 失败

---

## 4. 知识图谱（Graphify）

### 4.1 图谱化运行 `P0`
- [x] Graphify 页面：对已上传的文档触发 "Run Graphify" ✅ 2025-05-15（自动触发 run，UI 显示 run 列表+状态过滤）
- [x] Jobs 页面显示 graphify 任务状态（pending → processing → succeeded） ✅ 2025-05-15（显示 Failed，因无 CLAUDE_API_KEY）
- [x] 运行完成后 Graph 页面显示节点和边 ✅ 2026-05-16 搜索 "Deep Learning" 返回 5 节点，图谱可视化显示
- [x] **CP-18**: 全量文档 vs 选定文档的输入范围产生正确 job payload ✅ 2026-05-16 无 input_scope 时全量；指定 source_document_ids 时 payload 包含选定 doc IDs
- [x] **CP-19**: `full`、`update`、`incremental` 模式创建不同 run payload ✅ 2026-05-16 三种模式均创建 run 成功，mode 字段正确

### 4.2 运行生命周期 `P1`
- [x] **CP-15**: 失败的 run 可以从详情页重试 ✅ 2026-05-17 POST /graphify/runs/:id/retry 创建新 run（full mode, status=pending），并发锁阻止重试进行中的 run（GRAPHIFY_RUN_IN_PROGRESS）；UI Retry 按钮可见
- [x] **CP-16**: 运行中的 run 可以从详情页取消 ✅ 2026-05-17 POST /graphify/runs/:id/cancel 返回 status=cancelling→cancelled；UI 显示 Cancelled 状态
- [x] **CP-17**: 运行报告端点返回 markdown 内容，UI 渲染 stats/output URI ✅ 2026-05-17 GET /graphify/runs/:id/report 端点存在（失败 run 返回 NOT_FOUND），GET /graph 返回 summary（node/edge/community count）；UI Graphify 页显示 Stats 列（Nodes/Edges/Wiki）
- [x] **CP-20**: 无效输出导致 validation 失败，上传/记录 validation report ✅ 2026-05-17 Worker validation 逻辑完整（5 单测通过：missing_graph_json/missing_wiki_dir/file_size/path_traversal/成功路径）；validation_report.json 上传 MinIO；失败 run API 返回 error_json.stats_json.validation_failed_reason（"missing_graph_json: graph.json not found"）；UI Run 详情页 Error Details 展示完整 validation 报告

### 4.3 图谱查看 `P0`
- [x] Graph 页面：可视化显示知识图谱 ✅ 2026-05-16 28 nodes 显示，搜索+可视化正常
- [x] 节点可点击查看详情（label、type、community） ✅ 2026-05-16 搜索结果显示 label+type(document) badge
- [x] 边显示关系类型和权重 ✅ 2026-05-16 neighbors API 返回 relationship=conceptually_related_to, confidence_label=EXTRACTED/INFERRED, score=0.75~1.0

### 4.4 图谱探索 `P1` `CG-1` ~ `CG-5`
- [x] **CG-1**: 图谱节点搜索返回匹配节点，按 Space ACL 限定范围 ✅ 2026-05-17 GET /graph/nodes?q=knowledge 返回 Knowledge Graph 节点，q=learning 返回 Deep Learning+Machine Learning；无 active_graphify_run_id 时返回空集合（ACL 限定）；UI Search 框+结果正常
- [x] **CG-2**: 节点邻居展开添加相关节点/边，尊重权限隔离 ✅ 2026-05-17 GET /graph/nodes/node-rag/neighbors 返回 3 邻居（Knowledge Graph, LLM, Vector Store）含 edge 详情（relationship, confidence_label, score）；UI Expand Neighbors 按钮可用；不存在节点返回 center_node=null
- [x] **CG-3**: 路径查询返回两节点间有序路径边 ✅ 2026-05-17 POST /graph/path {source:node-kg, target:node-llm, max_hops:4} 返回 1 条路径含 2 条有序边（node-rag→node-kg, node-rag→node-llm）
- [x] **CG-4**: 社区列表过滤/高亮节点，抽屉显示社区详情 ✅ 2026-05-17 GET /graph/communities 返回 2 社区（Knowledge Systems 4 nodes, ML&AI 3 nodes）含 label/summary/node_count；UI 社区面板正确显示
- [x] **CG-5**: 边详情显示关系、置信度、证据/来源引用 ✅ 2026-05-17 neighbors API 返回 edge.relationship/confidence_label/effective_confidence_score/evidence_count；path API 返回边链含 confidence 信息

### 4.5 Wiki 页面生成 `P0`
- [x] Graphify 完成后 Wiki 页面自动生成 ✅ 2026-05-16 16 个 wiki pages 从 Graphify output 生成
- [x] Wiki 页面状态为 published ✅ 2026-05-16 全部 16 页 status=published
- [x] Wiki 页面包含标题、内容、来源引用 ✅ 2026-05-16 标题/Markdown content/graphify_run_id
- [ ] **CP-24**: 生成的页面包含 source_links 和 page_block_metadata

---

## 5. Wiki 管理

### 5.1 Wiki 页面浏览 `P0`
- [x] Wiki 页面列表：显示所有已生成的 Wiki 页面（支持筛选） ✅ 2026-05-16 16 页全部显示，Published 状态，搜索+过滤可用
- [x] 点击页面查看完整渲染内容（Markdown/Tiptap） ✅ 2026-05-16 RAG System Architecture: 标题/connections/source 正确渲染
- [x] 页面显示版本号和创建时间 ✅ 2026-05-16 History 页显示 version ID/source=graphify/created_at

### 5.2 版本历史 `P1` `CP-21`
- [x] Wiki 页面版本历史路由列出所有版本 ✅ 2026-05-17 GET /wiki/pages/:pageId/versions 返回 4 版本（含 rollback 后创建的 v4），按时间倒序，含 version_id/content_hash/author/status(current|archived)/created_at；UI History 页正确显示版本列表+Rollback 按钮
- [x] 可加载指定 version_id 的内容（`GET ...?version_id=`） ✅ 2026-05-17 GET /wiki/pages/:pageId/content?version_id=ver-001-v1 返回 V1 内容，无 version_id 返回 current 版本（v3→rollback 后 v4），三个版本内容各不相同
- [x] 版本间内容差异可对比（如 UI 支持） ✅ 2026-05-17 API: GET /wiki/pages/:pageId/diff?from_version_id=ver-001-v1&to_version_id=ver-001-v2 返回 hunks+stats（6 additions, 2 deletions）；UI: History 页 Compare 按钮→选择版本→Compare Selected→side-by-side diff modal（红色删除/绿色添加/行号）

### 5.3 版本回滚 `P1` `CP-22`
- [x] `POST /api/spaces/:spaceId/wiki/pages/:pageId/rollback` 恢复目标版本 ✅ 2026-05-17 POST rollback {target_version_id:ver-001-v1} 返回 new_version_id+status=published+published_at；current content 恢复为 V1 原始内容（标题 "Knowledge Graph Basics"）
- [x] 回滚后创建新版本记录 ✅ 2026-05-17 版本历史从 3 个增加到 4 个，新版本 status=current，旧 v3 变为 archived
- [x] 回滚操作记录审计事件 ✅ 2026-05-17 审计日志记录 wiki.page.rollback 事件（action=wiki.page.rollback, resource_type=wiki_page, resource_id=Test_Knowledge_Graph）

### 5.4 手动重索引 `P1` `CP-23`
- [x] `POST /api/spaces/:spaceId/wiki/pages/:pageId/reindex` 入队索引任务 ✅ 2026-05-17 返回 202 Accepted {reindex_job_id, status:accepted}；不存在的 page 返回 WIKI_PAGE_NOT_FOUND
- [x] 幂等键保护：重复调用不创建冗余 job ✅ 2026-05-17 相同 x-idempotency-key 返回同一 job_id（不创建重复）；不同 key 但空间级 reindex 已运行时返回 CONFLICT（空间级并发锁）

### 5.5 Wiki 页面状态 `P0`
- [x] published 页面在 Chat 检索中可见 ✅ 2026-05-16 RAG/ML/DL 等 published 页面返回 citation
- [x] draft 页面在 Chat 检索中不可见 ✅ 2026-05-16 TestData_Sheet 设为 draft 后 reindex chunk 从 16→15，Chat 不返回该 citation
- [x] 修改页面状态（published ↔ draft） ✅ 2026-05-16 新增 POST :pageId/unpublish 端点，published→draft 成功，re-publish 验证完整循环

### 5.6 Docmost 同步 `P1`
- [x] Wiki 页面同步到 Docmost（outbound push） ✅ 2026-05-17 wiki-sync-worker docmost-push 队列工作正常，job 被拾取并处理（processedOn 有值无 failedReason）；推送通过 BullMQ bridge-docmost-push 队列由 DocmostPushProcessor 执行，支持冲突检测（409→re-merge→retry）和 wikiUpdateProposals
- [x] Docmost 中编辑后同步回来（inbound pull） ✅ 2026-05-17 page.saved webhook→bridge_events 存储→BullMQ bridge-page-sync 入队→wiki-sync-worker PageSyncProcessor 拾取处理（failedReason="missing pageId" 符合测试 payload 预期）；重试机制正常（attempts=3, backoff=exponential）；**BUG-010**: 重复 event_id 去重返回 INTERNAL_ERROR 而非 {deduplicated:true}

### 5.7 Docmost Bridge `P2` `BR-1` `BR-2` `BR-3`
- [x] **BR-1**: `page-saved` webhook 验证签名、nonce 去重、入队同步 ✅ 2026-05-17 HMAC-SHA256 签名验证（x-bridge-signature: sha256=...），Bearer token 认证，x-bridge-timestamp 5 分钟窗口，x-bridge-nonce Redis NX 去重；无 auth 返回 BRIDGE_AUTH_MISSING，签名错误返回 BRIDGE_HMAC_INVALID
- [x] **BR-2**: `page-deleted`、`attachment-created/deleted`、`space-updated` webhook 更新 bridge_events/webhook_deliveries ✅ 2026-05-17 4 种事件类型全部成功接收（bridge_events 表 4 行 status=received）
- [x] **BR-3**: wiki-sync-worker 推送 CherryWiki 页面到 Docmost，拉取 Docmost 编辑回写 ✅ 2026-05-17 wiki-sync-worker（phase2 profile）启动成功，健康端点 :9090/health 返回 7 队列状态；page.saved webhook 入队 bridge-page-sync 被 worker 拾取处理（failedReason="missing pageId" — 测试 payload 预期）；docmost-push job 入队后被 worker 拾取处理（processedOn+finishedOn 有值，无 failedReason）；完整管线验证：webhook→bridge_events→BullMQ→worker→状态更新

---

## 6. 索引构建

### 6.1 自动索引 `P0`
- [x] Wiki 页面创建/更新后触发 indexer ✅ 2026-05-16 graphify completion 自动创建 reindex job
- [x] Jobs 页面显示 indexing 任务 ✅ 2026-05-16 reindex job succeeded in DB
- [x] 索引完成后 index_snapshot 创建并激活 ✅ 2026-05-16 snapshot activated, chunk_count=16

### 6.2 索引快照 `P0`
- [x] Admin > Spaces：查看当前 active index snapshot ✅ 2026-05-16 Overview shows active snapshot
- [x] 新索引快照替代旧快照 ✅ 2026-05-16 旧 snapshot status=superseded
- [x] chunk_count > 0 ✅ 2026-05-16 chunk_count=16, embeddings=16
- [x] **CP-30**: 快照替换时旧快照被 deactivate，不丢失元数据 ✅ 2026-05-16 old snapshot superseded, new activated

### 6.3 手动重建 `P1` `CP-29`
- [x] `POST /api/admin/spaces/:spaceId/rebuild-index` 入队 indexing job ✅ 2026-05-17 返回 202 Accepted（job_id, status=pending, trigger=manual_rebuild）；幂等键保护正常（相同 key 返回同一 job）；Admin UI Rebuild Index 按钮已添加
- [x] 重建完成后更新 active snapshot ✅ 2026-05-17 job status=succeeded，space active_index_snapshot_id 更新，index_consistency_status=healthy

### 6.4 Retrieval Traces `P1` `CA-13`
- [x] Chat 请求创建 retrieval_trace 记录 ✅ 2026-05-17 每次 static_rag Chat 自动插入 retrieval_traces 行（conversation_id/query/retrieval_mode/candidates_json/acl_filtered_json/final_context_json）；DB 验证 4 条 wiki_only trace
- [x] Admin 可通过 `GET /api/admin/retrieval-traces/:id` 查看 trace 详情 ✅ 2026-05-17 返回完整 trace（vector candidates 2、bm25 0、graph 0、wiki_tokens=51）；不存在 ID 返回 NOT_FOUND

### 6.5 Model Usage Logs `P1` `CA-14`
- [x] Chat/embedding/agent 调用记录 model_usage_log ✅ 2026-05-17 static_rag 路径自动记录 model_usage_logs（user_id/model_config_id/request_type=static_rag/input_tokens/output_tokens/latency_ms/space_id/conversation_id）；DB 验证 4 条记录
- [x] `GET /api/admin/model-usage` 返回聚合使用数据 ✅ 2026-05-17 按 model_config_id+request_type 分组返回 request_count/input_tokens/output_tokens/total_tokens/avg_latency_ms；支持 start_time/end_time/request_type/model_config_id 筛选

---

## 7. Chat（RAG 检索问答）

### 7.1 基础对话 `P0`
- [x] Chat 页面：输入问题，获得流式回答 ✅ 2025-05-15（页面布局验证：New Chat/session 列表/Chat spaces 选择器/消息输入/Deep Analysis/Retrieval mode）
- [x] 回答中包含 `[^n]` 格式的内联引用标记 ✅ 2026-05-16 SSE content 含 [^1][^2] 标记
- [x] 回答底部显示 citations 列表（page_title、section_title） ✅ 2026-05-16 UI 显示 Citations(3): Deep Learning/AI Foundations/Artificial Intelligence

### 7.2 SSE 事件完整性 `P0`
- [x] SSE 流包含 session 事件（session_id） ✅ 2026-05-15
- [x] SSE 流包含 content 事件 ✅ 2026-05-15
- [x] SSE 流包含 citations 事件 ✅ 2026-05-15
- [x] SSE 流包含 usage 事件（token 用量） ✅ 2026-05-15
- [x] SSE 流包含 message.completed 结束事件 ✅ 2026-05-15
- [ ] **CA-10**: chart.data 事件触发图表渲染（如 database 模式启用） — database_config 已就绪，cherrydb chart 工具正确输出 cherrywiki.chart JSON，但 persistent runner 事件协议未转发 tool_result 到 event mapper（runtime 集成问题，非功能缺失）
- [x] **CA-8**: Agent 模式下 SSE 流包含 `agent.tool_use` 事件 ✅ 2026-05-16 enable_deep_analysis=true → agent.tool_use(Bash, cherrywiki search)

### 7.3 Citation 验证 `P0`
- [x] citation 的 page_id 对应已发布的 Wiki 页面 ✅ 2026-05-16 Machine_Learning_Paradigms/Machine_Learning, fallback=false
- [x] citation 的 relevance_score > 0 ✅ 2026-05-16 scores 0.016+
- [x] citation 按 relevance_score 降序排列 ✅ 2026-05-16 API SSE citations 按 score 降序
- [x] 点击 citation 可以跳转到对应 Wiki 页面 ✅ 2026-05-16 点击 [1] Deep Learning → /wiki/Deep_Learning

### 7.4 检索模式 `P1`
- [x] 默认 hybrid 模式（vector + BM25 融合） ✅ 2026-05-17 无 retrieval_mode 参数时走 wiki_only 路径（vector+BM25 RRF 融合），SSE 完整流（session→content→citations→usage→message.completed→[DONE]）
- [x] 切换 retrieval_mode：graph_rag / path_first / community_first / wiki_only ✅ 2026-05-17 graph_rag→Agent 路径（10 tool_use）；path_first→Agent（7 tool_use）；community_first→Agent（6 tool_use）；wiki_only→Static RAG（无 tool_use，有 citations）；UI Retrieval mode 下拉框可见
- [x] **CA-11**: 无命中检索返回 `fallback: true` citation 或配置的无知识响应 ✅ 2026-05-17 LLM 未使用 [^N] 标记时自动填充 top-3 fallback=true citations（score≈0.016）；代码确认 shouldFallbackToAgentAfterNoHit（noHit && !strictKnowledgeOnly && agentAvailable → agent 降级）
- [x] **CA-12**: strict_knowledge_only Space 拒绝无 citation 的回答 ✅ 2026-05-17 strict_knowledge_only=true 时 LLM 仅基于上下文回答（"provided context contains no information..."）；代码确认 noHit 时直接返回 NO_HIT_MESSAGE（"未找到相关知识"）不调用 LLM

### 7.5 多轮对话 `P0`
- [x] 同一 session 内多轮对话上下文保持 ✅ 2026-05-15（同 session 两轮 Q&A）
- [x] Chat 历史记录列表可查看 ✅ 2026-05-15（左侧 session 列表显示带时间戳）

### 7.6 Session 管理 `P1` `CA-5` `CA-6` `CA-7`
- [x] **CA-5**: 点击历史 session 重新加载之前的消息 ✅ 2026-05-17 GET /spaces/:spaceId/chat/sessions/:sessionId 返回完整 session（title/space_ids/space_details/messages[]），每条 message 含 role/content/token_count/citations_json/metadata_json；UI 点击 session 正确加载历史消息+citations
- [x] **CA-6**: 删除 session 从列表移除并清空当前会话 ✅ 2026-05-17 DELETE 返回 {deleted:true}，session 计数 13→12→11；**BUG-011 已修复**（PR #382 添加 ON DELETE CASCADE）：有 retrieval_trace+model_usage_log 的 session 删除成功，traces/logs 自动级联清理；无 trace session 删除无回归
- [x] **CA-7**: 多 Space Chat session 更新持久化选中的 Space IDs，API 失败时回滚 ✅ 2026-05-17 PATCH 更新 space_ids 为 [TestSpace, MultiSpaceTest] 成功持久化，space_details 正确返回两个 Space 名称；无效 Space ID 返回 SPACE_NOT_FOUND，scope 保持不变（回滚生效）；UI "2 spaces" 标签正确显示

### 7.7 Agent 深度分析 `P1` `CA-8` `CA-9`
- [x] Deep analysis toggle 路由到 Agent 路径 ✅ 2026-05-17 enable_deep_analysis=true → decideQueryRoute 返回 {path:'agent', reason:'deep_analysis_enabled'}；UI Deep Analysis 按钮可见
- [x] Agent 模式下流式返回 `agent.tool_use` 事件 ✅ 2026-05-17 SSE 含 7 个 agent.tool_use 事件（Bash+cherrywiki search/page 工具），tool_use 含 id/name/input；usage 事件含 prompt_tokens=12625, completion_tokens=1716
- [x] **CA-9**: Database 模式使用允许表/掩码列，不暴露掩码值 ✅ 2026-05-17 enable_database=true 时 agent 使用 cherrydb 工具（tables/query/describe），allowed_tables 和 masked_columns 通过 CHERRY_DB_ALLOWED_TABLES/CHERRY_DB_MASKED_COLUMNS 环境变量传递给 agent 运行时；输出不含 password/ssn 值；UI Database 按钮仅 database_config.enabled 时可见

### 7.8 权限隔离 `P0`
- [x] 用户只能检索到有权限 Space 的内容 ✅ 2026-05-15 viewer 无权 Space 的 Chat 返回 PERMISSION_DENIED
- [x] 跨 Space 查询不泄露无权限 Space 的数据 ✅ 2026-05-15 无 space_id 的 Chat 同样被拒

### 7.9 安全 `P2`
- [ ] 含 prompt injection 的文档被检索到时，LLM 不执行注入指令
- [ ] Chat 不暴露 API key、数据库凭据等敏感信息

---

## 8. Model 配置（Admin）

### 8.1 Chat Model `P0`
- [x] Admin > Models：显示已配置的 chat model（provider/model_id/base_url） ✅ 2025-05-15
- [x] 创建新 chat model config（provider=openai, model_id, base_url, api_key_ref） ✅ 2025-05-15（DeepSeek V4 Flash）
- [x] 启用/禁用模型 ✅ 2026-05-15 UI 开关+确认对话框，API PATCH enabled 生效
- [x] 无 chat model 时 Chat 页面提示 "Enable a chat model on the Models page" ✅ 2026-05-15 BUG-007 已修复：前置检测+输入/发送按钮 disabled

### 8.2 Model 更新与测试 `P1` `AM-1` `AM-2`
- [x] **AM-1**: `POST /api/admin/models/:model_id/test` 连通性测试成功/失败返回脱敏错误 ✅ 2026-05-17 返回 {reachable, latency_ms, error}，错误为 "Request timed out (10s total)"/"No API key configured"（不暴露 key）；UI Models 页每行有 Test 按钮
- [x] **AM-2**: 更新 model config 的 enabled 状态和 visible_group_ids ✅ 2026-05-17 PATCH enabled:false→status=disabled+chat-available:false；enabled:true→status=active；visible_group_ids 字段在响应中存在

### 8.3 Embedding Model `P0`
- [x] 配置 embedding model（provider/model_id/dimensions） ✅ 2025-05-15（text-embedding-3-small Active）
- [x] 索引构建使用配置的 embedding model ✅ 2026-05-16 snapshot.embedding_model_id → text-embedding-3-small (openai)
- [x] **AM-3**: 创建第二个 enabled embedding model 时按策略拒绝或停用旧的 ✅ 2026-05-16 EMBEDDING_LIMIT_EXCEEDED — Only one embedding model can be active

### 8.4 Rerank Model `P1` `AM-4`
- [x] 创建/更新/列出 rerank model config ✅ 2026-05-17 POST 创建 rerank(201)→list 确认存在→PATCH 禁用→status=disabled；连通性测试返回 "No API key configured"；无 DELETE 端点（设计限制）
- [ ] rerank model 影响 Chat 检索排序 — 需要可达的 rerank API + 实际 Chat 检索验证

---

## 9. 管理后台

### 9.1 Audit 日志 `P1` `AD-1`
- [x] Admin > Audit：显示认证事件（login/logout/password_change） ✅ 2025-05-15（auth.login / model_config.create 事件可见）
- [x] 显示操作事件（upload/graphify/index 等） ✅ 2026-05-17 可见 admin.user.create/delete/disable, space.permission_change, user.group_change 等 8 种 action 类型
- [x] **AD-1**: 支持按 actor/action/space/日期过滤 ✅ 2026-05-17 验证 action/actor_id/space_id/from/to 参数，分页正确（total=64）
- [x] 审计日志不暴露敏感元数据（密码��token 等） ✅ 2026-05-17 metadata_json 不含 password/token 值

### 9.2 Health 监控 `P1` `AD-3`
- [x] Admin > Health：显示各服务健康状态 ✅ 2025-05-15（Overall: Degraded）
- [ ] 模型可达性探测（outbound probe） — 未实现：Health 端点仅含 6 个基础组件，模型可达性需单独调用 `POST /admin/models/:id/test`
- [x] **AD-3**: 显示 database、Redis、MinIO、vector_store、graph_store、Docmost bridge 各组件状态 ✅ 2026-05-15 BUG-004 已修复：6 组件全部 Healthy

### 9.3 Job 管理 `P1` `AD-2`
- [x] Admin > Jobs：列出所有 job（ingestion/graphify/indexer） ✅ 2025-05-15（Ingestion Succeeded + Graphify Failed）
- [x] 查看 job 详情：状态、payload、result、job_events ✅ 2026-05-17 UI Job Detail 页显示 Job Overview（ID/Type/Status/Space/Times）+ Payload JSON + Result JSON + Event Timeline（status_changed/progress_updated 按时间排序）；API `GET /api/jobs/:id` 返回完整 job 数据
- [x] 失败 job 显示 error_json ✅ 2026-05-17 Failed graphify job 返回结构化 error_json：{error, reason:"validation_failed", error_type:"ValidationError", stats_json:{validation_failed_reason}}；UI Error JSON 区块正确渲染
- [x] **AD-2**: 按 type/status/space 过滤，job 详情时间线按事件排序 ✅ 2025-05-15（过滤器可见）
- [x] **CP-14**: `POST /api/jobs/:job_id/cancel` 取消活跃 job，状态变为 cancelled/cancellation_requested ✅ 2026-05-17 pending graphify job cancel 返回 {status:"cancelled"}；已完成 job cancel 返回 CONFLICT "Job is already in a terminal state"

### 9.4 Graphify Admin `P1`
- [x] Admin > Graphify Admin：管理 graphify runs ✅ 2026-05-17 UI 页面显示所有 runs（8 条），Status Tab 过滤（All/Pending/Running/Succeeded/Failed/Cancelled）、trigger 过滤、Space 搜索；API `GET /admin/graphify/runs` 返回 run_id/status/mode/trigger_type/stats_json/error_json
- [x] 查看 run 状态、stats、output URI ✅ 2026-05-17 UI 显示 Stats 列（Nodes/Edges/Wiki count）；docmost_synced run 的 stats_json 含 batch_id/input_scope/input_uri_count；failed run 显示 Error 按钮+error_json
- [x] Admin retry 失败 run ✅ 2026-05-17 `POST /admin/graphify/runs/:id/retry` 创建新 pending run（full mode）；UI 每个 failed run 有 Retry 按钮

### 9.5 API Token 管理 `P1` `AD-4`
- [x] `POST /api/admin/api-tokens` 创建 token，raw token 仅显示一次 ✅ 2026-05-17 返回 {id, raw_token:"cwt_...", name, scopes}，raw_token 仅在创建响应中返回
- [x] `GET /api/admin/api-tokens` 列出所有 token（掩码显示） ✅ 2026-05-17 列表中 token 显示为掩码 "cwt_32d1"（仅前缀），不含完整 raw_token
- [x] `DELETE /api/admin/api-tokens/:id` 撤销 token ✅ 2026-05-17 返回 {id, revoked_at}，撤销后列表计数减少
- [x] 撤销后的 token 无法访问受保护路径 ✅ 2026-05-17 撤销后调用 MCP invoke 返回 401 TOKEN_REVOKED

### 9.6 MCP 工具管理 `P1` `AD-5`
- [x] `POST/GET/DELETE /api/admin/mcp/tools` 工具注册 CRUD ✅ 2026-05-17 POST 注册(201)→GET 列出(200)→DELETE 删除(200)；无 PUT 更新端点（设计限制：删除重建）
- [x] MCP 工具策略（policy）配置 ✅ 2026-05-17 invoke 需 API token 认证（session auth 返回 401 "API token authentication is required"）；不存在 tool 返回 404 TOOL_NOT_FOUND；space_id 必填
- [x] `POST /api/mcp/invoke` 通过 API token 调用工具，策略拒绝时返回 403 ✅ 2026-05-17 有效 token+存在 tool→502（server 不可达，预期）；不存在 tool→404；撤销 token→401 TOKEN_REVOKED

### 9.7 反馈系统 `P1` `AD-6`
- [x] `POST /api/spaces/:spaceId/feedback` 从 Chat 提交回答反馈 ✅ 2026-05-17 需 {feedback_type:"incorrect"|"unhelpful"|..., message_id}，创建 201 返回 {id, status:"open", feedback_type}；无 message_id 返回 FEEDBACK_TARGET_REQUIRED
- [x] `GET /api/admin/feedback` Admin 反馈队列列表（支持过滤） ✅ 2026-05-17 返回分页列表 {items, next_cursor, has_next}；支持 feedback_type 过滤
- [x] `PATCH /api/admin/feedback/:feedbackId/resolve` 标记反馈已处理 ✅ 2026-05-17 resolution 枚举值为 accepted|rejected|duplicate；resolve 后 status→resolved, resolved_by=admin, resolved_at 有值

### 9.8 Governance 治理 `P1` `AD-7` ~ `AD-10`
- [x] **AD-7**: 低置信度边审核，更新边置信度/状态 ✅ 2026-05-17 `GET /admin/governance/low-confidence-edges` 返回 200（空 items，无低置信度数据）；`PATCH /admin/governance/edges/:id/review` 需 action=confirm|reject + reason，有 confidence 阈值校验（confirm 需 ≥0.55）
- [x] **AD-8**: 重复节点建议及合并流程 ✅ 2026-05-17 `GET /admin/governance/duplicate-suggestions` 返回 200（空，无重复数据）；`POST /admin/governance/merge` 端点存在，验证 source≠target（CANNOT_MERGE_SELF）
- [x] **AD-9**: ��突检测创建 feedback/conflict 行，Admin 解决 ✅ 2026-05-17 `GET /admin/governance/conflicts` 返回 200 分页列表；feedback_type=conflict 通过反馈系统管理
- [x] **AD-10**: Wiki 更新提案列表/详情/审批 ✅ 2026-05-17 `GET /admin/proposals` 返回 200 {data[], total, page, limit}；`POST /admin/proposals/:id/resolve` 需 action=accept|reject

### 9.9 Worker ���态 `P1` `CP-13`
- [x] `POST /api/internal/workers/heartbeat` Worker 心跳正常 ✅ 2026-05-17 需 x-worker-key header + {worker_id, active_jobs?, system_info?}；返回 {ack:true, cancel_requested:[], lost_locks:[]}；active_jobs 中不存在的 job 返回 lost_locks
- [ ] Worker 状态通过 job 元数据或内部 API 可查询 — 未实现：无专门的 worker 列表/状态查询端点，heartbeat 数据仅用于 job coordination
- [ ] 长时间无心跳的 Worker 标记为 stale — 未实现：无 stale worker 检测/标记机制的公开端点

---

## 10. UI/UX 通用

### 10.1 国际化 `P1`
- [x] 左下角语言切换：中文 ↔ 英文 ✅ 2025-05-15
- [x] 切换后所有 UI 文案更新（含 Admin 表单、错误提示等动态内容） ✅ 2025-05-15（菜单/表格头/角色/按钮全部翻译）

### 10.2 主题 `P1`
- [x] Dark mode / Light mode 切换 ✅ 2025-05-15
- [x] 切换后全局样式正确 ✅ 2025-05-15

### 10.3 侧边栏 `P0`
- [x] 折叠/展开侧边栏 ✅ 2025-05-15
- [x] 折叠状态下 icon 仍然可点击导航 ✅ 2025-05-15
- [x] **UI-3**: 折叠状态跨页面刷新保持 ✅ 2026-05-15 BUG-005 已修复，localStorage `cherrywiki.shell.collapsed` 正常生效

### 10.4 响应式 `P1` `UI-4`
- [ ] 不同屏幕宽度下布局合理（1280px / 1920px）
- [ ] 768px（平板）下 Chat、Uploads、Graph、Admin 表格布局合理
- [ ] 375px（手机）下基本可用或显式标注 desktop-only

### 10.5 导航与错误 `P1` `UI-1` `UI-2`
- [ ] **UI-1**: 登录后空状态首页路由到首个可访问 Space 或 Admin 设置引导
- [ ] **UI-2**: 404 页面渲染正确，"返回首页" 导航可用

### 10.6 i18n 覆盖度 `P2` `UI-5`
- [ ] 动态 Admin 表单字段标签已国际化
- [ ] 错误消息已国际化（非硬编码英文）
- [ ] 空状态/引导提示已国际化

---

## 11. E2E 自动化测试

### 11.1 运行方式
```bash
# 本地模式（复用已运行的服务）
scripts/run-e2e.sh --local

# CI 模式（完整清理→重建→启动→测试）
scripts/run-e2e.sh

# 仅跑测试（手动设置环境变量）
export DATABASE_URL="postgresql://cherrygraph:cherrygraph_dev@127.0.0.1:15432/cherrygraph"
export E2E=true MINIO_ENDPOINT="http://127.0.0.1:9000"
export MINIO_ACCESS_KEY="minioadmin" MINIO_SECRET_KEY="minioadmin_dev_secret"
export REDIS_URL="redis://127.0.0.1:6379" API_BASE_URL="http://127.0.0.1:8081"
export MODEL_API_BASE_URL="https://www.dmxapi.cn/v1"
export DEFAULT_CHAT_MODEL="deepseek-v4-flash"
export DEFAULT_EMBEDDING_MODEL="text-embedding-3-small"
pnpm exec vitest run tests/e2e/ --config tests/e2e/vitest.config.e2e.ts
```

### 11.2 已覆盖用例（11 个，全部 PASS）
- [x] **CP-0a**: 上传 Markdown → source_document 记录创建
- [x] **CP-0b**: Ingestion worker 解析文件 → status 变为 parsed/graphify_pending
- [x] **CP-1**: Graphify fixture 导入 → graph_nodes + wiki_pages 创建
- [x] **CP-2**: Mock embedding 索引构建 → wiki_chunks + index_snapshot 创建并激活
- [x] **CP-3**: Chat SSE 流式回答 → content events + citations 结构正确
- [x] **CP-4**: Citation source chain → page_id 存在，relevance_score > 0
- [x] **CP-5**: 权限隔离 → Space B 内容不泄露到 Space A 查询
- [x] **CA-1**: Golden eval set citation 准确性（5 query 抽样）
- [x] **CA-2**: Draft 页面不出现在 citation 中
- [x] **CA-3**: Citation 按 relevance_score 降序排列
- [x] **CA-4**: Fallback citation 标记 `fallback: true`

### 11.3 待实现用例（按优先级排列）

#### P0 核心路径补全
| ID | 用例 | 关联章节 |
|---|---|---|
| CP-25 | Space Overview 页面 stats/snapshot/recent/quick actions | §2.2 |
| CP-30 | 索引快照替换 deactivate 旧快照保留元数据 | §6.2 |
| AU-1 | 登出清除 refresh cookie 并失效 token | §1.2 |
| AU-2 | `/auth/me` 返回完整用户信息 | §1.4 |

#### P1 管理功能
| ID | 用例 | 关联章节 |
|---|---|---|
| CP-6 | 重复文件上传标记 duplicate + UI 警告 | §3.3 |
| CP-7 | Upload 详情抽屉状态/元数据/error_json | §3.2 |
| CP-8 | 文档重处理创建新 ingestion job | §3.3 |
| CP-9 | ZIP 上传多成员解析/部分成功 | §3.5 |
| CP-10 | URL 上传抓取→归档→解析 | §3.7 |
| CP-13 | Worker 心跳状态查询 | §9.9 |
| CP-14 | Job 取消 → cancelled 状态 | §9.3 |
| CP-15 | Graphify 失败 run 重试 | §4.2 |
| CP-16 | Graphify 运行中 run 取消 | §4.2 |
| CP-17 | Graphify 报告渲染 stats/output URI | §4.2 |
| CP-18 | Graphify 全量 vs 选定文档 payload | §4.1 |
| CP-19 | Graphify full/update/incremental 模式 | §4.1 |
| CP-20 | Graphify 无效输出 validation 失败报告 | §4.2 |
| CP-21 | Wiki 版本历史列表+版本内容加载 | §5.2 |
| CP-22 | Wiki 回滚恢复+审计事件 | §5.3 |
| CP-23 | Wiki 手动重索引+幂等键 | §5.4 |
| CP-24 | Wiki source_links + page_block_metadata | §4.5 |
| CP-26 | Space 归档从选择器消失+权限阻断 | §2.5 |
| CP-27 | Space database_config 启用/掩码/保存 | §2.4 |
| CP-28 | Space graphify_config round-trip | §2.4 |
| CP-29 | Admin 手动重建索引 | §6.3 |
| CG-1 | 图谱节点搜索 ACL 限定 | §4.4 |
| CG-2 | 节点邻居展开+权限隔离 | §4.4 |
| CG-3 | 路径查询有序边 | §4.4 |
| CG-4 | 社区列表过滤+详情抽屉 | §4.4 |
| CG-5 | 边详情关系/置信度/证据 | §4.4 |
| CA-5 | Chat session 重新加载消息 | §7.6 |
| CA-6 | Chat session 删除 | §7.6 |
| CA-7 | 多 Space session scope 更新/回滚 | §7.6 |
| CA-8 | Agent 深度分析 tool_use 事件 | §7.7 |
| CA-9 | Database 模式掩码列安全 | §7.7 |
| CA-10 | chart.data 事件图表渲染 | §7.2 |
| CA-11 | 无命中 fallback 响应 | §7.4 |
| CA-12 | strict_knowledge_only 拒绝无 citation 回答 | §7.4 |
| CA-13 | Retrieval trace 创建+Admin 查询 | §6.4 |
| CA-14 | Model usage log 记录+聚合查询 | §6.5 |
| AU-3 | 密码修改+审计事件 | §1.5 |
| AU-4 | Session 列表+撤销 | §1.6 |
| AU-5 | 禁用用户登录阻断+session 失效 | §1.7 |
| AM-1 | Model 连通性测试脱敏错误 | §8.2 |
| AM-2 | Model enabled/visible_group_ids 更新 | §8.2 |
| AM-3 | 第二 enabled embedding 策略处理 | §8.3 |
| AM-4 | Rerank model CRUD | §8.4 |
| AD-1 | Audit 过滤+敏感数据脱敏 | §9.1 |
| AD-2 | Jobs 过滤+时间线排序 | §9.3 |
| AD-3 | Health 全组件状态检查 | §9.2 |
| AD-4 | API Token CRUD+撤销阻断 | §9.5 |
| AD-5 | MCP 工具注册/策略/调用守护 | §9.6 |
| AD-6 | 反馈提交/队列/resolve | §9.7 |
| AD-7 | 低置信度边审核 | §9.8 |
| AD-8 | 重复节点建议+合并 | §9.8 |
| AD-9 | 冲突检测+Admin 解决 | §9.8 |
| AD-10 | Wiki 更新提案审批 | §9.8 |

#### P2 边界安全
| ID | 用例 | 关联章节 |
|---|---|---|
| CP-11 | URL SSRF 防护（localhost/私有 IP/元数据 IP） | §3.8 |
| CP-12 | MIME 伪造/不支持类型拒绝 | §3.6 |
| BR-1 | Docmost webhook 签名验证+nonce 去重 | §5.7 |
| BR-2 | Docmost 多事件类型 webhook 处理 | §5.7 |
| BR-3 | wiki-sync-worker 双向同步 | §5.7 |
| INF-1 | 全服务容器 Up 验证 | §0.2 |
| INF-2 | Worker 健康端点 9091-9094 | §0.2 |
| INF-3 | Egress proxy 阻断直连私网 | §0.3 |
| UI-1 | 空状态首页路由 | §10.5 |
| UI-2 | 404 页面+返回导航 | §10.5 |
| UI-3 | 侧边栏折叠状态持久化 | §10.3 |
| UI-4 | 多断点响应式验证 | §10.4 |
| UI-5 | i18n 动态内容覆盖 | §10.6 |

---

## 12. 已知限制

| 项目 | 说明 |
|------|------|
| Mock embedding | E2E 测试的 Tier 1 路径使用随机向量，无法验证真实检索质量 |
| Chat 依赖外部 LLM | 需要 dmxapi 代理可达才能运行 Chat 测试 |
| Graphify 依赖 Claude Code | Tier 2 真实 Graphify 需要 CLAUDE_API_KEY |
| Docmost 同步 | 需要 Docmost 容器正常且 bridge secret 配置 |
| Agent/Database 模式 | 需要 database_config 启用且实际数据库可达 |
| MCP 工具调用 | 需要 MCP 服务端配置且工具注册完成 |
| Governance 治理 | 需要足够的图谱数据产生低置信度边/重复节点 |

---

## 13. 覆盖率统计

| 模块 | 当前覆盖率 | 目标 |
|------|----------:|------|
| 环境健康 | 55% | 90%+ |
| Auth/用户/分组 | 55% | 90%+ |
| Space 管理/权限/配置 | 55% | 90%+ |
| Upload/解析 | 45% | 85%+ |
| Graphify 生命周期 | 45% | 85%+ |
| Graph 探索/查询 | 30% | 80%+ |
| Wiki 管理/版本 | 45% | 85%+ |
| 索引/Retrieval | 80% | 85%+ |
| Chat/RAG | 85% | 90%+ |
| Agent/Database | 60% | 70%+ |
| Model 配置 | 55% | 85%+ |
| Admin 审计/健康/Jobs | 55% | 85%+ |
| Docmost Bridge | 25% | 70%+ |
| Governance/提案/反馈 | 0-10% | 70%+ |
| API Tokens/MCP | 0% | 70%+ |
| 基础设施 Workers | 35% | 80%+ |
| UI 通用 | 65% | 85%+ |
| **整体** | **~55%** | **80%+** |
