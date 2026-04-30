## ADDED Requirements

### Requirement: react-vite-app
MUST react + TypeScript + Vite 应用空壳。

#### Scenario: 开发服务器启动
- **WHEN** 执行 `pnpm --filter web dev`
- **THEN** Vite dev server 启动，浏览器可访问

#### Scenario: 路由骨架
- **WHEN** 访问 /, /login, /chat, /wiki/:spaceId, /admin
- **THEN** 每个路由渲染对应占位页面（至少显示页面名称）

#### Scenario: 404 处理
- **WHEN** 访问未定义路由
- **THEN** 显示 404 页面

> **参考文档**: docs/requirements/04_模块需求_CherryWeb_Chat_Admin.md §2.1（页面清单）、docs/engineering/13_开发规范.md §3（React + TypeScript + Vite）
