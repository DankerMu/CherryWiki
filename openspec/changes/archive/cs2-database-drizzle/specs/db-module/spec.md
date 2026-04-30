## ADDED Requirements

### Requirement: nestjs-drizzle-module
MUST nestJS DrizzleModule，提供 db 实例注入。

#### Scenario: 注入 db
- **WHEN** NestJS service 通过 @Inject(DRIZZLE) 注入 db
- **THEN** 获得可用的 drizzle(pool) 实例

#### Scenario: 连接池
- **WHEN** API 启动
- **THEN** 使用 node-postgres Pool 连接到 DATABASE_URL，max connections 可配置

#### Scenario: 启动检查
- **WHEN** DATABASE_URL 不可达
- **THEN** API 启动失败并报错

> **参考文档**: docs/ops/env.example DATABASE_URL、docs/ops/docker-compose.skeleton.yml postgres service
