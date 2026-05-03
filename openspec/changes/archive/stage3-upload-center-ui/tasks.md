## 1. API 层补充

- [x] 1.1 在 Upload API 中追加 GET /api/spaces/:spaceId/uploads 列表端点（分页 + status 筛选）
- [x] 1.2 编写列表端点单元测试

## 2. 路由与导航

- [x] 2.1 在 React Router 中添加 /spaces/:spaceId/uploads 路由
- [x] 2.2 在 Space 侧边栏导航中添加"上传中心"菜单项（FileUp 图标）
- [x] 2.3 权限检查：无 Space 读权限时重定向到 403

## 3. 文件上传组件

- [x] 3.1 安装 react-dropzone 依赖
- [x] 3.2 实现 FileUploadZone 组件：拖拽区域 + 点击选择 + 多文件支持
- [x] 3.3 实现前端文件类型校验（扩展名白名单）
- [x] 3.4 实现前端文件大小校验（>200MB 拒绝）
- [x] 3.5 实现 multipart 上传 + 进度条（XMLHttpRequest onprogress）
- [x] 3.6 实现上传结果反馈：成功显示 ✓，失败显示错误信息
- [x] 3.7 显示支持文件类型和大小限制提示文字

## 4. URL 上传表单

- [x] 4.1 实现 URL 输入框 + "添加 URL" 按钮
- [x] 4.2 实现前端 URL 格式校验（仅 http/https）
- [x] 4.3 提交后调用 POST /api/spaces/:spaceId/uploads (source_type=url)
- [x] 4.4 提交成功后在列表中添加新条目

## 5. 上传列表

- [x] 5.1 实现 UploadList 组件：表格展示 filename/type/size/status/uploader/time/actions
- [x] 5.2 实现状态颜色标签：蓝色(处理中)/绿色(完成)/红色(失败)
- [x] 5.3 实现分页组件（每页 20 条）
- [x] 5.4 实现空状态提示

## 6. 上传详情

- [x] 6.1 实现 UploadDetail 组件（侧边抽屉或模态框）：完整元数据展示
- [x] 6.2 展示处理进度（progress_percent + stage 标签）
- [x] 6.3 展示失败详情（error_type + error_message）
- [x] 6.4 实现"重新处理"按钮（仅 parse_failed 状态可见），调用 POST /api/uploads/:id/reprocess

## 7. 状态轮询

- [x] 7.1 实现轮询 hook（useUploadPolling）：当列表有 processing 状态文件时每 5s 刷新
- [x] 7.2 批量状态查询优化：一次请求获取多个文件状态
- [x] 7.3 所有文件到达终态后停止轮询
- [x] 7.4 页面离开/切换 Space 时清理轮询

## 8. UI 测试

- [x] 8.1 编写 FileUploadZone 组件单元测试（拖拽、点击、类型校验、大小校验）
- [x] 8.2 编写 UploadList 组件单元测试（状态标签渲染、分页、空状态）
- [x] 8.3 编写 UploadDetail 组件单元测试（详情展示、重处理按钮）
- [x] 8.4 编写 URL 上传表单单元测试（URL 校验、提交）
