## ADDED Requirements

### Requirement: core-table-schemas
MUST 将 schema.sql 核心表转为 Drizzle TypeScript schema 定义。

#### Scenario: 表覆盖范围
- **WHEN** Drizzle schema 定义完成
- **THEN** 包含以下表：tenants, users, groups, group_members, spaces, space_permissions, sessions, audit_logs, model_configs

#### Scenario: 字段精确映射
- **WHEN** 对比 Drizzle schema 与 docs/schemas/schema.sql
- **THEN** 每个表的字段名、类型、NOT NULL、DEFAULT、UNIQUE 约束完全一致

#### Scenario: permission_version 字段
- **WHEN** 查看 users、groups、spaces 表 schema
- **THEN** 都有 `permission_version BIGINT NOT NULL DEFAULT 1` 字段

#### Scenario: strict_knowledge_only 字段
- **WHEN** 查看 spaces 表 schema
- **THEN** 有 `strict_knowledge_only BOOLEAN NOT NULL DEFAULT true` 字段

> **参考文档**: docs/schemas/schema.sql（完整表结构，669 行）、docs/design/10_数据模型与数据库设计.md（表关系与索引）、docs/engineering/13_开发规范.md §7（数据库规范）
