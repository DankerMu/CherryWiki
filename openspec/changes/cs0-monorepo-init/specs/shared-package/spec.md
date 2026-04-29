## ADDED Requirements

### Requirement: env-schema
MUST 使用 zod 定义环境变量校验 schema，启动时 parse 失败即 crash。

#### Scenario: 环境变量校验通过
- **WHEN** 所有必需环境变量（DATABASE_URL, REDIS_URL, JWT_SECRET 等）已设置
- **THEN** env.parse() 返回类型安全的配置对象

#### Scenario: 环境变量缺失
- **WHEN** DATABASE_URL 未设置
- **THEN** 进程启动时抛出 ZodError 并 crash，错误信息含缺失字段名

### Requirement: error-code-enum
MUST errorCode 枚举，大写蛇形命名，所有 API 错误响应使用。

#### Scenario: 错误码格式
- **WHEN** API 返回错误
- **THEN** error.code 使用枚举值如 PERMISSION_DENIED、NOT_FOUND、VALIDATION_ERROR、INTERNAL_ERROR

### Requirement: request-context-type
MUST requestContext 公共类型，贯穿日志和审计。

#### Scenario: 类型定义
- **WHEN** 导入 RequestContext
- **THEN** 类型含 request_id: string, tenant_id: string, user_id: string | null, space_id: string | null

> **参考文档**: docs/ops/env.example（环境变量清单）、docs/design/11_API规范.md（ErrorCode 定义）、docs/engineering/13_开发规范.md §6（request_id 要求）
