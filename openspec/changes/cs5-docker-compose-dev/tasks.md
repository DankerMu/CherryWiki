## 1. 前置：阅读文档

- [ ] 1.1 通读 `docs/ops/docker-compose.skeleton.yml`（完整生产 Compose 参考）
- [ ] 1.2 阅读 `docs/ops/env.example`（环境变量清单）
- [ ] 1.3 阅读 `docs/ops/nginx.conf.example`（Phase 1 Nginx 配置）
- [ ] 1.4 阅读 `docs/engineering/12_权限安全审计.md` §5.1（Worker 容器安全：read_only / cap_drop / tmpfs）
- [ ] 1.5 阅读 `docs/engineering/15_部署运维规范.md`（部署、备份、健康检查规范）

## 2. Docker Compose

- [ ] 2.1 创建 `docker-compose.yml`（基于 skeleton 裁剪为开发版）
  - 基础设施：postgres (pgvector:pg16)、redis (8)、minio
  - cherry-api：bind mount apps/api 源码，pnpm dev 启动
  - cherry-web：bind mount apps/web 源码，pnpm dev 启动
  - ingestion-worker / url-fetcher-worker / indexer-worker：bind mount，pnpm dev
  - graphify-worker：bind mount，python main.py
  - nginx：使用 docs/ops/nginx.conf.example
  - Phase 2 服务保留 profiles: ["phase2"]
- [ ] 2.2 所有服务配置 healthcheck（对照 skeleton 中的配置）
- [ ] 2.3 Worker 容器保留安全配置（read_only / no-new-privileges / cap_drop ALL / tmpfs）

## 3. 环境配置

- [ ] 3.1 复制 `docs/ops/env.example` 到项目根 `.env.example`，补充开发默认值
- [ ] 3.2 创建 `.env`（从 .env.example 复制，.gitignore 已排除）

## 4. 便捷脚本

- [ ] 4.1 创建 `Makefile`（或在根 package.json 添加 scripts）：
  - dev-infra / dev:infra：只启动 postgres、redis、minio
  - dev-up / dev:up：启动全部
  - dev-down / dev:down：关闭全部
  - db-migrate / db:migrate：运行 Drizzle migration
- [ ] 4.2 Nginx 配置文件放入 ops/nginx/ 并 mount 到 nginx 容器

## 5. 验证

- [ ] 5.1 `docker compose up -d` 全部容器启动
- [ ] 5.2 `docker compose ps` 全部 Phase 1 服务显示 healthy
- [ ] 5.3 `curl http://localhost/api/health` 经 nginx 返回 200
- [ ] 5.4 Web 可通过 http://localhost 访问
- [ ] 5.5 4 个 Worker healthcheck 通过
- [ ] 5.6 MinIO Console 可通过 http://localhost:9001 访问
- [ ] 5.7 Phase 2 服务未启动
