# CherryWiki Agent Instructions

## 上下文恢复

每次 session 开始时，先读以下文件建立上下文（按优先级）：

1. **`progress.md`** — 项目状态、活跃 BUG、下一步（必读，<200 行）
2. **`docs/bugs.md`** — 当前轮次 BUG 追踪
3. **`docs/e2e-functional-test-checklist.md`** — 功能测试进度（按需）

默认只读和当前任务相关的文档。Stage / issue 实现优先读 `docs/project/26_需求追踪矩阵.md`、对应 OpenSpec change、相关源码和测试；不要为了"了解背景"默认全仓扫描。

## Stage 开工门禁

每个 Stage 进入编码前，必须用 `docs/project/26_需求追踪矩阵.md` 做一次对齐检查。需求、API、Schema、测试四列中任一列为空，不允许进入编码。

## Python 环境

- 虚拟环境路径：`apps/graphify-worker/.venv/`
- 所有 Python 操作必须使用虚拟环境，禁止使用系统 Python
  - 运行：`apps/graphify-worker/.venv/bin/python`
  - 测试：`apps/graphify-worker/.venv/bin/python -m pytest`
  - 安装：`apps/graphify-worker/.venv/bin/pip install`
- codeagent prompt 中涉及 Python 命令时必须指定 venv 完整路径

## 容器环境

- 所有服务通过 `docker compose` 管理，nginx 端口 80，API 端口 8081
- `.env` 已配置所有必要密钥（MODEL_API_KEY, AGENT_ANTHROPIC_API_KEY, WORKER_API_KEY 等）
- **Graphify 可用**：graphify-worker 容器内 claude-code 已安装，GRAPHIFY_RUNNER_MODE=claude_code
- **禁止全局 `docker prune`**，只清理本项目容器（`docker compose down --rmi local`）
- 重建：`docker compose down --rmi local && docker compose build --no-cache && docker compose up -d`
- 日志：`docker compose logs <service> --tail 50`

## 编码规范

- TypeScript (API/Web/Workers)：遵循 repo 中 eslint + prettier 配置
- Python (graphify/ingestion/url-fetcher)：使用上述 venv
- 提交信息格式：`type(scope): description (#issue)`，type = feat/fix/test/docs/chore
- 不添加不必要的注释、不做超出任务范围的重构
- Monorepo 使用 pnpm workspace。新增 Node 依赖必须写入对应 workspace 的 `package.json` 并更新锁文件，不要混用 npm/yarn。
- API/Web/Worker 优先复用 `packages/*` 中既有 core/shared/schema 能力；不要为了单个功能复制领域模型、权限判断、错误码或 DTO。
- 用户可见文案默认中文；API 错误语义、权限提示、空状态和功能测试清单描述应保持一致。

## 命令与验证入口

根目录常用验证：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm secret:scan
```

按范围运行更小验证：

```bash
pnpm --filter @cherrygraph/api test
pnpm --filter @cherrygraph/web test
pnpm exec vitest run tests/integration/ --config vitest.config.ts --passWithNoTests=false
pnpm exec vitest run tests/e2e/ --config tests/e2e/vitest.config.e2e.ts --passWithNoTests=false
```

Python worker 必须用各自 venv。graphify-worker 使用：

```bash
apps/graphify-worker/.venv/bin/python -m pytest apps/graphify-worker/tests -v
```

容器与 schema 验证：

```bash
docker compose config --quiet
docker compose -f docker-compose.prod.yml config --quiet
docker compose ps
docker compose logs <service> --tail 50
```

没有改动对应层时不必机械运行所有命令，但最终回复必须说明实际执行的验证和未执行项原因。

## 测试要求

- 新功能需对应测试（单元或 E2E）
- BUG 修复需包含回归测试
- E2E 测试用 vitest，配置在 `tests/e2e/vitest.config.e2e.ts`
- 功能测试清单：`docs/e2e-functional-test-checklist.md`（160+ 项，标记 P0/P1/P2）

## 变更完整性规则

功能变更必须覆盖自然相邻面。改 API 时同步 DTO/schema、权限、错误语义、前端调用和测试；改数据库 schema 时同步 Drizzle migration、`docs/schemas/schema.sql`、回滚/兼容路径和集成测试；改 Graphify / ingestion / url-fetcher 时同步 worker、队列事件、错误状态、容器配置和 worker 测试；改 Wiki / Docmost bridge 时同步 API、wiki-core、wiki-sync-worker、前端展示和 bridge contract 测试；改 Chat / Agent / RAG 时同步检索链路、citation/source chain、SSE 事件、模型配置和回归测试。

不得用假数据、硬编码、TODO、临时绕过、只覆盖 happy path、跳过权限/错误处理/状态流转/测试来制造"完成"。如果外部服务、密钥、真实模型或容器状态导致当前切片不能完整验证，必须在回复中明确缺口、已完成边界和剩余验证条件。

## OpenSpec 流程

变更管理用 `openspec` CLI：
```bash
openspec new change "<name>"
openspec instructions <artifact> --change "<name>" --json
openspec status --change "<name>"
```
审核必须用 codeagent codex 后端（`--backend codex`）。`openspec/` 已在 `.gitignore`。

## Codex 技能与投影目录

Codex 项目级技能安装在 `.agents/skills/`。当前包含 `agentic-issue-delivery` pack 成员，以及 `repo-entropy-audit`、`control-plane-auditor`。`.agents/skills/` 是运行时投影副本，不作为技能源文件维护；需要更新技能时，从来源仓库重新安装或同步，不要直接在投影目录里做长期修改。

Claude Code 运行时文件位于 `.claude/`。同样把它视为项目运行时配置，不要把临时实验内容混入长期规则。

## Scoped AGENTS 策略

根 `AGENTS.md` 只放跨仓库规则。若 `apps/api/`、`apps/web/`、`apps/graphify-worker/`、`apps/url-fetcher-worker/`、`packages/`、`tests/`、`external/` 等子树需要更细的命令、边界或只读约束，应在对应目录新增 scoped `AGENTS.md`。子目录指令必须比根指令更具体，不能放宽根级核心约束。

## 进度更新

完成重大变更后（BUG 修复、功能实现、测试轮次），更新 `progress.md` 对应章节。保持文件 <200 行。

## 完成回复格式

完成实质性任务后，最终回复默认包含轻量 `Execution Summary`：

`Execution Summary: scope=<...>; files=<...>; verification=<...>; progress=<updated|not-needed>; risks=<...>`

`scope` 写明本次变更范围；`files` 概括关键文件；`verification` 写实际运行的命令或检查；`progress` 写是否更新 `progress.md`；`risks` 写剩余风险，没有则用 `none`。
