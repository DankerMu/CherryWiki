## Why

CherryGraph Studio 所有持久化数据（用户、Space、权限、任务、Wiki、索引）依赖 PostgreSQL。Stage 0 需要建立 Drizzle ORM 基础设施和 migration 通路，证明 schema 定义 → migration 生成 → 数据库建表的链路可用。Stage 1（Auth/RBAC）直接在此基础上添加业务逻辑。

## What Changes

- 配置 Drizzle ORM + drizzle-kit（schema-first）
- 将 `docs/schemas/schema.sql` 中核心表转为 Drizzle TypeScript schema 定义
  - Stage 0 转换范围：tenants, users, groups, group_members, spaces, space_permissions, sessions, audit_logs, model_configs
  - 其余表（wiki_*, graphify_*, jobs 等）留给 Stage 1+ 增量添加
- 生成初始 migration 文件
- 创建 NestJS DrizzleModule（可注入 db 实例）
- 确保 pgvector + pg_trgm extension 在 migration 中创建

## Capabilities

### New Capabilities
- `drizzle-schema`: Drizzle TypeScript schema 定义（核心表）
- `drizzle-migration`: drizzle-kit generate / migrate 通路
- `db-module`: NestJS DrizzleModule，提供 db 实例注入

### Modified Capabilities

## Impact

- 修改 apps/api/（新增 DrizzleModule）
- 新建 schemas/migrations/ 目录
- 依赖 CS-1（API 应用存在才能注入 DB module）
- PostgreSQL 16 + pgvector extension 必须可用

### 实现前必读文档

| 文档路径 | 读取重点 |
|---|---|
| `docs/schemas/schema.sql` | **完整表结构**（669 行），Stage 0 仅转换核心表，但需通读全貌 |
| `docs/engineering/13_开发规范.md` §3 | Drizzle ORM + drizzle-kit 选型确认 |
| `docs/engineering/13_开发规范.md` §7 | 数据库规范：created_at/updated_at、tenant_id、space_id、禁止拼接 SQL |
| `docs/design/10_数据模型与数据库设计.md` | 表关系、索引策略、permission_version 机制 |
| `docs/ops/env.example` DATABASE_URL | 连接串格式 |
| `docs/ops/docker-compose.skeleton.yml` postgres | pgvector/pgvector:pg16 镜像、端口 5432 |
