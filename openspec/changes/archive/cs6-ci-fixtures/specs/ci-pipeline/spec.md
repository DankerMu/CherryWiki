## ADDED Requirements

### Requirement: github-actions-ci
MUST gitHub Actions CI 管线。

#### Scenario: PR 触发
- **WHEN** 创建或更新 PR
- **THEN** CI 自动触发 lint → typecheck → test → OpenAPI validate → SQL validate

#### Scenario: lint 通过
- **WHEN** 代码无 lint 错误
- **THEN** lint step 通过

#### Scenario: OpenAPI 校验
- **WHEN** docs/schemas/openapi.yaml 合法
- **THEN** OpenAPI validate step 通过

#### Scenario: SQL 校验
- **WHEN** docs/schemas/schema.sql 语法正确
- **THEN** SQL validate step 通过

#### Scenario: 门禁
- **WHEN** CI 任一 step 失败
- **THEN** PR 禁止 merge

> **参考文档**: docs/engineering/13_开发规范.md §9-§10（Git/PR 规范）、docs/todo.md T-15.3（CI/CD pipeline 骨架）
