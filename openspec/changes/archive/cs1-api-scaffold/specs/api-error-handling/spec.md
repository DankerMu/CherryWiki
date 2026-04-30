## ADDED Requirements

### Requirement: unified-error-response
MUST 全局 ExceptionFilter 统一所有错误响应格式。

#### Scenario: 已知 HTTP 异常
- **WHEN** 业务代码抛出 HttpException（如 NotFoundException）
- **THEN** 返回 `{ error: { code: "NOT_FOUND", message: "...", request_id: "<uuid>" } }`

#### Scenario: 未知异常
- **WHEN** 业务代码抛出非 HttpException 异常
- **THEN** 返回 500 + `{ error: { code: "INTERNAL_ERROR", message: "Internal server error", request_id: "<uuid>" } }`
- **THEN** 异常详情只写入日志，不暴露给客户端

#### Scenario: 校验失败
- **WHEN** 请求 body 不满足 class-validator 校验规则
- **THEN** 返回 422 + `{ error: { code: "VALIDATION_ERROR", message: "...", details: [...], request_id: "<uuid>" } }`

> **参考文档**: docs/design/11_API规范.md（统一响应结构）、docs/engineering/13_开发规范.md §6（错误码大写蛇形）
