## Context

API 后端使用 NestJS + Fastify adapter（docs/engineering/13_开发规范.md §3），与 Docmost Fork 技术栈统一。API 规范要求所有请求有 request_id、错误码大写蛇形、列表分页（docs/engineering/13_开发规范.md §6）。统一响应结构在 docs/design/11_API规范.md 中定义。

## Goals / Non-Goals

**Goals:**
- NestJS + Fastify 应用可启动
- /api/health 返回 { status: "healthy", version, uptime }
- 统一错误 Filter 捕获所有异常，返回 { error: { code, message, request_id } }
- 结构化日志含 request_id、tenant_id、space_id

**Non-Goals:**
- 不实现任何业务模块（Auth、Upload、Chat 等）
- 不连接数据库——由 CS-2 负责
- 不实现认证中间件——由 Stage 1 负责

## Decisions

1. **Fastify adapter**：使用 @nestjs/platform-fastify，性能优于 Express，与 Docmost 统一
2. **Health 端点**：不依赖 @nestjs/terminus，简单 controller 即可（Stage 0 无外部依赖需检查）
3. **错误 Filter**：全局 ExceptionFilter，拦截 HttpException + 未知异常，统一格式输出
4. **request_id**：Fastify hook onRequest 阶段生成 UUID v4，注入到 request 对象和 AsyncLocalStorage
5. **日志库**：pino（Fastify 原生集成），结构化 JSON 输出，字段含 request_id / tenant_id / space_id / job_id
6. **校验管道**：全局 ValidationPipe（class-validator + class-transformer），whitelist + forbidNonWhitelisted

## Risks / Trade-offs

- AsyncLocalStorage 有微量性能开销，但对正确传递 request_id 至关重要
- pino 默认 JSON 格式在开发时可读性差，可通过 pino-pretty 开发环境适配
