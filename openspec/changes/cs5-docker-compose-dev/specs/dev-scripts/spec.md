## ADDED Requirements

### Requirement: convenience-scripts
MUST 开发便捷命令。

#### Scenario: 基础设施单独启动
- **WHEN** 执行 `make dev-infra` 或 `pnpm dev:infra`
- **THEN** 只启动 postgres、redis、minio，不启动应用和 worker

#### Scenario: 全部启动
- **WHEN** 执行 `make dev-up` 或 `pnpm dev:up`
- **THEN** 启动全部 Phase 1 服务

#### Scenario: 关闭
- **WHEN** 执行 `make dev-down` 或 `pnpm dev:down`
- **THEN** 停止并移除全部容器

#### Scenario: 数据库迁移
- **WHEN** 执行 `make db-migrate` 或 `pnpm db:migrate`
- **THEN** 运行 Drizzle migration

> **参考文档**: docs/ops/env.example（.env.example 复制源）
