## 1. 前置：阅读文档

- [x] 1.1 阅读 `docs/engineering/13_开发规范.md` §3（NestJS + Fastify）§6（API 规范：request_id、错误码格式）
- [x] 1.2 阅读 `docs/design/11_API规范.md` 统一响应结构体（ok/error envelope、分页格式）
- [x] 1.3 阅读 `docs/schemas/openapi.yaml` /admin/system/health 端点定义
- [x] 1.4 阅读 `docs/ops/docker-compose.skeleton.yml` cherry-api 服务定义（端口 8080、环境变量）

## 2. NestJS 应用初始化

- [x] 2.1 创建 `apps/api/package.json`（依赖 @nestjs/core、@nestjs/platform-fastify、pino、pino-http）
- [x] 2.2 创建 `apps/api/tsconfig.json`（extends tsconfig.base.json）
- [x] 2.3 创建 `apps/api/src/main.ts`（NestJS bootstrap + Fastify adapter，监听 8080）
- [x] 2.4 创建 `apps/api/src/app.module.ts`（AppModule）

## 3. Health 端点

- [x] 3.1 创建 `apps/api/src/health/health.controller.ts`（GET /api/health → { status, version, uptime }）
- [x] 3.2 创建 `apps/api/src/health/health.module.ts`
- [x] 3.3 在 AppModule 注册 HealthModule

## 4. 统一错误处理

- [x] 4.1 创建 `apps/api/src/common/filters/http-exception.filter.ts`（全局 ExceptionFilter）
  - HttpException → { error: { code: ErrorCode, message, request_id } }
  - 未知异常 → 500 + INTERNAL_ERROR，详情只写日志
  - ValidationError → 422 + VALIDATION_ERROR + details
- [x] 4.2 在 main.ts 注册全局 Filter

## 5. 结构化日志

- [x] 5.1 创建 `apps/api/src/common/logger/logger.module.ts`（pino + pino-http 集成）
- [x] 5.2 创建 `apps/api/src/common/middleware/request-context.middleware.ts`
  - onRequest hook 生成 UUID v4 request_id（或接受 X-Request-Id header）
  - AsyncLocalStorage 存储 RequestContext
- [x] 5.3 日志输出格式：JSON，含 request_id、method、url、status_code、duration_ms

## 6. 请求校验

- [x] 6.1 在 main.ts 配置全局 ValidationPipe（whitelist: true, forbidNonWhitelisted: true, transform: true）

## 7. 自动化测试

### 7.1 Health 端点测试 (`apps/api/src/health/__tests__/health.controller.test.ts`)

- [x] 7.1.1 GET /api/health 返回 200 + `{ status: "healthy", version, uptime }`
- [x] 7.1.2 返回的 version 与 package.json version 一致
- [x] 7.1.3 uptime 为正整数

### 7.2 错误处理测试 (`apps/api/src/common/filters/__tests__/http-exception.filter.test.ts`)

- [x] 7.2.1 HttpException(404) → `{ error: { code: "NOT_FOUND", message, request_id } }` + status 404
- [x] 7.2.2 HttpException(403) → `{ error: { code: "PERMISSION_DENIED", ... } }` + status 403
- [x] 7.2.3 未知异常 → 500 + `{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }`，不暴露堆栈
- [x] 7.2.4 ValidationPipe 校验失败 → 422 + `{ error: { code: "VALIDATION_ERROR", details } }`
- [x] 7.2.5 所有错误响应包含 request_id 字段

### 7.3 请求上下文测试 (`apps/api/src/common/middleware/__tests__/request-context.test.ts`)

- [x] 7.3.1 无 X-Request-Id header 时自动生成 UUID v4 格式 request_id
- [x] 7.3.2 携带 X-Request-Id header 时使用该值
- [x] 7.3.3 request_id 在响应 header 中回传

### 7.4 结构化日志测试

- [x] 7.4.1 请求日志包含 request_id、method、url、status_code、duration_ms
- [x] 7.4.2 日志格式为 JSON

### 7.5 集成验证

- [x] 7.5.1 `pnpm --filter api build` 编译成功
- [x] 7.5.2 不存在路由返回统一错误格式
- [x] 7.5.3 非法 body 返回 VALIDATION_ERROR
