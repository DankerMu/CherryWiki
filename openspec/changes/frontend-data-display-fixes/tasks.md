## Tasks

### space-selector-refresh (BUG-002)

- [ ] 1.1 定位前端 Space 创建成功回调位置（Admin Spaces 页面组件）
- [ ] 1.2 在创建成功后通过 AuthProvider 调用 `api.get('/auth/me')` 刷新用户 spaces 列表，触发侧边栏重渲染
- [ ] 1.3 验证选择器从 disabled → enabled 且包含新 Space
- [ ] 1.4 补充前端组件测试：
  - [ ] 1.4.1 创建 Space 成功后 AuthProvider 刷新，选择器显示新 Space
  - [ ] 1.4.2 创建 Space 失败时选择器状态不变
  - [ ] 1.4.3 从 disabled（No spaces）→ enabled 状态转换

### upload-list-display (BUG-003)

- [ ] 2.1 在浏览器 DevTools 中排查 Documents 页面的 Network 请求（确认实际请求 URL 和响应）
- [ ] 2.2 对比前端组件的 API 调用路径与实际 API 端点
- [ ] 2.3 修复根因（可能是请求路径、响应解析或缓存问题）
- [ ] 2.4 验证上传后 Documents 列表正确显示文档
- [ ] 2.5 补充前端组件测试：
  - [ ] 2.5.1 API 返回 total>0 时列表正确渲染文档条目
  - [ ] 2.5.2 API 返回空列表时显示 empty state
  - [ ] 2.5.3 API 出错时显示错误信息

### docmost-bridge-health (BUG-004)

- [ ] 3.1 检查 `apps/api/src/admin/admin-health.controller.ts` 中 Docmost 探测逻辑（当前探测 `${DOCMOST_BASE_URL}/api/health`）
- [ ] 3.2 确认 `DOCMOST_BASE_URL` 环境变量在 docker-compose.yml 中的配置值和 Docker 内部 DNS 可达性
- [ ] 3.3 修复探测 URL 或增加 DOCMOST_BASE_URL 未配置时的优雅降级（返回 Skipped 而非 Unhealthy）
- [ ] 3.4 补充单元测试：
  - [ ] 3.4.1 DOCMOST_BASE_URL 未设置时返回 not_configured + 'DOCMOST_BASE_URL not set'
  - [ ] 3.4.2 DOCMOST_BASE_URL 设置且 Docmost 可达时返回 healthy
  - [ ] 3.4.3 DOCMOST_BASE_URL 设置但 Docmost 不可达时返回 unhealthy + 具体错误
- [ ] 3.5 验证 Health 页面 Docmost Bridge 显示正确状态
