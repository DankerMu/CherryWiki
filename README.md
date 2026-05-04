# CherryGraph Studio

多用户 AI 知识工作台 — Graphify Wiki 唯一知识源 + Vector/BM25 检索 + Chat 引用。

## 快速开始

### 开发环境（需联网）

```bash
# 1. 启动基础设施 + 全部服务
docker compose up -d

# 首次启动会自动执行：pnpm install → build → DB migration → seed
# 默认管理员：admin@cherrywiki.local / Admin123!@#

# 2. 访问
open http://localhost        # 通过 nginx
open http://localhost:5174   # 前端直连（Vite dev server）
open http://localhost:8081   # API 直连
open http://localhost:9001   # MinIO Console
```

### 本地开发（不走 Docker）

```bash
# 1. 启动基础设施
docker compose up -d postgres redis minio

# 2. 安装依赖
pnpm install

# 3. 数据库迁移 + seed
DATABASE_URL="postgresql://cherrygraph:cherrygraph_dev@127.0.0.1:15432/cherrygraph" pnpm drizzle-kit migrate
DATABASE_URL="postgresql://cherrygraph:cherrygraph_dev@127.0.0.1:15432/cherrygraph" npx tsx schemas/seed.ts

# 4. 启动所有服务
pnpm dev
```

## 生产部署

### 在线部署

```bash
# 1. 构建所有镜像
docker compose -f docker-compose.prod.yml build

# 2. 配置环境变量
cp .env.prod.example .env.prod
# 编辑 .env.prod，填入必需的密码和密钥

# 3. 启动
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 离线部署（无网络环境）

```bash
# === 在有网机器上 ===

# 1. 构建镜像
docker compose -f docker-compose.prod.yml build

# 2. 导出所有镜像
docker save \
  cherrywiki/api:latest \
  cherrywiki/web:latest \
  cherrywiki/ingestion-worker:latest \
  cherrywiki/url-fetcher-worker:latest \
  cherrywiki/indexer-worker:latest \
  cherrywiki/graphify-worker:latest \
  pgvector/pgvector:pg16 \
  redis:8-alpine \
  minio/minio:latest \
  nginx:alpine \
  -o cherrywiki-images.tar

# 3. 拷贝到离线机器：
#    - cherrywiki-images.tar
#    - docker-compose.prod.yml
#    - .env.prod.example
#    - ops/nginx/nginx-prod.conf
#    - ops/postgres/init/01_extensions.sql

# === 在离线机器上 ===

# 4. 加载镜像
docker load -i cherrywiki-images.tar

# 5. 配置并启动
cp .env.prod.example .env.prod
# 编辑 .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 必需的环境变量

| 变量 | 说明 | 示例 |
|---|---|---|
| `POSTGRES_PASSWORD` | 数据库密码 | `strong-random-password` |
| `JWT_SECRET` | JWT 签名密钥（>=32 字符） | `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | 初始管理员密码 | `Admin123!@#` |
| `MINIO_ACCESS_KEY` | MinIO 访问密钥 | `minioadmin` |
| `MINIO_SECRET_KEY` | MinIO 密钥（>=16 字符） | `change-me-secret` |

完整变量列表见 [.env.prod.example](.env.prod.example)。

## 服务架构

```
┌─────────┐
│  nginx  │ :80  统一入口
├────┬────┤
│    │    │
│  web    │ 前端（生产用 nginx 静态文件）
│  api    │ NestJS + Fastify :8080
│         │
├─────────┤ Workers
│ ingestion-worker │ 文件解析
│ url-fetcher      │ URL 抓取 + SSRF 防护
│ indexer           │ chunk + embedding
│ graphify-worker  │ Python 图谱生成
├─────────┤ 基础设施
│ postgres │ pgvector :15432
│ redis    │ :6379
│ minio    │ 对象存储 :9000/:9001
└─────────┘
```

## 项目结构

```
CherryWiki/
├── apps/
│   ├── api/                  # NestJS API 服务
│   ├── web/                  # React + Vite 前端
│   ├── ingestion-worker/     # 文件解析 Worker
│   ├── url-fetcher-worker/   # URL 抓取 Worker
│   ├── indexer-worker/       # 索引构建 Worker
│   └── graphify-worker/      # Python Graphify Worker
├── packages/
│   ├── shared/               # 公共类型、Schema、错误码
│   ├── auth-core/            # JWT、RBAC、权限缓存
│   ├── job-core/             # BullMQ 队列、状态机
│   ├── wiki-core/            # Wiki 页面操作
│   ├── rag-core/             # 检索、Rerank
│   ├── graph-core/           # 图谱查询
│   └── ai-core/              # 模型网关
├── schemas/
│   ├── migrations/           # Drizzle 迁移文件
│   └── seed.ts               # 初始化数据（幂等）
├── ops/
│   ├── nginx/                # nginx 配置（dev/prod）
│   ├── postgres/init/        # DB 扩展初始化
│   └── entrypoint-api.sh     # 开发模式 API 启动脚本
├── docs/                     # 方案文档包
├── Dockerfile                # 多目标构建（api/web/workers）
├── docker-compose.yml        # 开发环境
└── docker-compose.prod.yml   # 生产环境
```

## 开发阶段

| Stage | 内容 | 状态 |
|---|---|---|
| 0 | 工程基线、仓库脚手架 | ✅ 完成 |
| 1 | Auth / RBAC / Space / Admin | ✅ 完成 |
| 2 | Job 系统 / 对象存储 / 任务中心 | ✅ 完成 |
| 3 | 上传 / 归档 / 解析 / URL Fetcher | ✅ 完成 |
| 4 | Canonical Wiki / wiki-core / 只读 Wiki | ✅ 完成 |
| 5 | Graphify Worker / 输出导入 | ✅ 完成 |
| 6 | Indexer / Vector / BM25 | ✅ 完成 |
| 7 | Chat Engine / SSE / Citation UI | ✅ 完成 |
| 8 | Phase 1 测试、部署、上线收口 | 🔄 进行中 |

## 开发环境凭据

| 服务 | 凭据 |
|---|---|
| Admin 登录 | `admin@cherrywiki.local` / `Admin123!@#` |
| Editor 登录 | `editor@test.local` / `Admin123!@#` |
| Viewer 登录 | `viewer@test.local` / `Admin123!@#` |
| PostgreSQL | `cherrygraph` / `cherrygraph_dev` (port 15432) |
| MinIO Console | `minioadmin` / `minioadmin` (port 9001) |
| Redis | 无密码 (port 6379) |

## 常用命令

```bash
# 测试
pnpm test                    # 运行全部单元测试
pnpm lint                    # ESLint 检查
pnpm typecheck               # TypeScript 类型检查

# 数据库
pnpm drizzle-kit generate    # 生成迁移文件
pnpm drizzle-kit migrate     # 执行迁移

# Docker
docker compose up -d                          # 开发环境启动
docker compose -f docker-compose.prod.yml build  # 构建生产镜像
docker compose down                           # 停止所有服务
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19, Vite, TypeScript |
| API | NestJS 11, Fastify, Drizzle ORM |
| 数据库 | PostgreSQL 16 + pgvector + pg_trgm |
| 缓存/队列 | Redis 8, BullMQ |
| 对象存储 | MinIO |
| AI Worker | Python 3.11 (Graphify) |
| 部署 | Docker Compose |

## 文档

详细设计文档见 [docs/README.md](docs/README.md)。
