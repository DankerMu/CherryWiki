# 20. Cherry Studio 代码审计

## 1. 审计范围

本审计面向 Cherry Studio Fork：

```text
../cherry-studio/
  src/main/
  src/preload/
  src/renderer/
  packages/aiCore/
  packages/shared/
  packages/mcp-trace/
  packages/ai-sdk-provider/
  packages/extension-table-plus/
```

本审计基于实际源码扫描，数据截至 2026-04-28。

## 2. 代码规模统计

### 2.1 模块行数

| 区域 | 文件数 | LOC | 说明 |
|---|---:|---:|---|
| `src/renderer/` | 1,738 | 244,488 | React 前端 SPA |
| — `pages/` | 486 | 94,224 | 页面组件 |
| — `components/` | 306 | 41,641 | 通用 UI 组件 |
| — `store/` | 34 | 12,220 | Redux Toolkit 28 slices |
| — `utils/` | 115 | 23,722 | 工具函数 |
| — `services/` | 77 | 15,039 | 客户端服务层 |
| — `hooks/` | 88 | 7,750 | React hooks |
| — `aiCore/` (renderer) | 63 | 17,991 | AI 调用（renderer 侧） |
| — `config/` | 34 | 13,932 | 配置 |
| — `其他` | 535 | 17,969 | windows/types/trace/providers/context/i18n/workers/api/queue/databases/tools/handler |
| `src/main/` | 354 | 77,977 | Electron 主进程 |
| — `services/` | 184 | 47,429 | 主进程服务（~20 个） |
| — `mcpServers/` | 55 | 12,284 | MCP Server 管理 |
| — `apiServer/` | 44 | 7,364 | 内置 API 服务 |
| — `utils/` | 28 | 5,847 | 主进程工具 |
| — `knowledge/` | 30 | 2,805 | 本地知识库 |
| `src/preload/` | 2 | 867 | contextBridge 桥接 |
| `packages/aiCore` | 60 | 13,014 | AI SDK 抽象层 |
| `packages/shared` | 26 | 6,719 | 跨进程类型/工具 |
| `packages/mcp-trace` | 14 | 687 | OpenTelemetry MCP 追踪 |
| `packages/ai-sdk-provider` | 3 | 351 | 自定义 AI SDK provider |
| `packages/extension-table-plus` | 22 | 1,682 | TipTap 表格扩展 |
| **合计** | **2,219** | **345,785** | |

### 2.2 Electron API 依赖分布

| 依赖类型 | 命中数 | 影响范围 |
|---|---:|---|
| `ipcRenderer` / `ipcMain` | 728 | renderer ↔ main 通信核心 |
| `window.api`（preload bridge） | 594 | renderer 调用主进程能力 |
| `window.electron` | 64 | 替代 bridge 命名 |
| `from 'electron'` 导入 | 96 | 直接依赖 Electron API |
| `app` | 314 | 应用生命周期 |
| `shell` | 83 | 打开外部链接/文件管理器 |
| `BrowserWindow` | 82 | 多窗口管理 |
| `dialog` | 63 | 文件/消息对话框 |
| `Menu` | 30 | 应用/上下文菜单 |
| `nativeTheme` | 24 | 系统主题检测 |
| `Tray` | 7 | 系统托盘 |
| `fs` in renderer | 0 | **无**（架构干净） |
| `process.env` in renderer | 0 | **无**（安全） |

### 2.3 技术栈识别

| 层面 | 选择 |
|---|---|
| UI 框架 | Ant Design 5.27 + styled-components + TailwindCSS v4 |
| 状态管理 | Redux Toolkit（28 slices）+ Redux Persist + Dexie（IndexedDB） |
| AI SDK | Vercel AI SDK v5（9 个 provider：Anthropic、OpenAI、Google、xAI、Azure、DeepSeek、OpenRouter、OpenAI-Compatible、CherryIn） |
| 流式输出 | Plugin-based middleware pipeline → `streamText()` → AsyncIterable |
| MCP | mcp-trace（OpenTelemetry）+ MCP Server 进程管理（main 进程） |
| 数据库 | Dexie/IndexedDB（renderer） + Drizzle/LibSQL/SQLite（main，agents.db） |
| 国际化 | i18next + react-i18next |
| 构建 | electron-vite + pnpm workspaces |
| 测试 | Vitest + Playwright E2E |
| Lint | oxlint + ESLint 9 + Biome 2 |

## 3. 审计结论与复用评级

| 区域 | LOC | 结论 | 复用等级 |
|---|---:|---|---:|
| `src/renderer/components` | 41,641 | 306 个 UI 组件可迁移，需移除 Electron API、桌面窗口依赖 | A/B |
| `src/renderer/pages` | 94,224 | 页面结构可参考，Chat/设置/知识库/MCP 需按 Web 多用户重构 | B/C |
| `src/renderer/store` | 12,220 | 28 个 Redux slice 可参考；本地持久化和 IPC 调用需替换 | B |
| `src/renderer/services` | 15,039 | 客户端服务需拆分为 Web API client 与服务端 service | B/C |
| `src/main` | 77,977 | Electron 主进程能力不可直接迁移 | C |
| `src/preload` | 867 | Web 端无 preload bridge | C |
| `packages/aiCore` | 13,014 | Provider/runtime 抽象可直接作为服务端模型调用核心 | A/B |
| `packages/shared` | 6,719 | 类型、工具、MCP 类型可作为 shared 种子代码 | A/B |
| `packages/mcp-trace` | 687 | trace-core/trace-web 可复用，trace-node 接入 MCP Gateway | B |

### 复用量估算

| 等级 | 含义 | 估算 LOC | 占比 |
|---|---|---:|---:|
| A（直接复用） | Markdown 渲染、纯 UI 组件、类型定义、aiCore 抽象 | ~30,000 | 8.7% |
| B（适配后复用） | Chat 页面、模型选择、store slices、MCP trace、部分 services | ~60,000 | 17.4% |
| C（需重写） | Electron main/preload、本地 DB、知识库向量化、文件导入、窗口管理 | ~255,000 | 73.9% |

## 3. Renderer 模块审计

| 功能模块 | 原路径候选 | Electron 依赖 | 复用等级 | 迁移建议 |
|---|---|---|---:|---|
| Chat UI | `src/renderer/src/pages/**`, `components/**` | 可能通过 services/store 间接依赖 IPC | B | 拆为 `features/chat`，消息流走 SSE。 |
| 会话管理 | `src/renderer/src/store/**`, `services/**` | 本地存储/IPC 概率高 | B/C | 服务端 conversation/message 表重建，前端只做缓存。 |
| 模型选择 | `src/renderer/src/pages/settings/**`, `aiCore/**` | API key 本地存储 | B | 管理员集中配置 provider，用户选择授权模型。 |
| Markdown 渲染 | `components/**`, `extension-table-plus` | 通常低 | A/B | 可直接迁移，补充 citation anchor、graph path chip。 |
| 设置页 | `pages/settings/**` | 高：本地配置、系统能力 | C | 改为 Admin + User Settings API。 |
| 知识库页 | `pages/**knowledge**`, `services/**` | 高：本地文件、向量化、本地 DB | C | 重写为 Graphify Wiki 管理与只读 Wiki。 |
| MCP 配置 | `shared/mcp.ts`, `packages/mcp-trace/**`, renderer MCP UI | 中/高：本地进程、命令、trace | B/C | UI 可参考，执行层迁移到 MCP Gateway。 |
| WebSearch/Provider | `providers/WebSearchProvider`, `aiCore` | 中 | B | 统一进入服务端 Model Gateway/Tool Gateway。 |

## 4. `packages/aiCore` 审计

### 5.1 架构

基于 Vercel AI SDK v5 的统一 Provider 接口层，包含 provider registry、RuntimeExecutor、plugin engine、streamText/generateText/embedMany。

**支持的 Provider（9 个）：**
Anthropic、OpenAI、Google、xAI、Azure OpenAI、DeepSeek、OpenRouter、OpenAI-Compatible、CherryIn。

**流式输出架构：**
```
streamText(model, params, plugins)
  → PluginEngine.executeStreamWithPlugins()
    → applyPlugins (pre-transform)
    → Vercel AI SDK _streamText()
    → experimental_transform
    → AsyncIterable<TextDelta>
```

| 能力 | LOC | Web 后端复用方式 |
|---|---:|---|
| Provider registry | ~2,000 | 作为 `packages/ai-core` 服务端 provider 抽象 |
| RuntimeExecutor + streamText | ~3,000 | Chat Engine 直接调用，输出 SSE |
| Plugin engine | ~1,500 | logging、tool use、GraphRAG context 注入 |
| 9 provider 初始化 | ~3,000 | 进入管理员模型配置 |
| embedMany | ~500 | 索引 Worker embedding 调用 |
| prompt tool use | ~1,000 | 支持不具备原生 function calling 的模型 |

### 4.2 需适配点

1. 浏览器端不得直接持有 API key。
2. streaming 输出从组件内调用改为服务端 SSE。
3. 插件日志不得泄露 prompt、API key、敏感上下文。
4. tool calling 必须接入平台权限和审计。

## 5. `packages/shared` 审计

| 类型 | 复用建议 |
|---|---|
| AI provider utils | 可进入 `packages/shared/ai`。 |
| `mcp.ts` | 作为 MCP Gateway DTO/类型基础。 |
| `IpcChannel.ts` | 不再作为 IPC channel，改造为 API event enum 或删除。 |
| `agents/claudecode` | 可作为 Code Agent/Graphify CLI 调用参考。 |
| `utils` | 逐项迁移，禁止携带 Electron/Node-only 假设到浏览器。 |
| `__tests__` | 可作为迁移后单元测试参考。 |

## 6. MCP 相关审计

`packages/mcp-trace` 包含 `trace-core`、`trace-node`、`trace-web`：

| 子模块 | 复用等级 | 新位置 | 说明 |
|---|---:|---|---|
| `trace-core` | A/B | `packages/mcp-trace/trace-core` | 作为 MCP trace 通用模型。 |
| `trace-web` | A/B | `apps/web/src/features/mcp-trace` | 用于前端 trace 展示。 |
| `trace-node` | B/C | `apps/mcp-gateway` | 服务端管理 MCP 进程、stdio、HTTP/SSE。 |

Web 端 MCP Gateway 必须支持：

1. 工具注册。
2. Space/Group 工具授权。
3. 调用审计。
4. 超时与取消。
5. stdout/stderr/trace 采集。
6. Graphify MCP 兼容。

## 7. A/B/C 复用清单

### A：直接复用或轻量适配

- Markdown 渲染相关组件。
- 通用 UI 组件。
- 纯类型定义。
- `aiCore` provider/runtime 抽象。
- `mcp-trace/trace-core`。

### B：适配后复用

- Chat 页面组件。
- 模型选择 UI。
- store 切片。
- MCP trace UI。
- 部分服务层代码。
- `shared/mcp.ts`。

### C：重写

- Electron main/preload。
- 本地数据库。
- 本地知识库向量化。
- 本地文件导入。
- 本地 MCP 进程管理。
- 桌面窗口、系统菜单、shell 操作。

## 8. 路径迁移计划

| Step | 操作 | 输出 |
|---|---|---|
| 1 | 抽取 `packages/shared` 可复用类型 | `packages/shared` 初版。 |
| 2 | 抽取 `packages/aiCore` | `packages/ai-core` 服务端调用核心。 |
| 3 | 迁移 Markdown/UI 基础组件 | `apps/web/src/components/cherry`。 |
| 4 | 重建 API client | `packages/api-client`。 |
| 5 | 重构 Chat 页面 | `apps/web/src/features/chat`。 |
| 6 | 重构 Admin/Settings | `apps/admin` 或 `apps/web/src/features/admin`。 |
| 7 | 重构 MCP Gateway | `apps/mcp-gateway`。 |
| 8 | 删除 Electron 假设 | CI 禁止 `ipcRenderer/fs/dialog/shell` 出现在 Web 包。 |

## 9. 审计数据来源

本文件数据基于 2026-04-28 对 `cherry-studio/` 源码的实际扫描（find + wc + grep），非估算。
