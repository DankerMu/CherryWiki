## Context

前端使用 React + TypeScript + Vite（docs/engineering/13_开发规范.md §3）。Cherry Web 和 Admin Console 合并为单一 apps/web 应用（docs/engineering/13_开发规范.md §2 已更新）。Stage 0 只做空壳和路由，不含业务组件。

## Goals / Non-Goals

**Goals:**
- Vite + React 18 + TypeScript 应用可启动
- react-router 路由骨架含所有 Phase 1 页面路径
- Vite dev proxy 可代理 /api 到后端

**Non-Goals:**
- 不选型 UI 组件库——由 Stage 1 Login 页面时决定
- 不实现状态管理——由 Stage 1+ 业务需求驱动
- 不实现任何业务页面组件

## Decisions

1. **路由**：react-router v7，路由占位路径：/, /login, /chat, /chat/:id, /wiki/:spaceId, /wiki/:spaceId/:pageId, /admin, /admin/users, /admin/spaces, /admin/models, /admin/jobs, /admin/audit
2. **Proxy**：vite.config.ts server.proxy /api → http://localhost:8081
3. **Shell 页面**：每个路由渲染 `<h1>Page Name</h1>` 占位
4. **目录结构**：src/pages/（按路由分目录）、src/components/（空）、src/lib/（空）

## Risks / Trade-offs

- 路由路径后续可能调整，但空壳阶段成本极低
- 不提前选 UI 库可能导致 Stage 1 需要额外 changeset，但避免了 Stage 0 引入不必要的复杂度
