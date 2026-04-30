## Why

CherryGraph Studio 需要一键启动完整本地开发环境。CS-1 ~ CS-4 产出了各个独立应用和 Worker，但它们依赖 PostgreSQL、Redis、MinIO 等基础设施。需要一个开发版 Docker Compose 将所有服务编排在一起，含 healthcheck 和 Nginx 反向代理。

## What Changes

- 基于 `docs/ops/docker-compose.skeleton.yml` 创建项目根目录 docker-compose.yml（开发版）
  - 基础设施：postgres (pgvector:pg16)、redis、minio
  - 应用：cherry-api、cherry-web（dev 模式 bind mount 源码）
  - Workers：ingestion-worker、url-fetcher-worker、graphify-worker、indexer-worker
  - nginx（Phase 1 配置）
  - Phase 2 服务保留 profiles: ["phase2"]
  - 全部 healthcheck
- 复制 .env.example 到项目根目录
- 添加开发便捷脚本（Makefile 或 package.json scripts）

## Capabilities

### New Capabilities
- `compose-dev`: 开发版 Docker Compose，一键启动全部 Phase 1 服务
- `dev-scripts`: 开发便捷命令（dev:infra / dev:up / dev:down / db:migrate）

### Modified Capabilities

## Impact

- 新建项目根 docker-compose.yml、.env.example
- 依赖 CS-1 ~ CS-4（所有应用和 Worker 需已存在）
- 后续 CS-6（CI）需要此 Compose 配置来验证集成

### 实现前必读文档

| 文档路径 | 读取重点 |
|---|---|
| `docs/ops/docker-compose.skeleton.yml` | **完整参考**：所有服务定义、环境变量、安全配置、healthcheck、volumes |
| `docs/ops/env.example` | 环境变量完整清单 |
| `docs/ops/nginx.conf.example` | Phase 1 Nginx 配置（代理 cherry-web + cherry-api，不含 Docmost） |
| `docs/engineering/13_开发规范.md` §3 | PostgreSQL 16 (pgvector)、Redis、MinIO 版本确认 |
| `docs/engineering/12_权限安全审计.md` §5.1 | Worker 容器安全配置：read_only、no-new-privileges、cap_drop ALL、tmpfs |
| `docs/engineering/15_部署运维规范.md` | 部署、备份、健康检查、日志规范 |
