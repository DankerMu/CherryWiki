# auth-bootstrap-refresh

AuthProvider mount 阶段 silent token refresh 和 session 恢复。

## ADDED Requirements

### Requirement: 页面刷新后自动恢复 session

AuthProvider MUST automatically call the refresh endpoint during mount when no initialSession prop is provided, and SHALL restore authenticated state from the returned access token and user profile. Endpoint references in this requirement use the web client path, which resolves to `/api/*` HTTP paths.

#### Scenario: 有效 refresh_token cookie 存在时恢复 session

- WHEN 用户刷新页面且浏览器持有有效的 HttpOnly refresh_token cookie
- THEN AuthProvider 调用 `POST /auth/refresh`
- AND 使用返回的 access_token 调用 `GET /auth/me` 获取用户信息
- AND 设置 accessToken 和 user state
- AND 调度 scheduleRefresh 定时器
- AND isBootstrapping 变为 false

#### Scenario: 无 refresh_token cookie 时跳转登录

- WHEN 用户刷新页面且浏览器无 refresh_token cookie（首次访问或 cookie 已过期）
- THEN AuthProvider 调用 `POST /auth/refresh` 收到 401
- AND the global API unauthorized handler does not navigate before bootstrap completes
- AND isBootstrapping 变为 false
- AND accessToken 和 user 保持 null
- AND 路由守卫检测到未认证，重定向到 /login

#### Scenario: refresh_token 已被 revoke 时跳转登录

- WHEN 用户刷新页面且 refresh_token cookie 存在但已被 revoke（登出后）
- THEN AuthProvider 调用 `POST /auth/refresh` 收到 401 REFRESH_TOKEN_REVOKED
- AND the global API unauthorized handler does not navigate before bootstrap completes
- AND isBootstrapping 变为 false
- AND 重定向到 /login

### Requirement: Bootstrap 期间显示 loading 而非闪烁登录页

Protected routes MUST render a full-screen loading indicator while authentication bootstrap is in progress and SHALL NOT redirect to login until bootstrap completes.

#### Scenario: bootstrap 进行中不触发重定向

- WHEN isBootstrapping 为 true
- THEN 受保护路由显示全屏 loading 指示器
- AND 不触发任何导航/重定向，包括 API client 全局 onUnauthorized 导航

#### Scenario: bootstrap 完成后正常路由

- WHEN isBootstrapping 变为 false 且 isAuthenticated 为 true
- THEN 受保护路由正常渲染目标页面
- AND 侧边栏折叠状态从 localStorage 恢复

### Requirement: 与现有 login 流程兼容

AuthProvider MUST preserve the existing login flow and SHALL treat initialSession as authoritative without issuing a bootstrap refresh.

#### Scenario: 正常登录不受影响

- WHEN 用户从 /login 页面输入凭证登录
- THEN 登录流程与之前一致（login callback 设置 token + user）
- AND bootstrap useEffect 不会与 login 冲突（login 页面不在保护路由内）

#### Scenario: login 页面存在有效 refresh cookie

- WHEN 用户直接访问 /login 且浏览器持有有效的 HttpOnly refresh_token cookie
- THEN AuthProvider 可在后台执行 silent refresh 并恢复内存 session
- AND Login 页面不自动跳转
- AND 用户提交登录表单后仍按现有 login 流程导航

#### Scenario: initialSession prop 优先

- WHEN AuthProvider 接收到 initialSession prop（未来 SSR 场景）
- THEN 直接使用 initialSession，不触发 refresh 调用
- AND isBootstrapping 立即为 false
