## Why

Phase 1 所有业务模块（Auth、Upload、Graphify、Wiki、Chat）都需要一个 NestJS + Fastify API 宿主。Stage 0 需要先建立 API 骨架，含 /health 端点、统一错误响应、结构化日志，后续 Stage 1+ 在此基础上增加业务模块。

## What Changes

- 创建 `apps/api/` NestJS + Fastify adapter 应用
- 实现 `GET /api/health` 健康检查端点
- 实现统一错误响应 Filter（HttpExceptionFilter），格式 `{ error: { code, message, request_id } }`
- 实现结构化日志中间件（每请求生成 request_id，日志含 request_id / tenant_id / space_id）
- 配置 class-validator + class-transformer 请求校验管道

## Capabilities

### New Capabilities
- `api-health`: GET /api/health 端点，返回 { status, version, uptime }
- `api-error-handling`: 统一错误响应 Filter + ErrorCode 枚举集成
- `api-logging`: 结构化日志中间件，request_id 贯穿全链路

### Modified Capabilities

## Impact

- 新建 apps/api/ 目录（约 10-15 个文件）
- 依赖 CS-0（packages/shared 的 ErrorCode、RequestContext）
- 后续 CS-2（Database）将在此 API 应用中注入 DB 模块

### 实现前必读文档

| 文档路径 | 读取重点 |
|---|---|
| `docs/engineering/13_开发规范.md` §3 | NestJS + Fastify adapter、技术栈确认 |
| `docs/engineering/13_开发规范.md` §4 | TypeScript 规范：strict、class-validator、drizzle-zod |
| `docs/engineering/13_开发规范.md` §6 | API 规范：request_id 必须、错误码大写蛇形、列表分页、软删除 |
| `docs/design/11_API规范.md` §统一响应 | 统一响应结构体（ok/error envelope）、分页格式 |
| `docs/schemas/openapi.yaml` /admin/system/health | health 端点 response schema |
| `docs/ops/docker-compose.skeleton.yml` cherry-api | API 服务环境变量、端口（8080）、healthcheck |
