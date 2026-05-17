# CherryWiki Bug 追踪（P0 复测轮次 2026-05-15）

> P0 级功能测试中发现的 bug。修复后勾选并注明修复 commit。

---

## P0 — 阻塞性

### BUG-005: 页面刷新丢失登录状态（AuthProvider 缺少 bootstrap refresh）

- **现象**: 登录后的任何页面，按 F5 或 `location.reload()` 后跳回登录页。在 agent-browser 和用户真实浏览器中均可复现。
- **根因**: `AuthProvider`（`apps/web/src/lib/auth.tsx:72`）初始化时，若无 `initialSession` prop（页面刷新场景），`accessToken` 和 `user` 均为 `null`。没有 useEffect 在 mount 时调用 `POST /api/auth/refresh`（携带 HttpOnly cookie）来恢复 session。路由守卫检测到未认证后立即重定向到 `/login`。
- **复现**:
  1. 正常登录进入任意页面
  2. 按 F5 刷新页面
  3. 页面跳回登录页
- **API 端无问题**: `POST /api/auth/refresh` 配合 HttpOnly cookie 可正常返回新 access_token（API 测试已验证）
- **影响**: P0 阻塞 — 用户每次刷新页面都需重新登录，严重影响可用性
- **修复方向**: 在 `AuthProvider` 的 mount useEffect 中，当 `initialSession` 未提供时，自动调用 `refresh()` 尝试恢复 session。成功则设置 token+user（调用 `/auth/me`），失败则导航到 `/login`。需要添加 `isBootstrapping` 状态避免闪烁。
- **关联文件**: 
  - `apps/web/src/lib/auth.tsx:72-162` — AuthProvider
  - `apps/web/src/App.tsx:141` — AuthProvider 初始化（未传 initialSession）
- **发现日期**: 2026-05-15
- **状态**: [x] 已修复 — AuthProvider bootstrap refresh + `isBootstrapping` 路由守卫 + 回归测试

---

### BUG-006: XLSX 上传被安全检查误拒（OOXML MIME 误判）

- **现象**: 上传合法 .xlsx 文件时，状态变为 `security_rejected`，原因为 `MIME_MISMATCH`
- **根因**: 安全校验检测到 XLSX 文件底层 MIME 为 `application/zip`（OOXML 格式基于 ZIP 容器），而期望的 MIME 是 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，导致误判为伪造文件
- **复现**: 上传任意有效 .xlsx 文件 → 状态显示 Security Rejected
- **影响**: P1 — XLSX 格式无法上传，但 UI 的 Supported 列表中包含 .xlsx
- **修复方向**: 安全校验中对 OOXML 格式（.xlsx/.docx/.pptx）的 MIME 检测需识别 ZIP 容器为合法基础格式，而非视为 MIME 伪造。可通过 magic number 检测 OOXML 签名（PK header + [Content_Types].xml）来区分
- **关联文件**: ingestion-worker 安全校验逻辑（`apps/ingestion-worker/` 相关文件）
- **发现日期**: 2026-05-15
- **状态**: [x] 已修复 — API MIME validator 允许 OOXML ZIP 容器，并在 `isZipUpload()` 排除 .xlsx/.docx/.pptx，避免 ZipValidator 校验 OOXML 内部条目

### BUG-007: Chat 页面在无 Chat Model 时缺少前置提示

- **现象**: 禁用所有 Chat Model 后，Chat 页面仍显示正常输入界面，用户需发送消息后才看到 "No enabled chat model configured" 错误
- **期望**: 进入 Chat 页面时应预先检测并显示提示信息（如 "请先配置聊天模型"），禁用发送按钮
- **影响**: P2 — UX 问题，不阻塞功能，但用户体验不佳
- **发现日期**: 2026-05-15
- **状态**: [x] 已修复 — 新增 `GET /api/models/chat-available` boolean-only endpoint，Chat 页预检查并显示无模型提示、禁用输入

---

## P1 — 功能缺陷

### BUG-008: chart.data SSE 事件未触发（persistent runner 不转发 tool_result）

- **现象**: Chat 使用 `cherrydb chart bar "SQL"` 工具时，工具正确输出 `{"type": "cherrywiki.chart", ...}` JSON，但前端未收到 `chart.data` SSE 事件，图表不渲染
- **根因**: `persistent-stream-parser.ts` 从 Claude Code CLI 的 JSONL stdout 读取事件，只处理 `type: 'assistant'`（文本+tool_use）和 `type: 'result'`（完成）。`type: 'user'`（含 tool_result content blocks）不会被 CLI 输出到 stdout，因此 `claude-event-mapper.ts:51-74` 中的 `extractChartEnvelopes` 逻辑永远不会被触发。当前修复改用 cherrydb CLI HTTP callback side-channel 将 chart envelope POST 到内部 API。
- **复现**:
  1. 配置 Space 的 database_config（enabled=true, 有效 DSN）
  2. Chat 中要求 "cherrydb chart bar 'SELECT ...'"
  3. Agent 正确执行命令，输出 cherrywiki.chart JSON
  4. 前端 SSE 流中无 `event: chart.data`
- **影响**: P1 — 数据库图表功能不可用，但不阻塞核心 RAG/Chat 流程
- **修复方向**: 在 `persistent-stream-parser.ts` 中，解析 tool 执行结果（可能需要 Claude Code CLI 输出 tool_result 事件，或在 agent service 层面拦截 Bash tool 的 stdout 并调用 `extractChartEnvelopes`）
- **关联文件**:
  - `apps/api/src/agent/persistent-stream-parser.ts` — 事件流解析
  - `apps/api/src/agent/claude-event-mapper.ts:51-74` — chart 提取逻辑（正确但无法触达）
  - `tools/cherrydb/cli.py` — chart 命令输出 JSON 后回调内部 endpoint
- **发现日期**: 2026-05-16
- **状态**: [x] 已修复待端到端复测 — #364 active turn 事件注入、#365 internal endpoint、#366 cherrydb CLI callback；`tools/cherrydb` 16 tests pass

### BUG-009: Space 列表 VIEW_SATISFYING_PERMISSIONS 缺少 space:read

- **现象**: 通过分组分配 `space:read` 权限后，`GET /api/spaces` 返回空列表；改为 `space:view` 则正常显示
- **根因**: `apps/api/src/spaces/space.service.ts:120` 定义 `VIEW_SATISFYING_PERMISSIONS = ['space:view', 'space:edit', 'space:admin']`，缺少 `space:read`。同样的问题存在于 `apps/api/src/jobs/jobs.service.ts:60`。而 Graph 模块 (`apps/api/src/graph/graph.service.ts:46`) 正确包含了 `space:read`。
- **影响**: P1 — 权限名称不一致导致部分 API 无法通过 `space:read` 获取 Space 列表。`/auth/me` 返回的 spaces 列表是正确的（不受此过滤影响），造成行为不一致。
- **修复方向**: 在 `space.service.ts:120` 和 `jobs.service.ts:60` 的 `VIEW_SATISFYING_PERMISSIONS` 数组中添加 `'space:read'`
- **关联文件**:
  - `apps/api/src/spaces/space.service.ts:120` — Space 列表权限过滤
  - `apps/api/src/jobs/jobs.service.ts:60` — Jobs 列表权限过滤
  - `apps/api/src/graph/graph.service.ts:46` — Graph 正确实现（参考）
- **发现日期**: 2026-05-17
- **状态**: [ ] 待修复

---

## 已修复（本轮）

- BUG-006: XLSX 上传被安全检查误拒 → 当前分支：OOXML ZIP MIME 通过，且不作为普通 ZIP 解包校验 ✅
- BUG-005: 页面刷新丢失登录状态 → 当前分支：bootstrap refresh + route guard loading ✅
- BUG-007: Chat 页面在无 Chat Model 时缺少前置提示 → 当前分支：Chat 页预检查模型可用性，缺失时提示并禁用发送 ✅
- BUG-008/#366: cherrydb chart CLI HTTP callback → chart 输出后非阻塞 POST 内部 endpoint，callback 缺失静默跳过、凭据缺失/HTTP 失败仅 stderr WARN ✅

## 已修复（上一轮）

- BUG-001: cookie Secure 标志 → `ae11d58` ✅
- BUG-002: Space 选择器刷新 → `eb85819` ✅
- BUG-003: 文档列表不显示 → `b698f10` ✅
- BUG-004: Docmost Bridge Unhealthy → `19c40fa` + `.env` 修复 ✅

---

## P0 测试进度记录（2026-05-15）

### §1 认证与用户管理

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §1.1 登录成功 | ✅ PASS | admin 登录跳转 Overview |
| §1.1 refresh_token HttpOnly cookie | ✅ PASS | 无 Secure 标志，HttpOnly; SameSite=Lax |
| §1.1 错误密码 | ✅ PASS | 已在上轮验证 |
| §1.2 登出清除 cookie | ✅ PASS | Set-Cookie Max-Age=0 |
| §1.2 登出后 token 失效 | ✅ PASS | TOKEN_REVOKED |
| §1.3 Token 刷新（valid cookie） | ✅ PASS | 200 OK + 新 access_token |
| §1.3 Token 刷新（invalid cookie） | ✅ PASS | 401 |
| §1.4 GET /auth/me | ✅ PASS | 返回 role/groups/spaces |
| §1.4 未登录 /auth/me | ✅ PASS | 401 |
| §1.x 页面刷新保持 session | ✅ PASS | BUG-005 已修复，新增 auth bootstrap 回归测试 |

### §2 Space 管理

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §2.1 创建 Space | ✅ PASS | |
| §2.1 Space 选择器更新 | ✅ PASS | BUG-002 已修复 |
| §2.2 Overview stats | ✅ PASS | Documents=1, Wiki=0, Nodes=0, Edges=0 |
| §2.2 Knowledge Status | ✅ PASS | Index consistency Healthy, Strict mode Enabled |
| §2.2 Recent Documents | ✅ PASS | test-knowledge.md 显示 |
| §2.2 Quick actions | ✅ PASS | 6 个按钮路由正确 |

### §3 文档上传与解析

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §3.1 上传 Markdown | ✅ PASS | API 验证通过 |
| §3.1 文档列表 UI 显示 | ✅ PASS | BUG-003 已修复，1016B/Graphify Pending |
| §3.4 Ingestion 解析 | ✅ PASS | status=graphify_pending, parsed_uri 存在 |

### §4 知识图谱

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §4.3 Graph Explorer | ✅ PASS | 空状态正确，有搜索/Communities/Legend |

### §5 Wiki 管理

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §5.1 Wiki 页面列表 | ✅ PASS | 空状态 + 搜索/过滤 |

### §7 Chat（RAG）

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §7.1 Chat 页面布局 | ✅ PASS | New Chat/input/Deep Analysis/Retrieval mode |
| §7.1 发送消息获得回答 | ✅ PASS | SSE 流完成，fallback 响应（strict mode） |
| §7.5 多轮对话 | ✅ PASS | 同一 session 两轮 Q&A |
| §7.5 Session 历史 | ✅ PASS | 左侧列表显示 session |

### §8 Model 配置

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §8.1 Chat Model 显示 | ✅ PASS | 上轮验证 |
| §8.3 Embedding Model | ✅ PASS | 上轮验证 |

### §9 管理后台

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §9.2 Health 全组件 | ✅ PASS | 6 组件 Healthy，BUG-004 已修复 |

### §10 UI/UX

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §10.3 侧边栏折叠/展开 | ✅ PASS | icon 导航可用 |
| §10.3 折叠跨刷新保持 | ✅ PASS | BUG-005 已修复，localStorage 正常生效 |

---

## 第二轮 P0 测试（2026-05-15 续）

### §1 认证 — 补充

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §1.1 连续5次错误密码锁定 | ✅ PASS | 第6次返回 ACCOUNT_LOCKED，TTL 15 分钟 |

### §3 文档上传 — 多格式

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §3.1 上传 TXT | ✅ PASS | text/plain, graphify_pending |
| §3.1 上传 PDF | ✅ PASS | application/pdf, graphify_pending |
| §3.1 上传 DOCX | ✅ PASS | application/octet-stream, graphify_pending |
| §3.1 上传 PPTX | ✅ PASS | application/octet-stream, graphify_pending |
| §3.1 上传 XLSX | ✅ PASS | BUG-006 已修复：application/octet-stream, graphify_pending |
| §3.1 Documents UI 列表 | ✅ PASS | 6 个文件全部显示，含 Status/Size/Type/Uploader/Time |

### §7 Chat — SSE 事件

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §7.2 SSE session 事件 | ✅ PASS | 返回 session_id |
| §7.2 SSE content 事件 | ✅ PASS | delta 内容 |
| §7.2 SSE citations 事件 | ✅ PASS | citations 数组（空，无索引） |
| §7.2 SSE usage 事件 | ✅ PASS | prompt/completion/total tokens |
| §7.2 SSE message.completed | ✅ PASS | 流结束事件 |

### §8 Model 配置

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §8.1 禁用模型 | ✅ PASS | UI 开关+确认对话框，状态变 Disabled |
| §8.1 启用模型 | ✅ PASS | API PATCH enabled=true 恢复 Active |
| §8.1 无 model 时 Chat 提示 | ✅ PASS | BUG-007 已修复：前置提示 "Enable a chat model" + 输入/发送 disabled |

### §2 Space 权限

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §2.3 分配 Group 权限 | ✅ PASS | PUT /spaces/:id/permissions 6 个权限点 |
| §2.3 无权限用户不可见 Space | ✅ PASS | viewer 返回空列表 |
| §2.3 viewer 不能上传 | ✅ PASS | PERMISSION_DENIED |
| §2.3 editor 可上传+Chat | ✅ PASS | upload:create + chat:use 生效 |
| §2.3 viewer 不能触发 Graphify | ✅ PASS | PERMISSION_DENIED |
| §7.8 Chat 权限隔离 | ✅ PASS | 无权用户 Chat 被拒 |

### 页面刷新 session 保持

| 测试项 | 结果 | 备注 |
|--------|------|------|
| BUG-005 修复验证 | ✅ PASS | 刷新后停留在 Overview，未跳回登录 |
| §10.3 侧边栏折叠持久化 | ✅ PASS | BUG-005 解除阻塞 |

### §4 Graphify 运行 (2026-05-16)

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §4.1 触发 Run Graphify | ✅ PASS | API 创建 full manual run, graphify-worker pick up |
| §4.1 Graphify 处理完成 | ✅ PASS | 28 nodes, 34 edges, 16 wiki pages, 228s |
| Graphify 输出上传 MinIO | ✅ PASS | graph.json(25KB), wiki/(16 files), GRAPH_REPORT.md |
| §2.3 admin 修改 Space 配置 | ✅ PASS | strict_knowledge_only 开关切换 + API 验证 |

### P0 补充测试 (2026-05-16 续)

| 测试项 | 结果 | 备注 |
|--------|------|------|
| CP-18 全量 vs 选定文档 | ✅ PASS | 无 input_scope 时全量；指定 source_document_ids 时 payload 正确包含 2 docs |
| CP-19 full/update/incremental 模式 | ✅ PASS | 三种模式均创建 run 成功 |
| §4.3 边关系类型和权重 | ✅ PASS | neighbors API 返回 relationship + confidence_label + effective_confidence_score |
| §5.5 unpublish (published→draft) | ✅ PASS | 新增 POST unpublish 端点，状态正确转为 draft，可 re-publish |
| AM-3 第二 embedding 策略 | ✅ PASS | EMBEDDING_LIMIT_EXCEEDED — Only one embedding model can be active |
| CA-10 chart.data 配置就绪 | ⚠️ 条件满足 | database_config 已启用，chart.data 触发取决于 agent 是否返回图表数据格式 |

### 环境问题修复记录

| 问题 | 修复 |
|------|------|
| graphify-worker /work/graphify 权限 | Dockerfile 添加 `mkdir + chown` 在 USER 切换前 |
| MinIO bucket cherrywiki-graphify-out 缺失 | `mc mb` 创建；runner.py 默认名与 init 脚本不一致 |
| indexer-worker 缺 model_api_key 环境变量 | docker-compose.yml 添加小写 env var 映射 |
| graph_edges 表无数据 | graph.json 的 links 字段已 backfill 到 graph_edges（34 条），新增 importGraphData 自动导入 |
| pgcrypto 缺失 | CREATE EXTENSION pgcrypto 解决 database_config DSN 加密 |
