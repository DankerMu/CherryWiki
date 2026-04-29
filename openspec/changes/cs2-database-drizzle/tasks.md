## 1. 前置：阅读文档

- [ ] 1.1 通读 `docs/schemas/schema.sql`（669 行，完整表结构）
- [ ] 1.2 阅读 `docs/design/10_数据模型与数据库设计.md`（表关系、索引策略、permission_version 机制）
- [ ] 1.3 阅读 `docs/engineering/13_开发规范.md` §3（Drizzle ORM + drizzle-kit）§7（数据库规范）
- [ ] 1.4 阅读 `docs/ops/env.example` DATABASE_URL 格式

## 2. Drizzle 配置

- [ ] 2.1 在 apps/api（或 packages/shared）安装 drizzle-orm、drizzle-kit、pg、@types/pg
- [ ] 2.2 创建 `drizzle.config.ts`（schema 路径、migration 输出到 schemas/migrations/、driver: pg）
- [ ] 2.3 创建 `schemas/migrations/` 目录

## 3. Schema 定义

- [ ] 3.1 创建 schema 文件，定义 tenants 表（对照 schema.sql 逐字段）
- [ ] 3.2 定义 users 表（含 permission_version BIGINT、status、tenant_id FK）
- [ ] 3.3 定义 groups 表（含 permission_version BIGINT）
- [ ] 3.4 定义 group_members 表（复合主键 group_id + user_id）
- [ ] 3.5 定义 spaces 表（含 permission_version、strict_knowledge_only BOOLEAN DEFAULT true、active_graphify_run_id、active_index_snapshot_id）
- [ ] 3.6 定义 space_permissions 表
- [ ] 3.7 定义 sessions 表
- [ ] 3.8 定义 audit_logs 表（含 metadata JSONB）
- [ ] 3.9 定义 model_configs 表
- [ ] 3.10 schema 导出 index.ts

## 4. Migration

- [ ] 4.1 在首个 migration 中添加 `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- [ ] 4.2 执行 `drizzle-kit generate` 生成 migration 文件
- [ ] 4.3 执行 `drizzle-kit migrate` 验证 migration 可运行
- [ ] 4.4 重复执行 migrate 验证幂等性

## 5. NestJS 集成

- [ ] 5.1 创建 DrizzleModule（dynamic module，提供 DRIZZLE injection token）
- [ ] 5.2 DrizzleModule 内部创建 node-postgres Pool（从 DATABASE_URL 读取，max=20）
- [ ] 5.3 在 AppModule 注册 DrizzleModule
- [ ] 5.4 验证 API 启动时 DB 连接成功（健康日志确认）

## 6. 验证

- [ ] 6.1 本地 PostgreSQL（或 Docker postgres）可连接
- [ ] 6.2 `pnpm db:migrate` 成功
- [ ] 6.3 psql 验证 9 张核心表已建
- [ ] 6.4 pgvector extension 存在
- [ ] 6.5 API 启动后 /api/health 正常（DB 连接成功）
