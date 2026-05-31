# 系统架构概述 / System Architecture Overview

## 微服务拓扑 / Microservice Topology

CherryWiki 采用微服务架构，各组件通过 Docker 网络通信。The architecture separates concerns into specialized workers connected via Redis job queues.

### 核心服务 / Core Services

| 服务 / Service | 职责 / Responsibility | 通信方式 / Communication |
|---|---|---|
| cherry-api | REST API 网关 / REST API Gateway | HTTP (Fastify + NestJS) |
| postgres | 主数据库 / Primary Database | TCP port 5432 |
| redis | 消息队列 + 缓存 / Message Queue + Cache | TCP port 6379 |
| minio | 对象存储 / Object Storage | HTTP S3 API |

### Worker 服务 / Worker Services

所有 Worker 通过 Redis 队列接收任务 (all workers receive tasks via Redis queues):

- **ingestion-worker** (Python): 文档解析，支持 PDF/DOCX/TXT 格式
- **graphify-worker** (Python + Claude Code): 知识图谱抽取，调用 LLM API
- **indexer-worker** (Node.js): 向量化和 BM25 索引构建
- **wiki-sync-worker** (Node.js): 与 Docmost 双向同步

## 数据流 / Data Flow

```
用户上传文件 → API 存入 MinIO → ingestion-worker 解析
→ graphify-worker 抽取知识图谱 → wiki 页面生成
→ indexer-worker 构建索引 → 用户 chat 检索
```

## 网络隔离 / Network Isolation

- `default` network: API + Web + 基础设施服务
- `agent_private` network: Agent 容器隔离网络，仅能访问 postgres
- `url_fetch_private` network: URL fetcher 通过 egress-proxy 访问外网
