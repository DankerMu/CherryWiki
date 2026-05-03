## Why

Stage 5 完成了 Graphify → graph/wiki 导入，Published Wiki 页面已存在于数据库和 Canonical Wiki Repo。但这些页面目前不可检索——没有 chunk 切片、没有 embedding 向量、没有 index_snapshot 管理。Stage 6 打通"Published Wiki → chunking → embedding → BM25 全文索引 → index_snapshot 原子激活"的完整索引构建链路，使系统首次具备 Phase 1 RAG 检索基础，为 Stage 7 Chat Engine 提供可检索数据源。

## What Changes

- 实现 `packages/ai-core`：Embedding 提供商抽象层，封装 OpenAI-compatible embedding API，支持批量调用、密钥解引用、错误重试
- 实现 `packages/rag-core`：Wiki 页面→chunks 切片引擎，包含 section-aware chunking、content_hash 去重、source_chain_json 预计算、injection_risk 传播、acl_json 填充、token 计数
- 实现 `apps/indexer-worker`：从 no-op 空壳变为完整 BullMQ Worker——消费 QUEUE_INDEXING job、创建 index_snapshot、切片 published wiki pages、批量生成 embedding、写入 wiki_chunks + embeddings、原子激活 snapshot
- 新增 Drizzle schema：wiki_chunks、embeddings 表的 ORM 定义 + pgvector 扩展 + GIN 索引（index_snapshots 已在 Stage 5 定义，本阶段仅修正 Zod validation status 枚举）
- 修改 `apps/api/src/graphify/graphify.service.ts`：handleRunCompletion() 成功后自动 enqueue indexing job
- 新增 API 端点：POST /spaces/{space_id}/wiki/pages/{page_id}/reindex（单页重索引）、POST /admin/spaces/{space_id}/rebuild-index（全量/增量重建）

## Capabilities

### New Capabilities

- `indexer-schema`: Drizzle ORM 表定义（wiki_chunks / embeddings，index_snapshots 已存在）+ pgvector 扩展 + GIN 全文索引 + Zod validation schema（修正 indexSnapshotStatusSchema 枚举为 building/ready/activated/superseded）
- `ai-core-embedding`: Embedding 提供商抽象层——OpenAI-compatible API 封装、批量 embedding 调用（自动分批）、密钥解引用（model_configs.encrypted_api_key_ref）、重试/超时/速率控制、token 计数
- `rag-core-chunker`: Wiki 页面切片引擎——section-aware chunking（按 wiki_sections 边界优先、按 token 窗口兜底）、chunk_index 分配、content_hash 计算（增量去重）、source_chain_json 预计算（Doc 09 §8.4）、injection_risk 标记传播、acl_json 填充
- `indexer-worker`: indexer-worker 完整实现——继承 AbstractBullMQWorker 消费 QUEUE_INDEXING job（BullMQ payload 含 jobId 指向 jobs 表）、index_snapshot 生命周期管理（building→ready→activated→superseded）、调用 rag-core 切片 + ai-core embedding、wiki_chunks + embeddings 写入、chunk 完成后设 index_status='indexed'、原子激活 snapshot、增量策略（content_hash 复用）、并发互斥
- `indexer-api`: REST API 端点——单页重索引（POST /spaces/{space_id}/wiki/pages/{page_id}/reindex，返回 { data: ... }）、全量重建（POST /admin/spaces/{space_id}/rebuild-index，返回 { data: ... }）、Graphify 完成后自动触发 indexing（创建 jobs 行 + enqueue BullMQ { jobId }）

### Modified Capabilities

（无——openspec/specs/ 中无已有 spec 文件）

## Impact

- **Schema**: `packages/shared/src/schema/core.ts` 新增 wiki_chunks / embeddings 两张表定义 + 4 个索引（index_snapshots 已存在于 core.ts:727）；`packages/shared/src/schema/validation.ts` 新增 Chunk/Embedding Zod schema + 修正 indexSnapshotStatusSchema 枚举（'active'/'failed' → 'activated'/'superseded'）
- **Packages**: `packages/ai-core/` 和 `packages/rag-core/` 从空壳变为完整 package
- **Worker**: `apps/indexer-worker/src/main.ts` 从 no-op 变为实际索引构建逻辑
- **API**: `apps/api/src/graphify/graphify.service.ts` 新增索引触发调用；`apps/api/src/wiki/` 新增 reindex 端点；`apps/api/src/admin/` 新增 rebuild-index 端点
- **数据库**: 需要启用 pgvector 扩展（`CREATE EXTENSION IF NOT EXISTS vector`）；HNSW/IVFFlat 索引需在部署时针对实际 embedding_dim 创建
- **依赖**: Node 侧新增 `openai` SDK（embedding API 调用）；无 Python 侧变更
- **权限**: reindex 使用 `wiki:publish` 权限；rebuild-index 使用 `admin` role guard
- **审计**: 新增 `wiki.page.reindex`、`admin.index.rebuild` 审计事件
