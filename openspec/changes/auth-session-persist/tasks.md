# Tasks: auth-session-persist

## auth-bootstrap-refresh

- [x] 1.1 在 AuthProvider 中新增 `isBootstrapping` state（初始 true），mount useEffect 中当无 initialSession 时调用 `refresh()` → `/auth/me` 恢复 session，最终设置 `isBootstrapping = false`
- [x] 1.2 在 App.tsx 路由守卫层添加 bootstrapping 判断：`isBootstrapping` 时渲染全屏 Spin/Loading，不触发重定向
- [x] 1.3 AuthContext value 导出 `isBootstrapping` 字段供外部消费
- [x] 1.4 写单元测试覆盖 REQ-1 三个 scenario（valid cookie → session restored, no cookie → redirect, revoked → redirect）
- [x] 1.5 写单元测试覆盖 REQ-2（bootstrap 期间不重定向）和 REQ-3（login 流程不受影响）
- [x] 1.6 覆盖 bootstrap refresh 401 不触发 API client 全局 onUnauthorized 提前导航，确保重定向仅在 isBootstrapping=false 后由路由守卫处理
- [ ] 1.7 浏览器手工验证：登录 → F5 刷新 → 页面保持登录态，侧边栏折叠状态恢复
