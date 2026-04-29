## Context

数据库使用 PostgreSQL 16 + pgvector（docs/engineering/13_开发规范.md §3）。ORM 选型 Drizzle（schema-first，类型安全）。完整表结构在 docs/schemas/schema.sql（669 行），数据模型设计在 docs/design/10_数据模型与数据库设计.md。

## Goals / Non-Goals

**Goals:**
- Drizzle ORM 配置 + drizzle-kit 可用
- 核心表（tenants/users/groups/group_members/spaces/space_permissions/sessions/audit_logs/model_configs）转为 Drizzle schema
- 初始 migration 可生成且可执行
- NestJS DrizzleModule 提供 db 实例注入
- pgvector + pg_trgm extension 在 migration 中创建

**Non-Goals:**
- 不转换全部 schema.sql 表——wiki_*、graphify_*、jobs 等留给 Stage 1+
- 不实现 Repository pattern——由 Stage 1 各业务模块实现
- 不填充种子数据——由测试 fixture 负责

## Decisions

1. **schema 组织**：packages/shared 或独立 packages/db 存放 Drizzle schema 定义，便于跨 package 导入类型
2. **migration 目录**：schemas/migrations/（与 docs/schemas/ 平级）
3. **Extension 创建**：在第一个 migration 中 `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
4. **NestJS 集成**：自定义 DrizzleModule（dynamic module），注入 drizzle(pool) 实例，提供 DRIZZLE token
5. **连接池**：node-postgres Pool，max=20（开发环境），从 DATABASE_URL 环境变量读取
6. **schema 转换策略**：严格对照 docs/schemas/schema.sql 字段定义、类型、约束；保留 permission_version BIGINT、strict_knowledge_only BOOLEAN 等关键字段

## Risks / Trade-offs

- pgvector extension 需要 PostgreSQL 镜像支持（使用 pgvector/pgvector:pg16）
- Drizzle schema 与原始 SQL 的 1:1 映射需要逐字段核对，避免类型丢失
- Stage 0 只转换核心表，后续表增量添加时需确保 migration 顺序正确
