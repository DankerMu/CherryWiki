## 1. 前置：阅读文档

- [ ] 1.1 阅读 `docs/engineering/13_开发规范.md` §3（React + TypeScript + Vite）
- [ ] 1.2 阅读 `docs/requirements/04_模块需求_CherryWeb_Chat_Admin.md` §2.1（基础页面清单）
- [ ] 1.3 阅读 `docs/ops/docker-compose.skeleton.yml` cherry-web 服务定义（端口 80）

## 2. Vite + React 初始化

- [ ] 2.1 创建 `apps/web/package.json`（依赖 react、react-dom、react-router、typescript、vite）
- [ ] 2.2 创建 `apps/web/tsconfig.json`（extends tsconfig.base.json）
- [ ] 2.3 创建 `apps/web/vite.config.ts`（React plugin + server.proxy /api → http://localhost:8081）
- [ ] 2.4 创建 `apps/web/index.html`
- [ ] 2.5 创建 `apps/web/src/main.tsx`（React 入口）

## 3. 路由骨架

- [ ] 3.1 创建 `apps/web/src/App.tsx`（BrowserRouter + Routes）
- [ ] 3.2 创建占位页面组件：
  - src/pages/Home.tsx（/）
  - src/pages/Login.tsx（/login）
  - src/pages/Chat.tsx（/chat, /chat/:id）
  - src/pages/Wiki.tsx（/wiki/:spaceId, /wiki/:spaceId/:pageId）
  - src/pages/Admin.tsx（/admin, /admin/users, /admin/spaces, /admin/models, /admin/jobs, /admin/audit）
  - src/pages/NotFound.tsx（*）
- [ ] 3.3 每个占位页面渲染 `<h1>页面名称</h1>`

## 4. 目录结构

- [ ] 4.1 创建空目录：src/components/、src/lib/

## 5. 验证

- [ ] 5.1 `pnpm --filter web dev` 启动成功
- [ ] 5.2 浏览器访问首页可见项目名称
- [ ] 5.3 各路由显示对应占位页面
- [ ] 5.4 访问 /api/health 代理到后端返回结果（需 CS-1 API 运行）
