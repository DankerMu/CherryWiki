## Technical Approach

单组件改动，集中在 `AuthProvider`。不涉及 API 端修改。

### 方案：useEffect bootstrap + isBootstrapping 状态

在 AuthProvider 中新增 `isBootstrapping` state（初始值 `true`）。mount useEffect 中：

1. 如果 `initialSession` 已提供（SSR 场景），直接设置 token/user，`isBootstrapping = false`
2. 否则调用 `refresh()`（client path `POST /auth/refresh`，HTTP path `POST /api/auth/refresh`，浏览器自动携带 HttpOnly cookie）
   - 成功：设置 accessToken → 调用 `/auth/me` 设置 user → `isBootstrapping = false`
   - 失败：`isBootstrapping = false`，保持 null state，路由守卫正常重定向到 /login

bootstrap 期间 `POST /auth/refresh` 的预期 401（无 cookie / expired / revoked）必须由 bootstrap 本地处理，不能触发 API client 的全局 `onUnauthorized` 提前导航到 `/login`。可通过 bootstrap-aware unauthorized handler 或等价机制实现；bootstrap 完成后仍由现有路由守卫执行 `/login` 重定向。

### 路由守卫处理

`isAuthenticated` 判断增加 bootstrapping 守卫：
- `isBootstrapping === true` 时：显示全屏 loading（Spin 组件），不触发重定向
- `isBootstrapping === false && !isAuthenticated` 时：重定向到 /login
- `isBootstrapping === false && isAuthenticated` 时：正常渲染

AuthProvider 包裹整个 SPA，因此 `/login` 页面也会执行 silent refresh。若 `/login` 上存在有效 refresh cookie，AuthProvider 可恢复内存 session，但 Login 页面本身不需要自动跳转；后续用户提交登录表单仍按现有流程设置 token/user 并导航。

### 备选方案（已排除）

- **localStorage 持久化 access_token**：违反安全最佳实践，XSS 可窃取 token
- **SSR bootstrap**：当前为纯 SPA，引入 SSR 成本过高

## Risks

| 风险 | 缓解 |
|------|------|
| 刷新期间短暂 loading 闪烁 | refresh 调用通常 <100ms（本地网络），loading 几乎不可感知 |
| 竞态：bootstrap refresh 与手动 login 同时发生 | login 页面不在 AuthProvider 保护的路由内，不会冲突 |
| refresh 401 被全局 unauthorized handler 提前重定向 | bootstrap 期间 suppress/ignore 全局 unauthorized 导航，由 route guard 在 isBootstrapping=false 后统一处理 |
| refresh 失败导致无限重定向 | refresh 失败时设置 isBootstrapping=false，一次性逻辑不会循环 |
