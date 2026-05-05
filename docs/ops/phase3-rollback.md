# Phase 3 GraphRAG Agent Rollback Procedure

Use this procedure when Phase 3 Graph API, GraphRAG fusion, Agent, or cherrydb paths cause availability, security, or data integrity issues that cannot be fixed forward quickly.

## 1. Disable Deep Paths

1. Remove or unset `AGENT_ANTHROPIC_API_KEY`, `CHERRY_AGENT_TOKEN`, and `CHERRY_DB_*` from the API runtime.
2. Stop the `cherry-agent` Compose profile if it is running:
   ```bash
   docker compose --profile agent stop cherry-agent
   ```
3. Temporarily hide frontend `enable_deep_analysis`, `enable_database`, `graph_rag`, `path_first`, and `community_first` controls.
4. Keep static Wiki RAG online. Static RAG should continue to use vector/BM25 retrieval and strict no-hit behavior.

## 2. Freeze Graph Activation

1. Pause new Graphify imports and do not activate new `index_snapshots`.
2. Keep the last known-good `active_graphify_run_id` and `active_index_snapshot_id` on each Space.
3. If a new graph caused bad answers, restore each affected Space to the previous active run/snapshot pair.

## 3. Protect Data Access

1. Set affected `spaces.database_config.enabled=false` or remove the encrypted DSN from `database_config`.
2. Revoke readonly database credentials used by `CHERRY_DB_DSN` if query audit logs show unsafe access.
3. Export `audit_logs` rows with `action='database_query'` for incident review before pruning any data.

## 4. Deploy Last Known Good

1. Re-deploy the last build before Phase 3 Agent enablement, or deploy a fixed build with Agent routing disabled.
2. Run:
   ```bash
   pnpm build
   pnpm exec vitest run tests/integration/chat-rag-flow.test.ts tests/integration/chat-degradation.test.ts --config vitest.config.ts
   docker compose config --quiet
   ```
3. Confirm `/api/chat/completions` succeeds for `wiki_only` requests and no Agent process is spawned.

## 5. Re-enable Safely

Re-enable Phase 3 only after these checks pass:

- Graph API unit tests and `tests/integration/graph-search-path.test.ts`.
- Agent unit tests and `tests/integration/agent-e2e.test.ts`.
- cherrydb unit tests and `tests/integration/cherrydb-e2e.test.ts`.
- Audit review confirms no unexpected SQL, graph, or sandbox access.
