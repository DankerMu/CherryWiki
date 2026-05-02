## Context

Cherry Web 已有 Space 管理页面、管理后台（用户管理、Group 管理、审计日志、任务中心）。前端使用 React + TypeScript，路由使用 React Router，样式遵循 CherryStudio 对齐的 UI 主题（ui-theme-cherrystudio-align change）。已有 shadcn/ui 组件基础。

上传中心是 Space 级别的页面（用户进入某个 Space 后操作），与管理后台的任务中心（全局 admin 视角）互补。

## Goals / Non-Goals

**Goals:**

- 提供文件拖拽+点击上传能力
- 提供 URL 提交上传能力
- 展示当前 Space 下所有上传资料的列表和状态
- 支持查看上传详情和错误信息
- 支持重处理失败的文件
- 处理中的文件状态自动刷新

**Non-Goals:**

- 管理后台批量导入功能 — Phase 2
- Docmost 附件同步 UI — Phase 2
- 文件预览/在线查看 — Phase 2
- 上传资料的搜索/全文检索 — Phase 2

## Decisions

### D1: 页面路由

**选择**: `/spaces/:spaceId/uploads` 作为上传中心页面路由。在 Space 导航侧边栏中添加"上传中心"菜单项（图标: Upload/FileUp）。

**理由**: 上传是 Space 级操作，路由层级在 Space 下自然。

### D2: 上传组件

**选择**: 使用 `react-dropzone` 实现拖拽区域，同时支持点击选择文件。上传使用 fetch + FormData（multipart/form-data），配合 XMLHttpRequest 的 progress 事件显示上传进度。

**理由**: react-dropzone 是最成熟的 React 拖拽上传库。原生 fetch 的 progress 支持通过 ReadableStream 实现，或使用 XMLHttpRequest 的 onprogress 事件。

**替代方案**: antd Upload 组件 — 但项目使用 shadcn/ui，不引入 antd。

### D3: 上传列表

**选择**: 表格形式展示当前 Space 的上传列表，调用 `GET /api/uploads?space_id=xxx` 分页查询（需在 Upload API 中扩展列表端点）。列：文件名、类型、大小、状态、上传者、上传时间、操作。

状态用颜色标签区分：
- 蓝色: uploaded/archived/parsing（处理中）
- 绿色: parsed（完成）
- 红色: parse_failed/security_rejected（失败）
- 灰色: graphify_pending/graphify_running（下游处理中）

**理由**: 表格是最直观的列表展示方式，状态颜色便于快速识别。

### D4: 状态轮询

**选择**: 当列表中有 uploaded/archived/parsing 状态的文件时，每 5 秒轮询一次 `GET /api/uploads/:id/status` 更新状态。所有文件都到达终态后停止轮询。

**理由**: 5s 间隔在用户体验和 API 负载间取平衡。无需 WebSocket，SSE 可在 Phase 2 优化。

**替代方案**: WebSocket/SSE — 实现复杂度高，Phase 1 轮询即可。

### D5: URL 上传表单

**选择**: 在上传区域下方提供 URL 输入框 + "添加 URL" 按钮。支持粘贴 URL 后回车提交。提交前做前端 URL 格式校验（http/https only）。

**理由**: URL 上传频率低于文件上传，独立输入框比混合在拖拽区域更清晰。

## Risks / Trade-offs

- **[R1] 大文件上传超时** → 200MB 文件上传耗时长。Mitigation: 显示上传进度条，提示用户等待。Phase 2 可增加分片上传。
- **[R2] 上传列表端点缺失** → Upload API change 1 没有列表端点。Mitigation: 需要在 API 层追加 `GET /api/spaces/:spaceId/uploads` 列表端点（或在 UI change 的任务中包含）。
- **[R3] 状态轮询负载** → 大量文件同时处理时频繁轮询。Mitigation: 只轮询 processing 状态的文件，批量查询优化。
