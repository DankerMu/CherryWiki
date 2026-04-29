## ADDED Requirements

### Requirement: structured-logging
MUST 结构化 JSON 日志，每请求含 request_id，支持 tenant_id / space_id 穿透。

#### Scenario: 请求日志
- **WHEN** 任何 API 请求进入
- **THEN** 日志含 `{ request_id, method, url, status_code, duration_ms }`

#### Scenario: request_id 生成
- **WHEN** 请求未携带 X-Request-Id header
- **THEN** 自动生成 UUID v4 作为 request_id

#### Scenario: request_id 透传
- **WHEN** 请求携带 X-Request-Id header
- **THEN** 使用该值作为 request_id

#### Scenario: 上下文穿透
- **WHEN** 认证后请求中含 tenant_id 和 space_id
- **THEN** 后续所有日志自动附带 tenant_id、user_id、space_id

> **参考文档**: docs/engineering/13_开发规范.md §6（request_id 必须）、cherrywiki_implementation_stage_plan.md Stage 0（结构化日志规范）
