## 1. 前置：阅读文档

- [x] 1.1 通读 `docs/schemas/schema.sql`（669 行，完整表结构）
- [x] 1.2 阅读 `docs/design/10_数据模型与数据库设计.md`（表关系、索引策略、permission_version 机制）
- [x] 1.3 阅读 `docs/engineering/13_开发规范.md` §3（Drizzle ORM + drizzle-kit）§7（数据库规范）
- [x] 1.4 阅读 `docs/ops/env.example` DATABASE_URL 格式

## 2. Drizzle 配置

- [x] 2.1 在 apps/api（或 packages/shared）安装 drizzle-orm、drizzle-kit、pg、@types/pg
- [x] 2.2 创建 `drizzle.config.ts`（schema 路径、migration 输出到 schemas/migrations/、driver: pg）
- [x] 2.3 创建 `schemas/migrations/` 目录

## 3. Schema 定义

- [x] 3.1 创建 schema 文件，定义 tenants 表（对照 schema.sql 逐字段）
- [x] 3.2 定义 users 表（含 permission_version BIGINT、status、tenant_id FK）
- [x] 3.3 定义 groups 表（含 permission_version BIGINT）
- [x] 3.4 定义 group_members 表（复合主键 group_id + user_id）
- [x] 3.5 定义 spaces 表（含 permission_version、strict_knowledge_only BOOLEAN DEFAULT true、active_graphify_run_id、active_index_snapshot_id）
- [x] 3.6 定义 space_permissions 表
- [x] 3.7 定义 sessions 表
- [x] 3.8 定义 audit_logs 表（含 metadata JSONB）
- [x] 3.9 定义 model_configs 表
- [x] 3.10 schema 导出 index.ts

## 4. Migration

- [x] 4.1 在首个 migration 中添加 `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- [x] 4.2 执行 `drizzle-kit generate` 生成 migration 文件
- [x] 4.3 执行 `drizzle-kit migrate` 验证 migration 可运行
- [x] 4.4 重复执行 migrate 验证幂等性

## 5. NestJS 集成

- [x] 5.1 创建 DrizzleModule（dynamic module，提供 DRIZZLE injection token）
- [x] 5.2 DrizzleModule 内部创建 node-postgres Pool（从 DATABASE_URL 读取，max=20）
- [x] 5.3 在 AppModule 注册 DrizzleModule
- [x] 5.4 验证 API 启动时 DB 连接成功（健康日志确认）

## 6. 自动化测试

### 6.1 Schema 定义测试 (`packages/shared/src/__tests__/schema.test.ts` 或对应位置)

- [x] 6.1.1 导出 9 张核心表 schema 对象（tenants, users, groups, group_members, spaces, space_permissions, sessions, audit_logs, model_configs）
- [x] 6.1.2 tenants 表包含 id, name, created_at 字段
- [x] 6.1.3 users 表包含 permission_version 字段（bigint 类型）
- [x] 6.1.4 spaces 表包含 strict_knowledge_only 字段（boolean, default true）
- [x] 6.1.5 spaces 表包含 permission_version 字段（bigint 类型）
- [x] 6.1.6 group_members 表有复合主键 (group_id, user_id)
- [x] 6.1.7 audit_logs 表包含 metadata_json 字段（jsonb 类型）
- [x] 6.1.8 model_configs 表包含 visible_group_ids 字段（jsonb 类型）

### 6.2 DrizzleModule 测试 (`apps/api/src/database/__tests__/drizzle.module.test.ts`)

- [x] 6.2.1 DrizzleModule.forRoot() 可创建并导出 DRIZZLE token
- [x] 6.2.2 缺少 DATABASE_URL 时模块初始化应报错

### 6.3 集成验证（手动）

- [x] 6.3.1 本地 PostgreSQL 可连接
- [x] 6.3.2 `pnpm db:migrate` 成功
- [x] 6.3.3 psql 验证 9 张核心表已建
- [x] 6.3.4 pgvector extension 存在
- [x] 6.3.5 API 启动后 /api/health 正常
