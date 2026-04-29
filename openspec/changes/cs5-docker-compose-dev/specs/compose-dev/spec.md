## ADDED Requirements

### Requirement: dev-compose
MUST 开发版 Docker Compose，一键启动 Phase 1 全部服务。

#### Scenario: 一键启动
- **WHEN** 执行 `docker compose up -d`
- **THEN** postgres、redis、minio、cherry-api、cherry-web、4 个 worker、nginx 全部启动

#### Scenario: 全部 healthy
- **WHEN** 所有容器启动完成
- **THEN** `docker compose ps` 显示所有 Phase 1 服务 healthy

#### Scenario: Phase 2 隔离
- **WHEN** 默认启动（无 --profile）
- **THEN** docmost、docmost-db、docmost-redis、wiki-sync-worker 不启动

#### Scenario: API 可达
- **WHEN** curl http://localhost/api/health（经 nginx）
- **THEN** 返回 200

#### Scenario: pgvector 可用
- **WHEN** 连接 PostgreSQL 执行 `SELECT * FROM pg_extension WHERE extname = 'vector'`
- **THEN** 返回一行记录

> **参考文档**: docs/ops/docker-compose.skeleton.yml（完整参考）、docs/ops/nginx.conf.example（Phase 1 Nginx）、docs/engineering/12_权限安全审计.md §5.1（Worker 容器安全）
