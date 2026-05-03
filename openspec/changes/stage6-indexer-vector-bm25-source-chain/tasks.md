## 1. Drizzle Schema & Migration

- [ ] 1.1 在 `packages/shared/src/schema/core.ts` 新增 `wikiChunks` pgTable 定义（匹配 schema.sql wiki_chunks 表：所有列、类型、默认值、FK、UNIQUE 约束）
- [ ] 1.2 在 `packages/shared/src/schema/core.ts` 新增 `embeddings` pgTable 定义（匹配 schema.sql embeddings 表：chunk_id ON DELETE CASCADE、model_config_id FK、VECTOR 类型列）
- [ ] 1.3 确认 `indexSnapshots` pgTable 已存在于 core.ts:727，无需重复定义
- [ ] 1.4 在 migration 中添加 `CREATE EXTENSION IF NOT EXISTS vector` 语句
- [ ] 1.5 在 `packages/shared/src/schema/core.ts` 为 wikiChunks 添加索引定义：idx_wiki_chunks_space、idx_wiki_chunks_fts（GIN to_tsvector）、idx_wiki_chunks_index_status
- [ ] 1.6 在 `packages/shared/src/schema/core.ts` 为 embeddings 添加 idx_embeddings_model 索引
- [ ] 1.7 更新 `packages/shared/src/schema/index.ts` 导出新表定义
- [ ] 1.8 在 `packages/shared/src/schema/validation.ts` 添加 wikiChunks、embeddings 的 insert/select Zod schema
- [ ] 1.9 修正 `packages/shared/src/schema/validation.ts:33` 的 `indexSnapshotStatusSchema`：从 `['building', 'ready', 'active', 'failed']` 改为 `['building', 'ready', 'activated', 'superseded']`（匹配 Doc 10 §6.2）
- [ ] 1.10 创建 `scripts/create-vector-index.sql`（HNSW 索引创建脚本，维度参数化）
- [ ] 1.11 生成并运行 Drizzle migration，验证表/索引/扩展创建成功

### 1.T Schema Tests

- [ ] 1.T1 wiki_chunks schema 完整性测试：所有列存在、类型正确、UNIQUE(page_version_id, chunk_index) 约束生效
- [ ] 1.T2 embeddings schema 完整性测试：chunk_id CASCADE 删除生效、model_config_id FK 约束
- [ ] 1.T3 Zod validation 测试：合法 wiki_chunk/embedding 对象通过、必填字段缺失被拒
- [ ] 1.T4 indexSnapshotStatusSchema 枚举修正测试：'activated' 通过、'active' 被拒、'superseded' 通过、'failed' 被拒
- [ ] 1.T5 pgvector 扩展验证：migration 后 pg_extension 包含 vector

## 2. ai-core — Embedding 抽象层

- [ ] 2.1 定义 `EmbeddingProvider` 接口：`embedBatch(texts: string[]): Promise<number[][]>`
- [ ] 2.2 实现 `OpenAIEmbeddingProvider`：使用 openai SDK、从 model_configs 读取 base_url/model_id、支持自定义 base_url
- [ ] 2.3 实现 API key 解引用：`encrypted_api_key_ref`（注意：字段名是 `encrypted_api_key_ref` 非 `api_key_encrypted`）→ `process.env[ref]` 读取，缺失时抛出描述性错误
- [ ] 2.4 实现 auto-batching：输入超过 max_batch_size（默认 2048）时自动分批、顺序执行、结果拼接
- [ ] 2.5 实现错误重试：429/5xx 重试 3 次（1s/2s/4s 指数退避），4xx（非 429）立即失败
- [ ] 2.6 实现 `countTokens(text, model)` 工具函数（Phase 1 使用 chars/4 启发式）
- [ ] 2.7 实现 `getEmbeddingDimension(provider)` 维度探测（发送探测文本获取维度）
- [ ] 2.8 更新 `packages/ai-core/src/index.ts` 导出所有模块
- [ ] 2.9 更新 `packages/ai-core/package.json` 添加 openai SDK 依赖

### 2.T ai-core Tests

- [ ] 2.T1 EmbeddingProvider 接口测试：单文本/批量文本 embedding 返回正确维度
- [ ] 2.T2 API key 解引用测试：正常 env var 解析、缺失 env var 抛错
- [ ] 2.T3 auto-batching 测试：5000 texts → 3 批 API 调用、结果顺序正确
- [ ] 2.T4 重试测试：429 重试成功、401 立即失败、3 次 500 后最终失败
- [ ] 2.T5 token 计数测试：返回正整数
- [ ] 2.T6 维度探测测试：返回模型实际维度

## 3. rag-core — Chunking 引擎

- [ ] 3.1 实现 `chunkPage(page, version, sections, options): ChunkResult[]` 核心切片函数
- [ ] 3.2 实现 section-aware 切片逻辑：按 wiki_sections 边界分割，section 内按 token 窗口二次切分（max_chunk_tokens=512, overlap=64）
- [ ] 3.3 实现无 section 页面兜底：整页内容按 token 窗口切片
- [ ] 3.4 实现 chunk_index 顺序分配（zero-based, 按 section_index 和 within-section 顺序）
- [ ] 3.5 实现 content_hash 计算（SHA-256 hex digest）
- [ ] 3.6 实现 source_chain_json 预计算（匹配 Doc 09 §8.4 结构）：查询 source_links 获取 source_document_ids、查询 graph_evidence_refs 获取 graph_node_ids/graph_edge_ids/edge_confidence、计算 chain_confidence（最弱环节 effective_confidence_score，无图谱关联时 1.0）
- [ ] 3.7 实现 injection_risk 传播：复用 `apps/api/src/uploads/validators/prompt-injection-patterns.ts` 的 pattern 库 + source_document.metadata_json.injection_risk 标记传播
- [ ] 3.8 实现 acl_json 快照填充（匹配 Doc 10 §4 ACL envelope）：tenant_id、space_id、allowed_group_ids（from space_permissions + group_members）、classification（from Space config, default 'internal'）、page_id、page_version
- [ ] 3.9 实现 token_count 计算（调用 ai-core countTokens）
- [ ] 3.10 更新 `packages/rag-core/src/index.ts` 导出所有模块

### 3.T rag-core Tests

- [ ] 3.T1 section-aware chunking 测试：多 section 页面→每 section 产生 chunk、section_id 正确
- [ ] 3.T2 token 窗口切分测试：大 section（1500 tokens）→ 3-4 chunks、overlap 正确
- [ ] 3.T3 无 section 页面测试：整页按 token 窗口切片
- [ ] 3.T4 空页面测试：返回空数组
- [ ] 3.T5 chunk_index 顺序测试：跨 section 顺序正确
- [ ] 3.T6 content_hash 测试：相同内容 hash 相同、不同内容 hash 不同
- [ ] 3.T7 source_chain_json 测试：有图谱关联→chain_confidence 取最弱、无图谱→1.0、AMBIGUOUS 边→chain_confidence=0.40、多 edge 混合 confidence→取最低
- [ ] 3.T8 injection_risk 测试：source_document metadata_json 标记传播、内容匹配 prompt-injection-patterns.ts 中的 pattern、干净内容 false
- [ ] 3.T9 acl_json 测试：正确填充 tenant_id/space_id/allowed_group_ids/classification/page_id/page_version

## 4. indexer-worker — 完整实现

- [ ] 4.1 继承 `AbstractBullMQWorker`，定义 IndexerPayload 类型（BullMQ 层仅含 jobId，完整 payload 从 jobs.payload_json 读取）
- [ ] 4.2 定义 jobs.payload_json schema（tenant_id, space_id, graphify_run_id?, trigger, scope, page_id?）并用 Zod 校验
- [ ] 4.3 实现 job handler 主流程：resolveJobId → 读 jobs 表 payload → snapshot 创建 → 页面加载 → chunking → embedding → 写入 → index_status='indexed' → 激活
- [ ] 4.4 实现 Published-only 页面查询：只选取 current_version_id 指向 status='published' 的页面版本
- [ ] 4.5 实现 index_snapshot 生命周期管理（创建 building → 完成 ready → 激活 activated → 旧 superseded；不引入 failed 状态，失败时保持 building）
- [ ] 4.6 实现 wiki_chunks 批量写入（含 index_snapshot_id 绑定、index_status='pending' 初始值）
- [ ] 4.7 实现 embeddings 批量写入（调用 ai-core embedBatch，按 chunk 批次生成）
- [ ] 4.8 实现 chunk index_status 更新：embedding 成功后设 index_status='indexed' + indexed_at=now()
- [ ] 4.9 实现增量 embedding 去重：对比 content_hash 与上一 snapshot 的同位置 chunk，匹配则复用 embedding
- [ ] 4.10 实现原子激活事务：单事务中 snapshot→activated + space.active_index_snapshot_id 更新 + 旧 snapshot→superseded
- [ ] 4.11 实现构建失败隔离：失败时不修改 active_index_snapshot_id，snapshot 保持 building 状态（由 retention policy 清理），job 通过 JobStateMachine 标记 failed
- [ ] 4.12 实现并发互斥：同 space_id 存在 building snapshot 时拒绝新 job（INDEXING_IN_PROGRESS）
- [ ] 4.13 实现 job_events 进度上报：indexing_started / chunks_created / embedding_progress / snapshot_activated / indexing_failed
- [ ] 4.14 实现 single_page scope：创建新 snapshot，从当前 active snapshot 复用未变更页面的 chunks/embeddings（content_hash 匹配），仅对指定 page_id 重新 chunk/embed，原子激活新 snapshot

### 4.T indexer-worker Tests

- [ ] 4.T1 job payload 校验测试：合法 payload_json 通过、缺少 tenant_id 拒绝
- [ ] 4.T2 完整流程 mock 测试：10 页 → 50 chunks → 50 embeddings → 所有 chunk index_status='indexed' → snapshot activated
- [ ] 4.T3 Published-only 过滤测试：draft 页面不产生 chunk
- [ ] 4.T4 snapshot 生命周期测试：building→ready→activated→旧 superseded（不经过 failed 状态）
- [ ] 4.T5 增量去重测试：content_hash 匹配时不调用 embedding API
- [ ] 4.T6 原子激活测试：事务成功→space 指向新 snapshot；事务失败→space 不变
- [ ] 4.T7 失败隔离测试：embedding API 失败→snapshot 保持 building、active_index 不变、job 标记 failed
- [ ] 4.T8 并发互斥测试：同 space building 存在时新 job 返回 INDEXING_IN_PROGRESS
- [ ] 4.T9 进度上报测试：job_events 包含所有阶段事件
- [ ] 4.T10 single_page scope 测试：新 snapshot 创建，仅指定页面 chunks 重建，其他页面 chunks 从旧 snapshot 复用，新 snapshot 原子激活
- [ ] 4.T11 index_status 测试：embedding 成功→'indexed'+indexed_at、embedding 失败→保持 'pending'

## 5. API — 索引触发端点

- [ ] 5.1 修改 `graphify.service.ts` handleRunCompletion：成功后创建 jobs 行（type='reindex', payload_json 含 trigger='graphify_completion', scope='full'）+ enqueue BullMQ { jobId } 到 QUEUE_INDEXING
- [ ] 5.2 确保 handleRunFailure 和 quarantine 不创建 jobs 行、不 enqueue
- [ ] 5.3 在 wiki module 新增 POST /spaces/{space_id}/wiki/pages/{page_id}/reindex 端点（权限 wiki:publish，创建 jobs 行 trigger='manual_reindex' scope='single_page'，返回 202 `{ data: { page_id, reindex_job_id, status } }`，错误 403/404/409，幂等性支持，审计 wiki.page.reindex）
- [ ] 5.4 在 admin module 新增 POST /admin/spaces/{space_id}/rebuild-index 端点（权限 admin，request body { scope, reason }，创建 jobs 行 trigger='manual_rebuild'，返回 202 `{ data: <Job> }`，错误 403/404/409，审计 admin.index.rebuild）
- [ ] 5.5 两个端点均支持 X-Idempotency-Key

### 5.T API Tests

- [ ] 5.T1 Graphify 完成触发测试：handleRunCompletion succeeded → jobs 行创建 + BullMQ 消息 enqueued
- [ ] 5.T2 Graphify 失败不触发测试：handleRunFailure → 无 jobs 行
- [ ] 5.T3 reindex 端点测试：正常 202 `{ data: ... }`、404 PAGE_NOT_FOUND、409 REINDEX_ALREADY_RUNNING、403 无权限、审计日志 wiki.page.reindex
- [ ] 5.T4 rebuild-index 端点测试：full/incremental scope、返回 `{ data: <Job> }`、审计日志 admin.index.rebuild、403 非 admin、404 SPACE_NOT_FOUND、409 REBUILD_ALREADY_RUNNING
- [ ] 5.T5 幂等性测试：相同 X-Idempotency-Key 不创建重复 jobs 行

## 6. 集成测试

- [x] 6.1 端到端测试：Graphify run 完成 → 自动 indexing → snapshot activated → BM25 查询返回 chunks → chunks 均为 index_status='indexed'
- [x] 6.2 Published-only 测试：draft 页面 chunks 不被 BM25/Vector 检索命中
- [x] 6.3 single-page reindex 测试：修改一个页面 → reindex → 新 snapshot 仅该页面 chunks 更新，旧 snapshot 不变
- [x] 6.4 失败隔离测试：embedding API 不可达 → 旧 snapshot 仍然可用

## 7. 需求追踪矩阵更新

- [ ] 7.1 更新 `docs/project/26_需求追踪矩阵.md` 中"索引构建"行的测试列，填入实际测试文件路径
- [ ] 7.2 更新 `docs/todo.md` 标记 Stage 6 完成（I-06）
