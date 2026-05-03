## Why

Upload API、安全校验管线、ingestion-worker 和 url-fetcher-worker 构成了完整的后端处理链路，但用户目前没有界面来上传文件、查看处理状态和管理上传资料。上传中心是 Cherry Web 中面向普通用户的核心页面之一，是整个知识生产链路的前端入口。根据 `docs/requirements/07_模块需求_资料上传归档解析.md` §3.1，上传中心需要支持拖拽上传、Space 选择、元数据填写、处理策略选择和任务状态查看。

## What Changes

- 在 Cherry Web 中新增上传中心页面（Space 级别）
- 实现拖拽+点击文件上传组件，支持多文件上传
- 实现 URL 上传表单
- 实现上传列表：按 Space 筛选，显示文件名/类型/大小/状态/上传时间
- 实现上传详情：元数据查看、处理状态进度、错误信息展示
- 实现重新处理操作（parse_failed 文件可重试）
- 实现轮询刷新：processing 中的文件定时拉取最新状态

## Capabilities

### New Capabilities

- `upload-center-page`: 上传中心页面，文件/URL 上传、上传列表、状态查看、重处理操作
- `upload-file-component`: 拖拽+点击文件上传组件，multipart 上传、进度条、多文件支持

### Modified Capabilities

(无已有 spec 需要修改)

## Impact

- **apps/web/**: 新增上传中心页面和上传组件
- **路由**: 新增 `/spaces/{space_id}/uploads` 页面路由
- **API 调用**: 调用 Upload API 的 4 个端点
- **侧边栏**: 在 Space 导航中添加"上传中心"菜单项
- **依赖**: 可能新增 `react-dropzone`（拖拽上传）
