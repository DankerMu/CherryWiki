## ADDED Requirements

### Requirement: migration-infrastructure
MUST drizzle-kit generate / migrate 通路可用。

#### Scenario: 生成 migration
- **WHEN** 执行 `pnpm drizzle-kit generate`
- **THEN** 在 schemas/migrations/ 生成 SQL migration 文件

#### Scenario: 执行 migration
- **WHEN** 执行 `pnpm db:migrate`（即 drizzle-kit migrate）
- **THEN** PostgreSQL 中创建所有核心表，pgvector 和 pg_trgm extension 已创建

#### Scenario: 幂等执行
- **WHEN** 重复执行 `pnpm db:migrate`
- **THEN** 不报错，不重复建表

> **参考文档**: docs/engineering/13_开发规范.md §3（Drizzle Kit generate/migrate）§7（禁止手工跳版本）
