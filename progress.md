# CherryWiki 项目进度

> 本文件是 session 间的状态接力棒。每次重大变更后更新。上限 200 行。
> 最后更新: 2026-05-15

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
| P0 核心路径 | 37 | 2 | 55 | ~40% |
| P1 管理功能 | — | — | ~75 | 未开始 |
| P2 边界安全 | — | — | ~15 | 未开始 |
| E2E 自动化 | 11 pass | 0 | ~60 | ~15% |

### P0 已测通过的模块

- §1 认证: 登录/登出/token 刷新/auth-me/页面刷新恢复 (10/10 ✅)
- §2 Space: 创建/Overview stats/recent docs/quick actions (6/6 ✅)
- §3 上传: Markdown 上传+解析+UI 列表 (3/3 ✅, 多格式未测)
- §7 Chat: 基础对话/多轮/session 历史 (4/4 ✅, citation 需索引)
- §9 Health: 6 组件全 healthy (1/1 ✅)
- §10 侧边栏: 折叠/展开/icon 导航 (2/2 ✅, 刷新登录态阻塞已解除)

### P0 未测项分类 (55 项)

**可立即测 (~20 项)**: §1.1 登录锁定、§2.3 Space 权限 (7项)、§3.1 多格式上传 PDF/DOCX/TXT/PPTX/XLSX、§7.2 SSE 事件 (5项)、§8.1 Model 启用/禁用
**需 Graphify 数据 (~20 项)**: §4 Graph 显示+Wiki 生成、§5 Wiki 浏览/状态、§6 索引构建/快照、§7.1+7.3 Citation
**需多用户 (~5 项)**: §2.3 权限隔离部分、§7.8 Chat 权限隔离

## 7. 活跃 BUG

| ID | 优先级 | 状态 | 描述 | Issue |
|---|---|---|---|---|
| BUG-005 | P0 | 已修复 | 页面刷新丢登录 — AuthProvider bootstrap refresh | #356 |

### 已修复 BUG (本轮)

| ID | 描述 | Fix |
|---|---|---|
| BUG-005 | 页面刷新丢登录 | 当前分支：bootstrap refresh + `isBootstrapping` 路由守卫 |
| BUG-001 | cookie Secure 标志 HTTP 下不持久 | `ae11d58` |
| BUG-002 | Space 创建后选择器不刷新 | `eb85819` |
| BUG-003 | 文档列表 UI 不显示 | `b698f10` |
| BUG-004 | Docmost Bridge Unhealthy | `19c40fa` + .env 修复 |

## 8. OpenSpec Changes (活跃)

| Change | 状态 | 说明 |
|---|---|---|
| auth-session-persist | 4/4 complete, issue #356 | BUG-005 修复 |

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
