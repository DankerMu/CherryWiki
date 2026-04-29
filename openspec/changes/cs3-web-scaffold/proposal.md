## Why

CherryGraph Studio 的用户入口是 Cherry Web（含 Admin Console）。Stage 0 需要建立前端空壳和路由骨架，后续 Stage 1+（Login、Chat、Wiki、Admin 页面）在此基础上增量开发。

## What Changes

- 创建 `apps/web/` React + TypeScript + Vite 应用
- 配置 Vite dev proxy（/api → localhost:8081）
- 建立基础路由骨架（react-router：/, /login, /chat, /wiki, /admin）
- 空 Shell 页面（App.tsx 显示项目名称）
- 不含任何业务组件或 UI 库

## Capabilities

### New Capabilities
- `web-shell`: React + Vite 空壳应用 + 路由骨架
- `web-proxy`: Vite dev proxy 到 API 服务

### Modified Capabilities

## Impact

- 新建 apps/web/ 目录（约 8-10 个文件）
- 依赖 CS-0（monorepo workspace 配置）
- 可与 CS-1、CS-2、CS-4 并行开发
- 后续 Stage 1 在此基础上添加 Login 页面

### 实现前必读文档

| 文档路径 | 读取重点 |
|---|---|
| `docs/engineering/13_开发规范.md` §3 | React + TypeScript + Vite 选型确认 |
| `docs/requirements/04_模块需求_CherryWeb_Chat_Admin.md` §2.1 | 基础页面清单（仅做路由占位，不实现功能） |
| `docs/ops/docker-compose.skeleton.yml` cherry-web | 前端服务端口（80）、依赖 cherry-api |
