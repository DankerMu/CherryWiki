## 1. 前置：阅读文档

- [ ] 1.1 阅读 `docs/engineering/13_开发规范.md` §3（NestJS + Fastify）§6（API 规范：request_id、错误码格式）
- [ ] 1.2 阅读 `docs/design/11_API规范.md` 统一响应结构体（ok/error envelope、分页格式）
- [ ] 1.3 阅读 `docs/schemas/openapi.yaml` /admin/system/health 端点定义
- [ ] 1.4 阅读 `docs/ops/docker-compose.skeleton.yml` cherry-api 服务定义（端口 8080、环境变量）

## 2. NestJS 应用初始化

- [ ] 2.1 创建 `apps/api/package.json`（依赖 @nestjs/core、@nestjs/platform-fastify、pino、pino-http）
- [ ] 2.2 创建 `apps/api/tsconfig.json`（extends tsconfig.base.json）
- [ ] 2.3 创建 `apps/api/src/main.ts`（NestJS bootstrap + Fastify adapter，监听 8080）
- [ ] 2.4 创建 `apps/api/src/app.module.ts`（AppModule）

## 3. Health 端点

- [ ] 3.1 创建 `apps/api/src/health/health.controller.ts`（GET /api/health → { status, version, uptime }）
- [ ] 3.2 创建 `apps/api/src/health/health.module.ts`
- [ ] 3.3 在 AppModule 注册 HealthModule

## 4. 统一错误处理

- [ ] 4.1 创建 `apps/api/src/common/filters/http-exception.filter.ts`（全局 ExceptionFilter）
  - HttpException → { error: { code: ErrorCode, message, request_id } }
  - 未知异常 → 500 + INTERNAL_ERROR，详情只写日志
  - ValidationError → 422 + VALIDATION_ERROR + details
- [ ] 4.2 在 main.ts 注册全局 Filter

## 5. 结构化日志

- [ ] 5.1 创建 `apps/api/src/common/logger/logger.module.ts`（pino + pino-http 集成）
- [ ] 5.2 创建 `apps/api/src/common/middleware/request-context.middleware.ts`
  - onRequest hook 生成 UUID v4 request_id（或接受 X-Request-Id header）
  - AsyncLocalStorage 存储 RequestContext
- [ ] 5.3 日志输出格式：JSON，含 request_id、method、url、status_code、duration_ms

## 6. 请求校验

- [ ] 6.1 在 main.ts 配置全局 ValidationPipe（whitelist: true, forbidNonWhitelisted: true, transform: true）

## 7. 验证

- [ ] 7.1 `pnpm --filter api dev` 启动成功
- [ ] 7.2 `curl http://localhost:8080/api/health` 返回 200 + 正确结构
- [ ] 7.3 请求日志含 request_id
- [ ] 7.4 访问不存在路由返回 { error: { code: "NOT_FOUND", ... } }
- [ ] 7.5 发送非法 body 返回 { error: { code: "VALIDATION_ERROR", ... } }
