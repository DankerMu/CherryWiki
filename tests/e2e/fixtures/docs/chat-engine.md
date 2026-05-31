# Chat Engine and RAG

CherryWiki's chat engine streams retrieval-augmented answers with inline citations.

## Chat Flow

1. User sends message to `POST /api/chat/completions`
2. Server creates/reuses a `chat_session` for multi-turn context
3. Query embedded using same model as indexer
4. Retrieval phase: top-K chunks fetched from active index_snapshot
5. Context assembly: retrieved chunks formatted as numbered references
6. LLM completion: streaming response with `[^n]` citation markers
7. Citation extraction: `[^n]` markers mapped to chunk_id → wiki_page
8. Answer + citations persisted to `chat_messages` + `answer_citations`

## SSE Event Stream

The response is a Server-Sent Events stream:
```
data: {"type": "session", "session_id": "..."}
data: {"type": "content", "delta": "SSO is configured..."}
data: {"type": "content", "delta": " from the admin panel [^1]."}
data: {"type": "citations", "citations": [...]}
data: {"type": "usage", "prompt_tokens": 120, "completion_tokens": 45}
data: {"type": "message.completed", "message_id": "..."}
data: [DONE]
```

## Citation Object

```json
{
  "chunk_id": "uuid",
  "page_id": "uuid",
  "page_title": "Auth Design",
  "section_title": "Login Flow",
  "relevance_score": 0.92,
  "content_snippet": "User submits credentials...",
  "source_chain_json": {"source_doc": "...", "graph_node": "..."},
  "fallback": false
}
```

## Permission Enforcement

Chat results are filtered by the user's space permissions:
- Only chunks from spaces the user can access are included
- Cross-space queries respect group→space role mappings
- Unpublished (draft) wiki pages are excluded from retrieval
