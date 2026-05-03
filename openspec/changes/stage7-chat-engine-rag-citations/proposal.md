## Why

Stage 6 完成了 Published Wiki → chunking → embedding → BM25 全文索引 → index_snapshot 原子激活的完整索引构建链路。但系统目前没有消费这些索引的入口——没有检索引擎、没有 Chat API、没有流式回答、没有引用关联。Stage 7 打通"用户提问 → 混合检索（vector + BM25）→ ACL 过滤 → LLM 流式回答 → Wiki 引用生成"的完整 RAG Chat 链路，使 Phase 1 首次具备端到端问答能力。

## What Changes

- 实现 `packages/ai-core` 扩展：Chat LLM 提供商抽象层（OpenAI-compatible chat completions API），支持流式输出、密钥解引用、token 计数、超时控制
- 实现 `packages/rag-core` 扩展：混合检索引擎——vector cosine similarity + BM25 全文搜索 + RRF 融合排序 + ACL 过滤 + index_snapshot 绑定 + injection_risk 降权
- 新增 Drizzle schema：`chat_sessions`、`chat_messages`、`answer_citations` 表定义 + Zod validation
- 新增 `apps/api/src/chat/` 模块：POST /api/chat/completions（SSE 流式）——接收用户消息、调用检索引擎、构建 RAG prompt、调用 LLM、流式返回 + 引用生成
- 新增 Chat 策略层：仅检索 Published Wiki（snapshot-bound）、source_documents 不直接暴露、无命中时降级策略（复用 spaces.strict_knowledge_only 字段：true=strict 返回 no_hit / false=relaxed 回退 model_knowledge）
- 新增 `apps/web/src/` Chat 前端页面：流式消息展示、引用卡片、引用点击跳转 Wiki 页面

## Capabilities

### New Capabilities

- `chat-schema`: Drizzle ORM 表定义（chat_sessions / chat_messages / answer_citations）+ Zod validation schema
- `ai-core-chat`: Chat LLM 提供商抽象层——OpenAI-compatible streaming chat completions、密钥解引用、token 计数/限制、重试/超时、system prompt 注入
- `rag-retrieval`: 混合检索引擎——vector similarity search（pgvector <=> 操作符）+ BM25 全文搜索（tsvector）+ RRF 融合排序 + ACL 过滤（acl_json 匹配用户权限）+ snapshot 绑定（仅查询 activated snapshot）+ injection_risk 降权
- `chat-completions-api`: REST SSE 端点 POST /api/chat/completions——用户消息管理、检索调用、RAG prompt 构建、LLM 流式调用、answer_citations 提取与持久化、降级策略（no_hit / model_knowledge）
- `chat-web-ui`: Cherry Web Chat 前端——消息列表、流式渲染、引用卡片展示、引用点击跳转 Wiki 页面、空状态/错误状态处理

### Modified Capabilities

（无——不修改已有 spec 的需求定义）

## Impact

- **Schema**: `packages/shared/src/schema/core.ts` 新增 chat_sessions / chat_messages / answer_citations 三张表 + 索引；`packages/shared/src/schema/validation.ts` 新增对应 Zod schema
- **Packages**: `packages/ai-core/` 新增 chat provider 抽象（与 embedding provider 并列）；`packages/rag-core/` 新增 retrieval engine（与 chunker 并列）
- **API**: `apps/api/src/chat/` 新增完整模块（controller + service + dto + guards）
- **Web**: `apps/web/src/` 新增 Chat 页面组件
- **依赖**: Node 侧复用已有 `openai` SDK（chat completions 与 embedding 共用）；新增 `eventsource-parser`（SSE 解析）或使用 OpenAI SDK 内置 streaming
- **权限**: Chat API 需 Space 级 `chat:use` 权限（已定义于 auth-core/constants.ts）；检索结果按 acl_json（AclJson: { tenant_id, space_id, allowed_group_ids, classification, page_id, page_version }）过滤
- **审计**: 新增 `chat.completion` 审计事件（含 token usage）
- **安全**: injection_risk chunk 在检索时降权（排在结果末尾或标注 `[UNVERIFIED]`）；system prompt 声明 context 为不可信数据并禁止执行 chunk 内指令；不直接检索 source_documents
