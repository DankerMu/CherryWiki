# CherryWiki 项目进度

> 本文件是 session 间的状态接力棒。每次重大变更后更新。上限 200 行。
> 最后更新: 2026-05-16

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
| P1 管理功能 | — | — | ~75 | 未开始 |
| P2 边界安全 | — | — | ~15 | 未开始 |
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

### P0 未测项 (~1 项)

**Agent 行为依赖**: §7.2 CA-10 chart.data 事件触发（database_config 已就绪，触发取决于 agent 是否以图表格式返回数据）

## 7. 活跃 BUG

| ID | 优先级 | 状态 | 描述 | Issue |
|---|---|---|---|---|
| BUG-008 | P1 | 已完成 | chart.data SSE 事件未触发 — #364 active turn 事件注入、#365 内部 HTTP callback endpoint、#366 cherrydb chart CLI callback、#367 endpoint→SSE 集成验证已完成 | #364/#365/#366/#367 |

### 已修复 BUG (本轮)

| ID | 描述 | Fix |
|---|---|---|
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
| agent-chart-event-injection | issues #364/#365/#366/#367 complete | TurnEventQueue/PersistentStreamParser/AgentService 注入机制 + env 注入 + internal endpoint + cherrydb CLI callback + endpoint→SSE 集成验证 |
| auth-session-persist | 4/4 complete, issue #356 | BUG-005 修复 |
| fix-xlsx-mime-validation | 4/4 complete, issue #358 | BUG-006 修复 |
| chat-no-model-precheck | 4/4 complete, issue #359 | BUG-007 修复 |

## 9. 下一步

1. **继续 P0 测试** — 可立即测的 ~20 项（权限、多格式上传、SSE 事件、Model 管理）
2. **运行 Graphify** — 容器内 Claude Code 可用，运行后解锁 Graph/Wiki/Index/Citation 相关 P0 测试
3. **E2E 自动化** — `tests/e2e/` 已有 11 用例框架，待扩展

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
