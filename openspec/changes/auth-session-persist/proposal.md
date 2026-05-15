## Why

页面刷新后登录状态丢失（BUG-005, P0）。access_token 仅存内存，刷新后 React state 重置，前端 AuthProvider 没有 bootstrap 逻辑用 HttpOnly refresh_token cookie 调用 `POST /api/auth/refresh` 恢复 session。用户每次刷新都需重新登录，严重影响可用性。

## What Changes

- AuthProvider mount 时自动尝试 silent refresh（用 HttpOnly cookie 调用 `POST /auth/refresh`）
- 新增 `isBootstrapping` 加载态，避免刷新瞬间闪烁登录页
- refresh 成功后调用 `/auth/me` 恢复用户信息和 Space 列表
- refresh 失败（无 cookie / expired / revoked）时正常导航到 `/login`
- 路由守卫在 bootstrap 期间显示 loading 而非重定向

## Capabilities

### New Capabilities
- `auth-bootstrap-refresh`: AuthProvider mount 阶段的 silent token refresh 和 session 恢复逻辑

### Modified Capabilities

（无已有 spec 需要修改）

## Impact

- `apps/web/src/lib/auth.tsx` — AuthProvider 核心改动
- `apps/web/src/App.tsx` — 可能需要在路由守卫层处理 bootstrapping 状态
- 无 API 端改动，`POST /auth/refresh` 已正常工作
- 无数据库变更
- 无 breaking change
