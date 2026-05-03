## Context

Stage 5 完成了 Graphify → graph/wiki 导入。数据库中已有 Published wiki_pages、wiki_page_versions、wiki_sections、graph_nodes、graph_edges、graph_evidence_refs。indexer-worker 存在但是 no-op 空壳。`packages/ai-core` 和 `packages/rag-core` 都是空 `export {}`。Drizzle schema 中 `indexSnapshots` 已定义，但 `wikiChunks` 和 `embeddings` 表尚未定义。

Stage 7 Chat Engine 依赖 Stage 6 产出的 wiki_chunks + embeddings + active_index_snapshot 来执行 Vector + BM25 混合检索。

关键约束来源：
- Doc 09 §8.4：source_chain_json 索引时预计算
- Doc 10 §5A：Phase 1 单 embedding 模型约束
- Doc 10 §6.1-6.3：index_snapshot 生命周期和 Fallback 策略
- schema.sql：wiki_chunks、embeddings 表结构已锁定

## Goals / Non-Goals

**Goals:**

- Published Wiki 页面可被切片为 chunks 并生成 embedding 向量
- BM25 全文搜索（PostgreSQL GIN + tsvector）可检索 wiki_chunks
- Vector 相似度搜索（pgvector）可检索 embeddings
- index_snapshot 原子激活，构建失败不影响现有检索
- Graphify run 成功后自动触发索引构建
- Admin 可手动触发全量/增量重建索引
- source_chain_json 在索引时预计算，查询时零额外查询

**Non-Goals:**

- Chat Engine 实现（Stage 7）
- Chat UI、SSE streaming（Stage 7）
- GraphRAG 检索模式（Phase 3 / Stage 12）
- 多 embedding 模型并存（Phase 2+）
- Qdrant 迁移（Phase 4 评估）
- rerank 逻辑（Stage 7 Chat Engine 负责）

## Decisions

### D1: Chunking 策略 — Section-aware + Token Window

**选择**: 按 wiki_sections 边界优先切片；section 内容超过 token 窗口时按段落/句子边界二次切分。

**理由**: wiki_sections 表已有 start_offset/end_offset，提供了天然切片边界。section-aware chunking 保证 chunk 不跨 section，便于 source chain 归属和引用定位。

**替代方案**: 纯固定窗口滑动切片（简单但丢失结构信息）、纯段落切片（chunk 大小不可控）。

**参数**: `max_chunk_tokens = 512`，`chunk_overlap_tokens = 64`，与 Doc 09 §4.1 的 `context_token_budget = 12000` 配合。

### D2: Embedding 调用 — OpenAI-compatible SDK

**选择**: 使用 `openai` Node SDK，通过 `model_configs.base_url` + `encrypted_api_key_ref` 配置指向任意 OpenAI-compatible 端点（OpenAI、Azure、本地代理）。

**理由**: Phase 1 的 model_configs 表已支持 provider/base_url/model_id 配置。OpenAI embedding API 是事实标准，大多数 embedding 提供商兼容此接口。

**替代方案**: 直接 HTTP 调用（需自行处理分批/重试）、provider-specific SDK（绑定单一提供商）。

**批量策略**: 按 embedding API 的 max batch size（默认 2048 inputs）自动分批，每批并发度 = 1（避免 rate limit），批间 backoff。

### D3: Source Chain 预计算 — 索引时写入

**选择**: chunk 入库时同步计算 source_chain_json 并写入 wiki_chunks.source_chain_json 字段。

**理由**: Doc 09 §8.4 明确要求"索引时预计算，非查询时 JOIN"。chain_confidence 取 chain 中最弱环节的 effective_confidence_score。

**数据来源**: page → source_links 表查 source_document_ids；page → graph_evidence_refs 表查 graph_node_ids / graph_edge_ids + edge confidence。无图谱关联时 chain_confidence = 1.0。

### D4: ACL 快照 — 索引时写入

**选择**: chunk 入库时从 space_permissions + group_members 计算 acl_json 快照写入 wiki_chunks.acl_json。ACL envelope 包含 tenant_id、space_id、allowed_group_ids、classification、page_id、page_version，与 Doc 10 §4 定义的结构完全一致。

**理由**: Doc 10 §4 要求"所有索引对象必须保存 ACL 快照，避免检索时跨表查询过重"。`classification` 字段从 Space 配置继承（默认 'internal'）。权限变更时通过 permission_versions 触发增量 reindex。

### D5: 增量索引 — content_hash 去重

**选择**: chunk 切片后计算 content_hash（SHA-256(content)）。与上一个 snapshot 的同 page+section+chunk_index 的 content_hash 比对：相同则复用已有 embedding，仅更新 index_snapshot_id 引用。

**理由**: embedding API 调用是主要成本。增量 Graphify 更新通常只影响部分页面，复用未变更 chunk 的 embedding 可大幅降低成本。

**替代方案**: 总是全量 embedding（简单但浪费）、页面级 hash（粒度太粗）。

### D6: Snapshot 激活 — 单事务原子切换

**选择**: 在一个数据库事务中：更新 index_snapshots.status = 'activated'、设 activated_at、更新 spaces.active_index_snapshot_id、将旧 snapshot 标记为 'superseded'。

**理由**: Doc 10 §6.1 要求原子切换。事务保证 Chat 检索要么看到完整的新 snapshot，要么继续使用旧 snapshot，不会看到半成品。

### D6a: Snapshot 状态枚举 — 严格遵循 Doc 10

**选择**: snapshot 状态严格限制为 `building | ready | activated | superseded` 四种，不引入 `failed` 状态。构建失败时 snapshot 保持 `building` 状态，由保留策略清理孤儿 snapshot。现有 `packages/shared/src/schema/validation.ts:33` 的 `indexSnapshotStatusSchema` 使用了 `active/failed`，需修正为 `activated/superseded`。

**理由**: Doc 10 §6.2 明确定义四态生命周期。引入额外状态会导致跨 spec 不一致和 Zod 校验冲突。

### D6b: Single-page Reindex — 新建 snapshot 而非 in-place 修改

**选择**: 单页 reindex 也创建新 snapshot（仅对指定页面生成新 chunks，其余页面 chunks 从当前 active snapshot 复用 content_hash/embedding），然后原子激活新 snapshot。不在 active snapshot 内 in-place 删除/插入。

**理由**: Doc 10 §6.1 的 Chat 检索约束 `WHERE c.index_snapshot_id = s.active_index_snapshot_id` 依赖 snapshot 不可变性。in-place 修改 active snapshot 的 chunks 会导致检索期间看到不一致状态。

### D6c: Job Enqueue 模式 — jobs 表 + BullMQ { jobId }

**选择**: 索引触发时先创建 `jobs` 表行（type='reindex' 或 'rebuild'，payload_json 包含 space_id/graphify_run_id/scope 等），然后 enqueue BullMQ QUEUE_INDEXING 消息，payload 为 `{ jobId: jobs.id }`。indexer-worker 继承 `AbstractBullMQWorker`，通过 `resolveJobId()` 从 BullMQ payload 获取 jobId，再从 jobs 表加载完整 payload。

**理由**: 这是现有 job-core worker-base.ts 的标准模式。ingestion-worker 和 graphify-worker 都遵循此模式。直接在 BullMQ payload 中放完整业务数据会绕过 job 状态机和审计。

### D7: pgvector 索引 — 部署时创建

**选择**: 不在 Drizzle migration 中硬编码 HNSW 索引维度。提供独立的 SQL 脚本 `scripts/create-vector-index.sql`，在部署时根据实际 embedding_dim 执行。

**理由**: Doc 10 §5A.3 明确"schema 中 VECTOR 列不固定维度——由应用层在创建时指定。pgvector 的 HNSW/IVFFlat 索引需要在部署时针对实际维度创建"。

### D8: injection_risk 传播逻辑

**选择**: 如果页面在 ingestion 阶段被 ingestion-worker 标记了 injection pattern（source_documents.metadata_json 中有 injection_risk），或者 chunk 内容命中已有的 injection 正则库（`apps/api/src/uploads/validators/prompt-injection-patterns.ts`），则该 chunk 的 injection_risk = true。

**理由**: Doc 09 §7.1 和 Doc 10 §3.8 要求"ingestion-worker 检测到 prompt injection 模式时标记 true，检索 rerank 降权 ×0.3"。复用 ingestion-worker 已有的 pattern 库，避免重复维护。

## Risks / Trade-offs

- **[embedding API 成本]** → 增量策略（D5 content_hash 去重）降低调用量；Phase 1 测试语料约 500 页 ≈ 5000 chunks，成本可控
- **[pgvector 性能上限]** → Phase 1 规模（<100K vectors）pgvector HNSW 足够；Phase 4 评估 Qdrant
- **[单 embedding 模型锁定]** → Phase 1 约束，切换模型 = 全量重建。migration 路径已设计（Doc 10 §5A.4）
- **[索引构建期间的 Chat 可用性]** → Fallback 策略（D6）保证构建中 Chat 继续使用旧 snapshot
- **[ACL 快照过时]** → 权限变更触发增量 reindex；撤权 5s 内生效依赖 permission_versions 机制（Stage 1 已实现）
- **[source_chain 数据不完整]** → Phase 1 中 graph_evidence_refs 可能为空（Graphify 未必所有边都有 evidence），此时 chain_confidence 取 effective_confidence_score 或默认 1.0

## Migration Plan

- pgvector 扩展需在 PostgreSQL 中启用（`CREATE EXTENSION IF NOT EXISTS vector`）
- HNSW 索引需在首次部署时根据选定的 embedding 模型维度创建
- Docker Compose 中 indexer-worker 服务已存在（Stage 2 配置），无需新增容器
- 环境变量：无新增（embedding 配置通过 model_configs 表管理，worker 连接配置复用现有 REDIS_URL/DATABASE_URL）

## Open Questions

（无——所有设计决策已在现有文档中明确定义）
