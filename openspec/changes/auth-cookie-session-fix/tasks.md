## Tasks

### cookie-secure-env

- [ ] 1.1 修改 `apps/api/src/auth/auth.controller.ts` 中 `setRefreshCookie` 函数，将硬编码 `Secure` 改为根据 `COOKIE_SECURE` 环境变量和 `NODE_ENV` 动态决定
- [ ] 1.2 同步修改 `clearRefreshCookie` 函数使用相同的 Secure 策略
- [ ] 1.3 在 `docker-compose.yml` 的 cherry-api 服务中添加 `COOKIE_SECURE: "false"`
- [ ] 1.4 在 `.env.example` 中添加 `COOKIE_SECURE` 变量说明
- [ ] 1.5 补充 `apps/api/src/auth/__tests__/` 中 cookie 属性的单元测试：
  - [ ] 1.5.1 REQ-1 Scenario 1: NODE_ENV=production 且未设 COOKIE_SECURE → cookie 包含 Secure
  - [ ] 1.5.2 REQ-1 Scenario 2: NODE_ENV=production 且 COOKIE_SECURE=true → cookie 包含 Secure
  - [ ] 1.5.3 REQ-1 Scenario 3: NODE_ENV=development → cookie 不包含 Secure
  - [ ] 1.5.4 REQ-1 Scenario 4: COOKIE_SECURE=false（任意 NODE_ENV）→ cookie 不包含 Secure
  - [ ] 1.5.5 REQ-2: clearRefreshCookie 的 Secure 策略与 setRefreshCookie 一致（至少 2 个 scenario）
- [ ] 1.6 手动验证：HTTP 环境下登录后刷新页面不跳回登录页
