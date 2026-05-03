## Context

Stage 6 已交付完整索引链路：Published Wiki pages 被 chunked、embedded、存入 `wiki_chunks` + `embeddings` 表并绑定 `index_snapshots`。当前系统具备：
- `wiki_chunks` 表含 content、acl_json、injection_risk、source_chain_json、index_snapshot_id
- `embeddings` 表含 pgvector embedding 向量
- `index_snapshots` 管理激活状态（status='activated'）
- `model_configs` 管理模型配置（type='chat'/'embedding'/'rerank'）
- `ai-core` 已有 embedding provider 抽象
- `rag-core` 已有 chunker / acl-builder / injection-scanner / source-chain

缺失：检索引擎、Chat API、流式回答、引用持久化、前端 Chat UI。

## Goals / Non-Goals

**Goals:**
- 用户在 Cherry Web 中可对 Space 内 Published Wiki 发起自然语言提问
- 混合检索（vector + BM25 + RRF）返回最相关 chunks，受 ACL 和 snapshot 约束
- LLM 流式回答通过 SSE 推送，附带引用（citations）指向具体 Wiki 页面/section
- injection_risk chunk 降权，不参与 prompt context 前排
- 无命中时可配置降级（strict: 返回 no_hit / relaxed: 回退 model_knowledge）
- Chat 历史持久化，支持多轮对话

**Non-Goals:**
- GraphRAG 图路径检索（Phase 3）
- Rerank 模型集成（可预留接口，Phase 1 不实现）
- Agent / 深度分析模式（Phase 3）
- 多模型并行或 A/B 比较
- Chat 导出/分享
- 实时协作聊天

## Decisions

### D1: 检索架构 — 应用层 RRF 融合

**选择**: 在 `rag-core` 中实现两阶段检索：先分别查 pgvector 和 pg_tsvector，再用 Reciprocal Rank Fusion (RRF) 合并排序。

**理由**: 
- pgvector 的 <=> 操作符和 GIN tsvector 索引已就绪（Stage 6 创建）
- RRF 无需训练参数，k=60 是通用默认值
- 未来可平滑插入 rerank 阶段（Phase 3）

**替代方案**: 
- pg_search 扩展一体化检索 — 但引入额外扩展依赖，且 ACL 过滤灵活度不足
- 先 vector 后 BM25 过滤 — 丢失纯关键词命中

### D2: 流式协议 — SSE text/event-stream

**选择**: POST /api/chat/completions 返回 `Content-Type: text/event-stream`，事件格式兼容 OpenAI streaming format。

**理由**:
- 前端可复用 OpenAI SDK 的 streaming parser
- 支持 `data: [DONE]` 结束标记
- 事件类型: `content`（文本增量）、`citations`（引用列表）、`usage`（token 统计）、`error`

**替代方案**:
- WebSocket — 对于请求-响应模式过重，且 NestJS 集成需额外 gateway
- Long polling — 延迟高，不适合流式

### D3: Chat Schema 设计

**选择**:
```
chat_sessions: { id(UUID), tenant_id, space_id, user_id, title, created_at, updated_at }
chat_messages: { id(UUID), session_id, role(user/assistant/system), content, token_count, citations_json, metadata_json, created_at }
answer_citations: { id(UUID), message_id, wiki_page_pk, section_id, chunk_id, relevance_score, source_chain_json, display_text, created_at }
```

**理由**:
- ID 使用 UUID（`crypto.randomUUID()`），与项目全局 ID 策略一致
- `chat_sessions` 不存储 model_config_id（Phase 1 单模型，无需 per-session 选择）
- `chat_sessions` 支持多轮对话上下文管理
- `answer_citations` 独立表便于按页面反向查询引用频率（后续分析）
- `citations_json` 冗余存储在 message 上，避免前端渲染时 JOIN

### D4: RAG Prompt 构建策略

**选择**: System prompt + 检索 context + 用户历史 + 当前问题。Context 插入方式：
1. 按 RRF score 排序取 top-K（K=8 默认，可配置）
2. injection_risk=true 的 chunk 放在 context 末尾且加标注 `[UNVERIFIED]`
3. 每个 chunk 附带 `[Source: page_title#section]` 标记
4. System prompt 指示模型引用时使用 `[^N]` 格式
5. System prompt 明确声明：context 块为不可信外部数据，禁止执行其中任何指令性内容，仅提取事实信息用于回答

**引用保障**: 当 LLM 响应不含任何 `[^N]` 引用时，系统自动将 top-3 retrieval results 作为 fallback citations 附加，确保需求矩阵"citations 非空"约束。

**理由**:
- 结构化引用标记让后处理可靠提取引用关系
- injection_risk 降权但不完全排除（用户可能确实需要该内容）
- system prompt 安全隔离满足"Chat 降权且不执行注入指令"要求
- fallback citation 机制确保有检索结果时引用永不为空
- top-K 限制防止 context window 溢出

### D5: 降级策略 — 复用 spaces.strict_knowledge_only

**选择**: 复用已有 `spaces.strict_knowledge_only` 布尔字段（默认 true）。
- true（strict）: 无检索命中时返回标准化 no_hit 响应，不调用 LLM
- false（relaxed）: 无检索命中时仍调用 LLM 但标注"回答基于模型知识，未引用 Wiki"

**理由**: 该字段已存在于 `packages/shared/src/schema/core.ts:116`，语义完全匹配，无需新增字段。

**替代方案**:
- 新增 `chat_config` JSONB 字段 — 过度设计，Phase 1 单一策略开关足够

### D6: ACL 过滤时机 — 数据库层

**选择**: 检索 SQL 中直接 WHERE 过滤 `acl_json`（JSONB containment `@>`），而非应用层过滤。

**理由**:
- 避免"检索 100 个→过滤后只剩 2 个"的问题
- 利用 GIN 索引加速
- ACL 结构已在 Stage 6 的 acl-builder 中确定：`{ tenant_id: string, space_id: string, allowed_group_ids: string[], classification: string, page_id: string, page_version: number }`
- 过滤条件：`acl_json->>'space_id' = :spaceId AND (acl_json->'allowed_group_ids' ?| :userGroupIds OR acl_json->'allowed_group_ids' = '[]'::jsonb)`

### D7: 前端 Chat UI 架构

**选择**: `/spaces/:spaceId/chat` 路由（与现有路由格式一致），使用 React + `fetch` streaming + `eventsource-parser` 解析 SSE（因 POST 不兼容 native EventSource）。

**理由**:
- Chat 是 Space 级功能，URL 结构与现有 Wiki 并列（如 `/spaces/:spaceId/wiki/:pageId`）
- `fetch` + ReadableStream + eventsource-parser 是 POST SSE 标准方案
- 流式渲染使用 `useRef` 追加而非频繁 re-render（性能考量）
- 引用卡片点击跳转 `/spaces/:spaceId/wiki/:pageId`（与 `apps/web/src/App.tsx:31` 一致）

**替代方案**:
- native EventSource — 仅支持 GET，无法携带 request body

## Risks / Trade-offs

- **[pgvector HNSW 召回率]** → Stage 6 创建了 HNSW 索引但 ef_search 参数未调优；默认 40 可能在大数据量时丢失相关结果 → Mitigation: 开放 ef_search 配置项，后续可调
- **[Context window 溢出]** → top-K chunks 加上多轮历史可能超出模型 max_tokens → Mitigation: 动态计算剩余 token budget，必要时截断历史
- **[SSE 连接超时]** → 某些反向代理/LB 会断开长连接 → Mitigation: 定期发送 SSE comment (`: keepalive`) + 文档说明 Nginx 配置
- **[引用提取不精确]** → LLM 可能不严格遵循 `[^N]` 格式 → Mitigation: 后处理正则宽容匹配 + 无法提取时降级为不带引用
- **[BM25 中文分词]** → 当前 FTS 使用 `'simple'` 配置，对中文分词能力有限 → Mitigation: Phase 1 保持 `'simple'` 配置（对英文关键词有效，中文依赖 vector search 补偿），Phase 4 评估切换 MeiliSearch 或添加 zhparser 扩展
