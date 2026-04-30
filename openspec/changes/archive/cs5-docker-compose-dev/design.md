## Context

docs/ops/docker-compose.skeleton.yml 定义了完整的生产 Compose 配置（含 Phase 1-4 所有服务）。Stage 0 需要将其裁剪为开发版，支持源码 bind mount 和热重载。基础设施服务：PostgreSQL 16 (pgvector)、Redis 8、MinIO、Nginx。

## Goals / Non-Goals

**Goals:**
- `docker compose up` 一键启动全部 Phase 1 服务
- 基础设施（PG/Redis/MinIO）全部 healthy
- API /api/health 可访问
- Web 可通过 Nginx 访问
- 4 个 Worker healthcheck 通过
- 开发便捷命令可用

**Non-Goals:**
- 不配置生产部署——仅开发环境
- 不启用 Phase 2 服务（Docmost、wiki-sync-worker）——保留 profiles: ["phase2"]
- 不配置 HTTPS/TLS——开发环境用 HTTP

## Decisions

1. **开发模式适配**：cherry-api 和 cherry-web 使用源码 bind mount + 热重载命令（pnpm dev），不构建 Docker image
2. **Worker 开发模式**：Node.js Worker 同样 bind mount；Python Worker bind mount + python main.py
3. **.env.example**：从 docs/ops/env.example 复制到项目根目录，补充合理开发默认值
4. **便捷脚本**：Makefile 或 package.json scripts
   - `dev:infra`：只启动 PG/Redis/MinIO（本地开发应用时使用）
   - `dev:up`：启动全部服务
   - `dev:down`：关闭全部
   - `db:migrate`：运行 Drizzle migration
5. **Nginx**：使用 docs/ops/nginx.conf.example（Phase 1 配置，不代理 Docmost）
6. **Worker 安全配置**：保留 skeleton 中的 read_only、cap_drop、tmpfs 配置

## Risks / Trade-offs

- bind mount 热重载在 macOS 上有文件监听性能问题，可通过 Vite/nodemon 的 polling 模式缓解
- Worker 容器 read_only rootfs 在开发时可能不便，可通过 override 文件放宽
