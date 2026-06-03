# CherryWiki 浏览器 E2E 测试清单与执行记录（2026-06-02 轮次）

> 本轮目标：**不信任历史清单的"API 已通过"结论**，用 agent-browser 真实浏览器逐项验证 UI 行为，标记结果，bug 记入 `docs/bugs.md`（本轮重写）。
> 环境：13 容器全部 healthy（cherry-api / cherry-web / workers 已用当前源码 `fd07dda` 重新打包）。入口 `http://localhost`（nginx:80），API `http://localhost:8081`。
> 账号：`admin@cherrywiki.local / Admin123!@#`。
> 结果标记：✅ PASS ｜ ❌ FAIL（记 BUG）｜ ⚠️ 部分/瑕疵 ｜ ⛔ BLOCKED（前置不满足）｜ ⬜ 未测 ｜ 🚫 无 UI 入口

## 路由与覆盖范围（基于源码实测）

前端实际存在的路由（`apps/web` 路由表）：
`/login`、`/`、`/spaces/:id/overview|chat|wiki|wiki/:pageId|wiki/:pageId/history|graph|graphify|graphify/:runId|uploads`、
`/admin/users|groups|spaces|models|audit|health|jobs|jobs/:jobId|graphify`。

**后端有端点但前端无路由（本轮标 🚫，属覆盖缺口）**：API Tokens、MCP 工具、Feedback 队列、Governance 治理、Proposals 提案、Workers 状态。这些只能 API 验证，普通用户在 UI 中无法触达。

---

## §1 认证与用户管理

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 1.1 | 登录成功 | 打开 /login，输入 admin 账号密码，点 Sign in | 跳转到首个 Space overview | ⬜ | |
| 1.2 | 错误密码 | 输入错误密码登录 | 红色错误提示，停留登录页 | ⬜ | |
| 1.3 | 刷新保持登录 | 登录后任意页面 F5/reload | 仍停留当前页，不跳登录 | ⬜ | BUG-005 历史高发区 |
| 1.4 | 登出 | 点侧边栏 Logout | 清除 session，跳回登录页 | ⬜ | |
| 1.5 | 登出后不可回退 | 登出后直接访问受保护 URL | 被重定向到 /login | ⬜ | |
| 1.6 | 用户管理列表 | /admin/users | 列出用户，含搜索/角色/状态过滤 | ⬜ | |
| 1.7 | 创建用户 | 点 Create，填表提交 | 列表出现新用户 | ⬜ | |
| 1.8 | 编辑/禁用/删除用户 | 行操作 | 状态变更生效 | ⬜ | |
| 1.9 | 分组管理 | /admin/groups 列表+创建+权限分配 | CRUD 与权限矩阵可用 | ⬜ | |

## §2 Space 管理

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 2.1 | Space 选择器 | 侧边栏 Space 下拉 | 列出可访问 Space，可切换 | ⬜ | |
| 2.2 | Overview 统计卡 | 进入 overview | 文档/Wiki/节点/边 4 卡显示数字 | ⬜ | |
| 2.3 | Overview 知识状态 | 查看 Knowledge Status 面板 | 索引一致性/严格模式/图谱可用性/社区/活跃 run | ⬜ | |
| 2.4 | Recent 列表 + Quick actions | 查看下半区 | recent docs/wiki + 6 快捷按钮路由正确 | ⬜ | |
| 2.5 | Admin 创建 Space | /admin/spaces > Create | 名称+slug 提交，列表出现 | ⬜ | |
| 2.6 | Space 详情抽屉 | 点 Space 名 | 基本信息+配置+权限三段 | ⬜ | |
| 2.7 | strict_knowledge_only 开关 | 抽屉内 toggle 保存 | 保存生效，round-trip | ⬜ | |
| 2.8 | 权限矩阵保存 | 抽屉内勾选权限 Save | 保存成功并生效 | ⬜ | |
| 2.9 | Rebuild Index 按钮 | 抽屉内点击 | 入队 job，提示成功 | ⬜ | |
| 2.10 | 归档 Space | 行 Archive | 状态变 archived，选择器消失 | ⬜ | |

## §3 文档上传与解析

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 3.1 | 上传中心布局 | /spaces/:id/uploads | 拖拽区+URL 表单+列表 | ⬜ | |
| 3.2 | 上传 Markdown | 选择 .md 文件 | 出现列表项，状态流转到 parsed/graphify_pending | ⬜ | |
| 3.3 | 上传 PDF | 选择 .pdf | 解析成功 | ⬜ | |
| 3.4 | 上传 DOCX/PPTX/XLSX | 分别上传 | 解析成功（XLSX 历史误拒） | ⬜ | BUG-006 区域 |
| 3.5 | 列表过滤/搜索/排序 | 用控件 | 结果正确刷新 | ⬜ | |
| 3.6 | 上传详情抽屉 | 点列表项 | 元数据+状态+错误（如有） | ⬜ | |
| 3.7 | 删除文档 | 详情/行删除 | 列表移除 | ⬜ | |
| 3.8 | URL 上传 | URL 表单提交公开网页 | 创建 url 源，抓取→解析 | ⬜ | |
| 3.9 | 不支持类型 | 上传 .exe/.py | 明确错误提示 | ⬜ | |

## §4 知识图谱 Graphify

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 4.1 | Runs 列表 | /spaces/:id/graphify | 列表+状态 Tab+New Run | ⬜ | |
| 4.2 | 触发 New Run | 点 New Run 对话框提交 | 创建 run，状态 pending→running | ⬜ | 依赖 Claude Code |
| 4.3 | Run 详情 | 点 run | 概览+stats+report | ⬜ | |
| 4.4 | retry/cancel | 失败/运行中 run | 按钮可用并生效 | ⬜ | |
| 4.5 | Graph Explorer 渲染 | /spaces/:id/graph | 画布渲染节点/边 | ⬜ | |
| 4.6 | 节点搜索 | 搜索框输入 | 返回匹配节点列表 | ⬜ | |
| 4.7 | 节点选中/邻居展开 | 点节点+Expand | 详情抽屉+邻居加载 | ⬜ | |
| 4.8 | 社区过滤 | 社区下拉 | 高亮/筛选 | ⬜ | |

## §5 Wiki 管理

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 5.1 | Wiki 列表 | /spaces/:id/wiki | 页面列表+搜索+状态过滤 | ⬜ | |
| 5.2 | Wiki 详情渲染 | 点页面 | 标题+正文+元数据渲染 | ⬜ | |
| 5.3 | 版本历史 | 详情 History | 版本列表 | ⬜ | |
| 5.4 | 版本对比 | Compare 选两版本 | side-by-side diff | ⬜ | |
| 5.5 | 回滚 | Rollback 确认 | 恢复并新建版本 | ⬜ | |
| 5.6 | 发布/取消发布 | publish/unpublish | 状态切换 | ⬜ | |

## §6 索引与检索（UI 可观测部分）

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 6.1 | 索引状态显示 | Overview/Space 抽屉 | active snapshot 状态可见 | ⬜ | |
| 6.2 | 手动重建后状态更新 | Rebuild 后刷新 | 一致性变 healthy | ⬜ | |

## §7 Chat（RAG 问答）

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 7.1 | Chat 页面布局 | /spaces/:id/chat | session 列表+输入区+设置 | ⬜ | |
| 7.2 | 无模型前置提示 | 若无 chat model | 提示+禁用输入 | ⬜ | BUG-007 区域 |
| 7.3 | 发送消息流式回答 | 输入问题发送 | SSE 流式渲染回答 | ⬜ | 依赖 LLM |
| 7.4 | Citations 显示 | 回答完成 | 引用列表显示 | ⬜ | |
| 7.5 | 点击 citation 跳转 | 点引用 | 跳到对应 Wiki 页 | ⬜ | |
| 7.6 | 检索模式切换 | 下拉切换 mode | 不报错，正常回答 | ⬜ | |
| 7.7 | Deep Analysis 开关 | 开启发送 | agent 路径 | ⬜ | |
| 7.8 | 多轮对话 | 连续两问 | 上下文保持 | ⬜ | |
| 7.9 | 新建/切换/删除 session | 左栏操作 | 列表正确更新 | ⬜ | |
| 7.10 | 多 Space 选择 | 选择器多选 | scope 生效 | ⬜ | |

## §8 Model 配置（Admin）

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 8.1 | Models 列表 | /admin/models | 列出模型+类型+状态 | ⬜ | |
| 8.2 | 新增模型 | Add Model 表单 | 创建成功入列表 | ⬜ | |
| 8.3 | 连通性测试 | 行 Test | 返回延迟/错误（脱敏） | ⬜ | |
| 8.4 | 启用/禁用 | toggle | 状态切换 | ⬜ | |
| 8.5 | 编辑/删除 | 行操作 | 生效 | ⬜ | |

## §9 管理后台

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 9.1 | Audit 日志 | /admin/audit | 列表+过滤 | ⬜ | |
| 9.2 | Health 监控 | /admin/health | overall+各组件状态 | ⬜ | |
| 9.3 | Jobs 列表 | /admin/jobs | 列表+过滤+分页 | ⬜ | |
| 9.4 | Job 详情 | 点 job | 概览+payload+事件时间线 | ⬜ | |
| 9.5 | Graphify Admin | /admin/graphify | 跨空间 run 列表+retry | ⬜ | |
| 9.6 | API Tokens | — | 无前端路由 | 🚫 | 覆盖缺口 |
| 9.7 | MCP 工具 | — | 无前端路由 | 🚫 | 覆盖缺口 |
| 9.8 | Feedback 队列 | — | 无前端路由 | 🚫 | 覆盖缺口 |
| 9.9 | Governance 治理 | — | 无前端路由 | 🚫 | 覆盖缺口 |
| 9.10 | Proposals 提案 | — | 无前端路由 | 🚫 | 覆盖缺口 |
| 9.11 | Workers 状态 | — | 无前端路由 | 🚫 | 覆盖缺口 |

## §10 UI/UX 通用

| ID | 测试项 | 步骤 | 预期 | 结果 | 备注 |
|----|--------|------|------|------|------|
| 10.1 | 侧边栏折叠/展开 | 点折叠按钮 | 切换+icon 可点 | ⬜ | |
| 10.2 | 折叠跨刷新保持 | 折叠后 F5 | 保持折叠 | ⬜ | |
| 10.3 | 语言切换 | 中文↔EN | 文案切换 | ⬜ | |
| 10.4 | 主题切换 | 明↔暗 | 全局样式切换 | ⬜ | |
| 10.5 | 面包屑 | 各页查看 | 路径正确 | ⬜ | |
| 10.6 | 404 页面 | 访问无效 URL | 404+返回首页 | ⬜ | |
| 10.7 | 响应式 | 缩放视口 | 布局合理 | ⬜ | |

---

## 执行记录（2026-06-02 实跑）

> agent-browser 真实浏览器执行。**环境前提**：本轮发现运行中的 `cherry-web`/`nginx` 已停止 7 天、`cherry-api` 镜像为 2 周前旧版（源码已到 `fd07dda`），先拉起并用当前源码重新打包全部 app 服务后才开始测试。

### 结果汇总

| 模块 | PASS | 部分/瑕疵 | BLOCKED | 无 UI | 关键结论 |
|------|-----:|-----:|-----:|-----:|------|
| §1 认证 | 1.1/1.2/1.3/1.4/1.5/1.6/1.7/1.8/1.9 | — | — | — | 登录/错误提示/刷新/登出/重定向 + 用户禁用/编辑/删除 + 分组创建删除全通 |
| §2 Space | 2.1/2.2/2.3/2.4/2.5/2.6/2.7/2.9/2.10 | 2.8(分组制,无组时空提示) | — | — | 创建/strict round-trip/Rebuild入队Succeeded/归档全通 |
| §3 上传 | 3.1/3.2/3.5/3.6/3.8/3.9 | 3.7(无删除能力→B2-005) | 3.3/3.4(无 office 样本) | — | 过滤 20→2、详情全字段(SHA256/error/meta)完整 |
| §4 图谱 | 4.1/4.6/4.7/4.8 | 4.5(见下)/4.2/4.3/4.4 未触发真实 run | — | — | 搜索/选中/详情/社区/邻居正常 |
| §5 Wiki | 5.1/5.2/5.3 | 5.6 publish 仅draft显示;unpublish 无UI→B2-005 | 5.4/5.5(仅 1 版本,rollback已接线) | — | 列表/详情/历史渲染正常 |
| §7 Chat | 7.1/7.3/7.4/7.5/7.6/7.8/7.9 | 7.10(仅1 active space不可测) | — | — | 多轮上下文/检索模式切换/session 增删切均通 |
| §8 Model | 8.1/8.2/8.3/8.4/8.5 | 删除无能力(软删设计→B2-005) | — | — | 新增/连通测试/启停/编辑全通 |
| §9 后台 | 9.1/9.2/9.3/9.4/9.5 | — | — | 9.6-9.11 | 有 UI 的 5 页全通；6 项后端能力无前端入口 |
| §10 UI/UX | 10.1/10.2/10.3/10.4/10.5/10.6 | 10.7 响应式缺陷→B2-004 | — | — | 折叠/主题持久化、i18n、面包屑、404 全通；窄屏侧栏不折叠 |

### 逐项要点

- **§1.1/1.2** 登录跳 overview；错误密码停留登录页提示 "Email or password is incorrect."。
- **§1.3** F5 刷新停留当前页（历史 BUG-005 区域，已不复现）。
- **§1.4/1.5** Logout → /login；登出后访问受保护路由重定向 /login。
- **§1.7** 创建用户 e2e-test-user（viewer/Active）成功入列表，并在 Audit 留下 `admin.user.create`。
- **§2.2/2.3/2.4** Overview：文档 20→22 / Wiki 2 / 节点 59 / 边 55；知识状态（索引 Healthy/严格模式 Disabled/图谱可用/社区 2/活跃 run Docmost Synced）；Recent + Quick Actions 齐全。
- **§3.2** 上传 `e2e-test-doc.md` → text/x-markdown 102B → Graphify Pending。
- **§3.8** URL 上传 `https://example.com/` → text/html 528B → Archived。
- **§3.9** 上传 `.py` → Failed `UNSUPPORTED_FILE_TYPE: Unsupported file type.`
- **§4.5** Graph 画布：getImageData 证明有渲染像素（约 4783px 集中于 95×83 小簇），但 headless 截图捕获为空白 —— 判定为 **headless 截图伪影，需真人浏览器目视复核**（不作为功能 bug）。搜索/选中/详情(Score/ID/Community)/社区/邻居数据层全部正常。
- **§5.2** 经 Chat 引用点击跳转到 `/wiki/RAG_Architecture`，标题/正文/Published/History 渲染正常。
- **§7.3/7.4/7.5** 问 "What is RAG architecture?" → 流式回答 "Based on the provided context, RAG ... combines search with LLMs"，Citations(1) [1] RAG Architecture，点击跳转 Wiki 详情。
- **§8.3** Chat 模型连通性测试 → Reachable (1546 ms)。
- **§9.2** Health：Overall Healthy + 7 组件全绿。
- **§9.4** Failed Ingestion job 详情：Payload/Error JSON(error_type=parse_error / "Unsupported MIME type")/事件时间线齐全。
- **§10** 侧边栏折叠 `cherrywiki.shell.collapsed=true`、主题 `data-theme=dark` 均跨刷新保持；中文切换全量生效；404 "Not Found / Back to Home"。

### 第二批深测（写回类操作，2026-06-02 续测）

- **§1.8** e2e-test-user：禁用（Popconfirm 确认→Disabled）、编辑显示名（→"E2E Edited Name"）、删除（行移除，仅剩 admin/viewer）全部生效。
- **§1.9** 创建分组 "E2E Test Group"（描述+权限 `chat:use,space:view` 绑定 Test Space）成功，删除生效。
- **§2.5/2.7/2.9/2.10** 创建 "E2E Temp Space"→列表出现；strict_knowledge_only 开启后关抽屉重开仍为 true（round-trip 持久），还原 false；Rebuild Index 点击两次 → Jobs 列表两条 Reindex 均 Succeeded(snapshot_activated)；临时 Space 归档→archived。
- **§2.8** 权限矩阵为**分组制**，删除测试组后抽屉显示 "Create a group before assigning permissions"——属正常空状态。
- **§3.5** Status 过滤 "Parse Failed"：20→2 行，全为该状态。
- **§3.6** 上传详情抽屉：Source ID/Type/Size/Uploader/MIME/SHA256/时间戳/Job ID+Status/Failure Details(error_type=parse_error)/raw metadata JSON 全字段完整。
- **§3.7** 上传列表行仅 "Details"，无删除/重处理按钮；`uploads.controller.ts` 无 `@Delete`（→B2-005）。
- **§7.6** 检索模式 Auto→Graph first：问"What is a knowledge graph?"走 **Agent 路径**正常完整回答。
- **§7.8** 多轮：首问 RAG 后追问"What are its main components?"，"its"正确指代 RAG，答"vector store, BM25, and an LLM[1]"——上下文保持。
- **§7.9** New Chat 新建 session（自动命名）→ 删除（18→17）→ 点击切换到既有 session 正确加载历史消息。
- **§7.10** 系统仅 1 个 active space（其余 archived），多空间 scope 无法实测。
- **§8.2/8.4/8.5** 新增 rerank 模型 "E2E Test Model"→入列表；禁用（Popconfirm→Disabled）；编辑显示名→"E2E Edited Model"。模型无 `@Delete`（软删设计，→B2-005）。
- **§5.6** `WikiPageDetail.tsx` publish 按钮仅 `status==='draft'` 且有 `wiki:publish` 权限时显示；现有 2 页均 Published 故隐藏，无 draft 页可实测。API 有 unpublish/rollback 端点，但前端只接 publish+rollback，**无 unpublish UI**（→B2-005）。rollback 已在 History 页接线，但仅 1 版本无法触发。
- **§10.7** 视口 375×812：侧栏固定 264px 不折叠，主内容压到 111px，`body.scrollWidth=495>375` 横向溢出。`AppShell.tsx:217` Sider 无 `breakpoint`（→B2-004）。

### 总体判断

核心用户路径（登录 → 上传 → 图谱/Wiki → 索引 → Chat RAG 引用）以及**第二批写回类深测**（用户/分组 CRUD、Space 配置 round-trip、Rebuild 入队、上传过滤/详情、Chat 多轮/检索模式/session 增删切、Model CRUD）在**当前源码重新打包后全部走通，未发现阻塞性功能 bug**。这与"很多 bug"的预期不符，最可能原因：此前测试针对的是**停运/陈旧容器**（cherry-web/nginx 停了 7 天、api 镜像 2 周旧）。本轮真正的问题集中在：

1. **环境卫生（P0 运维，B2-001）**：前端与反代容器长期停摆、API 镜像滞后源码 2 周 —— 任何基于此环境的"测试"结论都不可信。已重新打包修复。
2. **产品覆盖缺口（P1，B2-002/B2-005）**：API Tokens / MCP / Feedback / Governance / Proposals / Workers 6 项后端能力**无前端路由**；另有 Wiki unpublish、上传 reprocess 端点存在却无 UI 按钮，文档/模型无硬删除 UI。
3. **响应式缺陷（P2，B2-004）**：`AppShell.tsx` Sider 无 `breakpoint`，窄视口不折叠导致布局横向溢出。
4. **待真人复核（P2，B2-003）**：Graph 画布在 headless 下截图为空（数据层正常），需目视确认真实渲染。

详见 `docs/bugs.md`。
