# CherryWiki Bug 追踪（P0 复测轮次 2026-05-15）

> P0 级功能测试中发现的 bug。修复后勾选并注明修复 commit。

---

## P0 — 阻塞性

### BUG-005: 页面刷新丢失登录状态（AuthProvider 缺少 bootstrap refresh）

- **现象**: 登录后的任何页面，按 F5 或 `location.reload()` 后跳回登录页。在 agent-browser 和用户真实浏览器中均可复现。
- **根因**: `AuthProvider`（`apps/web/src/lib/auth.tsx:72`）初始化时，若无 `initialSession` prop（页面刷新场景），`accessToken` 和 `user` 均为 `null`。没有 useEffect 在 mount 时调用 `POST /api/auth/refresh`（携带 HttpOnly cookie）来恢复 session。路由守卫检测到未认证后立即重定向到 `/login`。
- **复现**:
  1. 正常登录进入任意页面
  2. 按 F5 刷新页面
  3. 页面跳回登录页
- **API 端无问题**: `POST /api/auth/refresh` 配合 HttpOnly cookie 可正常返回新 access_token（API 测试已验证）
- **影响**: P0 阻塞 — 用户每次刷新页面都需重新登录，严重影响可用性
- **修复方向**: 在 `AuthProvider` 的 mount useEffect 中，当 `initialSession` 未提供时，自动调用 `refresh()` 尝试恢复 session。成功则设置 token+user（调用 `/auth/me`），失败则导航到 `/login`。需要添加 `isBootstrapping` 状态避免闪烁。
- **关联文件**: 
  - `apps/web/src/lib/auth.tsx:72-162` — AuthProvider
  - `apps/web/src/App.tsx:141` — AuthProvider 初始化（未传 initialSession）
- **发现日期**: 2026-05-15
- **状态**: [x] 已修复 — AuthProvider bootstrap refresh + `isBootstrapping` 路由守卫 + 回归测试

---

## P1 — 功能缺陷

（暂无）

---

## 已修复（本轮）

- BUG-005: 页面刷新丢失登录状态 → 当前分支：bootstrap refresh + route guard loading ✅

## 已修复（上一轮）

- BUG-001: cookie Secure 标志 → `ae11d58` ✅
- BUG-002: Space 选择器刷新 → `eb85819` ✅
- BUG-003: 文档列表不显示 → `b698f10` ✅
- BUG-004: Docmost Bridge Unhealthy → `19c40fa` + `.env` 修复 ✅

---

## P0 测试进度记录（2026-05-15）

### §1 认证与用户管理

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §1.1 登录成功 | ✅ PASS | admin 登录跳转 Overview |
| §1.1 refresh_token HttpOnly cookie | ✅ PASS | 无 Secure 标志，HttpOnly; SameSite=Lax |
| §1.1 错误密码 | ✅ PASS | 已在上轮验证 |
| §1.2 登出清除 cookie | ✅ PASS | Set-Cookie Max-Age=0 |
| §1.2 登出后 token 失效 | ✅ PASS | TOKEN_REVOKED |
| §1.3 Token 刷新（valid cookie） | ✅ PASS | 200 OK + 新 access_token |
| §1.3 Token 刷新（invalid cookie） | ✅ PASS | 401 |
| §1.4 GET /auth/me | ✅ PASS | 返回 role/groups/spaces |
| §1.4 未登录 /auth/me | ✅ PASS | 401 |
| §1.x 页面刷新保持 session | ✅ PASS | BUG-005 已修复，新增 auth bootstrap 回归测试 |

### §2 Space 管理

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §2.1 创建 Space | ✅ PASS | |
| §2.1 Space 选择器更新 | ✅ PASS | BUG-002 已修复 |
| §2.2 Overview stats | ✅ PASS | Documents=1, Wiki=0, Nodes=0, Edges=0 |
| §2.2 Knowledge Status | ✅ PASS | Index consistency Healthy, Strict mode Enabled |
| §2.2 Recent Documents | ✅ PASS | test-knowledge.md 显示 |
| §2.2 Quick actions | ✅ PASS | 6 个按钮路由正确 |

### §3 文档上传与解析

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §3.1 上传 Markdown | ✅ PASS | API 验证通过 |
| §3.1 文档列表 UI 显示 | ✅ PASS | BUG-003 已修复，1016B/Graphify Pending |
| §3.4 Ingestion 解析 | ✅ PASS | status=graphify_pending, parsed_uri 存在 |

### §4 知识图谱

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §4.3 Graph Explorer | ✅ PASS | 空状态正确，有搜索/Communities/Legend |

### §5 Wiki 管理

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §5.1 Wiki 页面列表 | ✅ PASS | 空状态 + 搜索/过滤 |

### §7 Chat（RAG）

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §7.1 Chat 页面布局 | ✅ PASS | New Chat/input/Deep Analysis/Retrieval mode |
| §7.1 发送消息获得回答 | ✅ PASS | SSE 流完成，fallback 响应（strict mode） |
| §7.5 多轮对话 | ✅ PASS | 同一 session 两轮 Q&A |
| §7.5 Session 历史 | ✅ PASS | 左侧列表显示 session |

### §8 Model 配置

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §8.1 Chat Model 显示 | ✅ PASS | 上轮验证 |
| §8.3 Embedding Model | ✅ PASS | 上轮验证 |

### §9 管理后台

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §9.2 Health 全组件 | ✅ PASS | 6 组件 Healthy，BUG-004 已修复 |

### §10 UI/UX

| 测试项 | 结果 | 备注 |
|--------|------|------|
| §10.3 侧边栏折叠/展开 | ✅ PASS | icon 导航可用 |
| §10.3 折叠跨刷新保持 | ⚠️ 被 BUG-005 阻塞 | localStorage 有存储但刷新回到登录页 |
