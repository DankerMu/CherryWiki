# CherryWiki 项目进度

> 本文件是 session 间的状态接力棒。每次重大变更后更新。上限 200 行。
> 最后更新: 2026-05-31

## 1. 系统架构一句话

知识管理 + RAG 问答平台：上传文档 → Graphify 提取知识图谱 → 生成 Wiki → 建索引 → Chat 检索问答。13 个 Docker 容器，monorepo (pnpm workspace)。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| API | NestJS (TypeScript), `apps/api/` |
| Web | React + Ant Design, `apps/web/` |
| Workers | ingestion(Python), url-fetcher(Python), graphify(Python+ClaudeCode), indexer(Node), wiki-sync(Node) |
| 数据库 | PostgreSQL 16 (pgvector), Redis, MinIO |
| 外部 | Docmost (Wiki 编辑器), dmxapi (LLM 代理) |
| 图谱 | graphify 库 (Claude Code runner 模式) |

## 3. 环境状态

- **所有容器 healthy**（13/13），nginx 端口 80，API 端口 8081
- `.env` 已配置: MODEL_API_KEY (dmxapi), AGENT_ANTHROPIC_API_KEY (Graphify 用), WORKER_API_KEY
- **Claude Code 和 Graphify 可用**: graphify-worker 容器内 claude-code 已安装，GRAPHIFY_RUNNER_MODE=claude_code
- **Docmost Bridge healthy**: DOCMOST_BASE_URL=http://docmost:3000
- **Python venv**: `apps/graphify-worker/.venv/`

## 4. 当前里程碑

**M8: Production Readiness** (Epic #337)
- Phase 1 Real E2E Pipeline (#340) — 进行中

## 5. 已完成 Stages (按 git 历史)

| Stage | 内容 | 关键 PR |
|---|---|---|
| 1-5 | 基础架构、上传、解析、用户管理 | 早期 |
| 6 | Indexer: vector + BM25 + source chain | openspec change |
| 7 | Chat Engine: RAG + citations | openspec change |
| 8 | Graphify worker production metrics | #338 |
| 9 | Docmost fork + bridge | openspec change |
| Bug fixes | cookie/upload-list/space-selector/docmost-health | #348-#355 |

## 6. 功能测试状态

详见 `docs/e2e-functional-test-checklist.md` (160+ 项)

| 类别 | 已通过 | 有BUG | 未测 | 覆盖率 |
|---|---|---|---|---|
| P0 核心路径 | 88 | 0 | ~1 | ~99% |
| P1 管理功能 | 72 | 1 (BUG-009) | 0 | Batch 1-6 全部完成 |
| P2 边界安全 | 14 | 0 | 0 | Batch 7-9 全部完成 |
| E2E 自动化 | 11 pass | 0 | ~60 | ~15% |

### P0 已测通过的模块

- §1 认证: 登录/登出/token 刷新/auth-me/页面刷新恢复/账号锁定 (11/11 ✅)
- §2 Space: 创建/Overview/权限/隔离/admin 配置/viewer Wiki 拒绝 (13/13 ✅)
- §3 上传: MD/TXT/PDF/DOCX/PPTX/XLSX 上传+解析+UI 列表 (10/10 ✅)
- §4 Graphify: 运行/完成/节点显示/搜索/Wiki 生成/边关系权重/全量vs选定/模式验证 (12/12 ✅)
- §5 Wiki: 列表/内容渲染/版本历史/published 可见/draft 不可见/unpublish (6/6 ✅)
- §6 索引: 自动触发/snapshot/chunk_count=16/superseded/embedding model (8/8 ✅)
- §7 Chat: 对话/多轮/SSE/权限/引用/citations/跳转/agent.tool_use (17/17 ✅)
- §8 Model: 创建/显示/启用/禁用/前置提示/embedding 验证/第二 embedding 拒绝 (8/8 ✅)
- §9 Health: 6 组件 healthy (1/1 ✅)
- §10 侧边栏: 折叠/展开/icon/刷新保持 (3/3 ✅)

### P1 Batch 2 已测通过 (19 项, 2026-05-17)

- §2.4 Space 配置: strict_knowledge_only toggle/graphify_config round-trip/database_config 掩码/Chat database toggle 联动 (4/4 ✅)
- §2.5 Space 归档: DELETE 归档/选择器消失/非admin 拒绝 (3/3 ✅)
- §3.2 上传详情: 详情抽屉/error_json/搜索过滤排序/状态轮询 (4/4 ✅)
- §3.3 重复与重处理: duplicate 标记+UI 警告/reprocess 守卫 (2/2 ✅)
- §3.5 ZIP 上传: 提取解析/两文件两记录/partial_success 路径 (3/3 ✅)
- §3.7 URL 上传: URL→source_document+job/worker 抓取归档/ingestion 链路 (3/3 ✅, DNS 已修复，端到端验证通过)

### P1 Batch 3 已测通过 (4 项, 2026-05-17)

- §4.2 CP-20: Graphify validation 失败报告（worker 5 单测通过 + API error_json 返回 validation_failed_reason + UI 展示）(1/1 ✅)
- §5.2 版本 diff: API hunks+stats + UI Compare 按钮 + side-by-side diff modal (1/1 ✅)
- §6.3 CP-29: 手动重建索引 POST rebuild-index + 幂等键 + job succeeded + snapshot 更新 + UI Rebuild Index 按钮 (2/2 ✅)

### P1 Batch 5 已测通过 (25 项, 2026-05-18)

- §8.2 Model: AM-1 连通性测试脱敏/AM-2 enabled+visible_group_ids (2/2 ✅)
- §8.4 Rerank: CRUD 创建/列出/更新/禁用 + Chat 检索排序影响 (2/2 ✅)
- §9.2 Health: models 组件探测（enabled models 连通性，chat 超时→degraded，embedding 可达） (1/1 ✅)
- §9.3 Job: 详情(Payload+Error+Events)/error_json/CP-14 cancel (3/3 ✅)
- §9.4 Graphify Admin: 列表+Tab/stats/retry (3/3 ✅)
- §9.5 API Token: 创建/列出/撤销/TOKEN_REVOKED (4/4 ✅)
- §9.6 MCP: 注册/列出/删除/invoke+policy (3/3 ✅)
- §9.7 反馈: 提交/列表/resolve (3/3 ✅)
- §9.8 Governance: 边审核/重复建议/冲突/提案 (4/4 ✅)
- §9.9 Worker: heartbeat + 状态查询(online/degraded/stale 分类+summary) + stale 标记 (3/3 ✅)

### P1 Batch 6 已测通过 (5 项, 2026-05-18)

- §10.4 响应式: 1280px/1920px 布局合理 + 768px 平板基本可用(表格列窄) + 375px 手机折叠侧边栏后可用(表格需水平滚动) (3/3 ✅)
- §10.5 导航: UI-1 登录后路由到首个 Space Overview + UI-2 404 页面+Back to Home 导航 (2/2 ✅)

### P1 未测/未实现 (0 项)

无

### P2 Batch 7 已测通过 (5 项, 2026-05-18)

- §0.3 网络出口: egress-proxy(Squid 6.13) healthy + 私有 IP 访问被 ACL 403 拒绝 (2/2 ✅)
- §3.8 URL 安全: SSRF 4 种 IP 全 blocked + 重定向到内网阻断 + 超大响应 non-retryable (3/3 ✅)

### P2 Batch 8 已测通过 (6 项, 2026-05-18)

- §3.6 上传校验: 201MB→nginx 413 + ELF伪PDF→422 MIME_MISMATCH + .exe/.py→422 不支持 + prompt injection 文档正常上传 (4/4 ✅)
- §7.9 Chat 安全: prompt injection 被 LLM 拒绝 + API key/DB 密码查询未泄露 (2/2 ✅)

### P2 Batch 9 已测通过 (3 项, 2026-05-18)

- §10.6 i18n: Admin 表单标签全中文化 + 登录错误"邮箱或密码不正确" + 空状态"开始新的对话"/"页面未找到" (3/3 ✅)

### P0 未测项 (~1 项)

**Agent 行为依赖**: §7.2 CA-10 chart.data 事件触发（database_config 已就绪，触发取决于 agent 是否以图表格式返回数据）

## 7. 活跃 BUG

| ID | 优先级 | 状态 | 描述 | Issue |
|---|---|---|---|---|
| BUG-008 | P1 | 已完成 | chart.data SSE 事件未触发 — #364 active turn 事件注入、#365 内部 HTTP callback endpoint、#366 cherrydb chart CLI callback、#367 endpoint→SSE 集成验证已完成 | #364/#365/#366/#367 |
| BUG-009 | P1 | change ready | Space 列表 VIEW_SATISFYING_PERMISSIONS 缺少 space:read，分组分配 space:read 后 /spaces 返回空 | #372 |

### 已修复 BUG (本轮)

| ID | 描述 | Fix |
|---|---|---|
| #403 | Graph Explorer 面板主题对齐 | `SpaceGraphExplorerPage.tsx` 面板背景/边框改用 CSS 变量；Community 选中态改为默认按钮 + primary 边框/弱背景，文字层级使用 text token；Legend Tag 固定白字；新增 Web 回归测试；`npx vitest run`、`npx tsc -b apps/web` 通过 |
| #392 | Graph Explorer 社区节点展开 | `GET /api/graph/communities/:id/nodes?space_id=` 返回社区节点、内部边和 200 节点截断标记；前端点击社区加载并 merge 到画布，支持 loading/截断提示；新增 graph-core/API/Web/RAG 回归测试；`npm run build` 通过，相关测试通过，完整 `npm test` 仅遇到一次无关 Bridge rate-limit 5s 超时，单测复跑通过 |
| #386 | Admin Worker 状态端点 | 新增 `GET /api/admin/workers` 聚合 Redis `worker:heartbeat:*`，按 <30s/30-120s/≥120s 标记 online/degraded/stale，Redis 不可用返回空列表+错误；新增 6 个 controller 单测；`npm run build`、worker 测试、`npm run lint` 通过 |
| #385 | Health 端点集成 enabled models 连通性探测 | `ModelConfigService.listEnabledModels()` + 可配置超时 `probeModel()`；`AdminHealthController` 新增 optional `models` 组件，5s 单模型/8s 整体超时，unhealthy models 仅使 overall degraded；新增 6 个 models 健康回归测试；`npm run build`、health 测试、`npm run lint` 通过 |
| PR-387-R1 | Rerank API SSRF 防护与错误语义修正 | `callRerankApi` 接入 `validateAdminOutboundProbeUrl` + validated dispatcher + finally close；保留非 OK 响应 body cancel；无可用 rerank scores 错误信息改为更准确文案；`npm run build`、rerank 回归测试通过 |
| #384 | Chat static_rag 检索在 RRF 后接入 rerank，支持无模型/API 错误/超时非致命回退 | `ModelConfigService.getEnabledRerankModel()` + Chat rerank POST `/rerank` + trace metadata；新增 5 个 rerank 回归测试；`npm run build && npm test` 通过 |
| BUG-011/#381 | Chat session 删除因 retrieval_traces/model_usage_logs/feedback_items FK 缺少级联导致 500 | Drizzle schema + `0019_fix_session_delete_cascade.sql` 为 3 个 FK 增加 `ON DELETE CASCADE`；新增 schema 回归测试；`npm run build`、`npm test` 通过 |
| BUG-010 | URL 上传 DNS 解析失败 (SERVFAIL) | `url_fetch_private` 网络 `internal: true` → `false`，让 url-fetcher 能解析外部 DNS；Squid 增加私有 IP ACL 纵深防御 |
| BUG-008/#367 | chart-event endpoint 到 SSE consumer 全链路验证 | 新增 `apps/api/src/internal/__tests__/chart-event-e2e.test.ts`，覆盖 POST `/api/internal/agent/chart-event` → `AgentService.injectChartEvent` → `TurnEventQueue` → consumer 收到 `chart.data`，并验证 `chart.data` 早于 `message.completed` |
| BUG-008/#366 | cherrydb chart CLI 未回调内部 chart-event endpoint | `tools/cherrydb/cli.py` 在输出 chart envelope 后 POST `CHERRY_CHART_CALLBACK_URL`，新增 callback 单测；`tools/cherrydb` 16 tests pass |
| BUG-007 | Chat 页面无 model 时缺少前置提示 | 新增 `GET /api/models/chat-available` boolean-only endpoint；Chat 页预检查并显示无模型提示、禁用输入 |
| PR-360-R1 | OOXML 文件被 `isZipUpload()` 当普通 ZIP 触发 ZipValidator 误拒 | `apps/api/src/uploads/validators/mime-validator.ts` 对 `.xlsx/.docx/.pptx` 返回 false，新增 MIME + pipeline 回归测试 |
| BUG-006 | XLSX 上传被安全检查误拒 | 当前分支：OOXML MIME `application/zip` 通过，且排除普通 ZIP 解包校验 |
| PR-357-R1 | Auth bootstrap race: delayed refresh 401 清除已登录 session、延迟 bootstrap 复活已登出 session | `apps/web/src/lib/auth.tsx` 增加 bootstrap in-flight 401 抑制 + session generation stale guard，新增 2 个回归测试 |
| BUG-005 | 页面刷新丢登录 | 当前分支：bootstrap refresh + `isBootstrapping` 路由守卫 |
| BUG-001 | cookie Secure 标志 HTTP 下不持久 | `ae11d58` |
| BUG-002 | Space 创建后选择器不刷新 | `eb85819` |
| BUG-003 | 文档列表 UI 不显示 | `b698f10` |
| BUG-004 | Docmost Bridge Unhealthy | `19c40fa` + .env 修复 |

## 8. OpenSpec Changes (活跃)

| Change | 状态 | 说明 |
|---|---|---|
| entropy-governance | #412 API helper migration Round 1 closed, issues #408-#424 | `.entropy-baseline/latest.json` 已记录实际项目代码熵基线并排除 `external/*`；#410 已新增 common API error helper、API error inventory、共享 ErrorCode 提升和 helper/filter 回归测试；#411 已迁移 chat/wiki/graphify/jobs services；#412 已迁移 groups/models/mcp/feedback/api-tokens/governance/audit/admin/users/spaces/uploads/graph/internal 剩余本地 helper 到 common `throwApiError`；Round 1 追加 API token/Feedback/Governance/MCP Zod validation helper 迁移与 details 回归；Round 2 明确 Upload raw service/status `error_code` 证据单独记录，公共 HTTP 错误仍保持 `{ error, meta }` envelope 并有 filter 边界回归；本轮 targeted 71 pass、API typecheck/lint/OpenSpec strict validate 通过；后续进入 Chat/Web/worker boundary 分解 |
| graph-explorer-visual-overhaul | panel-theme-alignment complete, issues #400/#401/#403 | 新增 `useGraphTheme` 读取 theme CSS vars 并监听 `data-theme`；GraphCanvas 背景/边框/标签主题化；节点渲染增加默认/选中 glow、选中双环、大图默认 glow 降级；Graph Explorer 面板、Community 选中态和 Legend 对齐 theme token；`getNodeColor`/`getLinkColor` 已提取为纯函数并补充测试 |
| wiki-version-diff | API+UI complete, pending browser verification | `GET /wiki/pages/:pageId/diff` + version history compare modal；`npm run build`、Wiki API tests 通过 |
| fix-session-delete-cascade | complete, issue #381 | Chat session 关联 retrieval traces/model usage logs/feedback items 删除级联修复 |
| agent-chart-event-injection | issues #364/#365/#366/#367 complete | TurnEventQueue/PersistentStreamParser/AgentService 注入机制 + env 注入 + internal endpoint + cherrydb CLI callback + endpoint→SSE 集成验证 |
| auth-session-persist | 4/4 complete, issue #356 | BUG-005 修复 |
| fix-xlsx-mime-validation | 4/4 complete, issue #358 | BUG-006 修复 |
| chat-no-model-precheck | 4/4 complete, issue #359 | BUG-007 修复 |

## 9. 下一步

0. **Codex 工作流与 AGENTS 规则可用** — 已安装 `agentic-issue-delivery` pack、`repo-entropy-audit`、`control-plane-auditor`，并补强仓库级协作规则
1. **熵治理实现批次** — 从 #409 scoped AGENTS 和 #410 API error inventory 开始，按 #408 依赖图推进
2. **继续 P0 测试** — 可立即测的 ~20 项（权限、多格式上传、SSE 事件、Model 管理）
3. **运行 Graphify** — 容器内 Claude Code 可用，运行后解锁 Graph/Wiki/Index/Citation 相关 P0 测试

## 10. 关键文件索引

| 文件 | 用途 |
|---|---|
| `docs/e2e-functional-test-checklist.md` | 160+ 项功能测试清单 |
| `docs/bugs.md` | BUG 追踪（当前轮次） |
| `docs/project/26_需求追踪矩阵.md` | Stage 开工门禁对齐 |
| `openspec/changes/` | 30 个 change（含已归档） |
| `docker-compose.yml` | 13 服务编排 |
| `.env` | 所有密钥和配置（已配齐） |
| `tests/e2e/` | E2E 自动化测试 |
