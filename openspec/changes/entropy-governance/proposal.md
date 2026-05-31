# Proposal: Entropy Governance

## Why

The repository entropy audit found two high-entropy implementation hotspots (`apps/api`, `apps/web`) and several medium-spread replication risks in worker protocol code and agent-facing context boundaries. These are not immediate product bugs, but they increase the chance that future feature work copies large mixed-responsibility files, local error helpers, and duplicated worker lifecycle code.

## What Changes

- Introduce a behavior-preserving entropy governance stage that decomposes existing hotspots without changing user-visible product behavior.
- Split the Chat backend into bounded services so session/scope handling, retrieval/rerank, agent routing, and persistence do not keep accumulating in one file.
- Normalize API error construction around a single helper and shared `ErrorCode` values.
- Split the Chat frontend page into focused hooks and presentational components while preserving current UX and tests.
- Extract or template the Python worker job protocol used by ingestion and URL fetch workers.
- Add scoped `AGENTS.md` files for critical implementation boundaries so future agents have local module constraints.

No breaking API route, database schema, or user workflow change is intended.

## Capabilities

### New Capabilities

- `api-chat-boundary-governance`: Refactor Chat backend responsibilities into bounded services with unchanged REST/SSE behavior.
- `api-error-contract-governance`: Centralize API error construction and remove local string error-code drift.
- `web-chat-boundary-governance`: Refactor Chat frontend page state and rendering into focused hooks/components with unchanged UX.
- `python-worker-protocol-governance`: Reduce duplicated Python worker job lifecycle protocol across ingestion and URL fetch workers.
- `agent-context-boundaries`: Add scoped agent instruction files for implementation modules that currently rely only on root rules.

### Modified Capabilities

None.

## Impact

- **API code**: `apps/api/src/chat/**`, common API error helper location, selected services currently defining local `throwApiError`.
- **Web code**: `apps/web/src/pages/Chat.tsx`, new `apps/web/src/pages/chat/**` or equivalent hooks/components.
- **Worker code**: `apps/ingestion-worker/**`, `apps/url-fetcher-worker/**`, optional shared Python worker package or explicit shared template.
- **Agent context**: scoped `AGENTS.md` files under `apps/`, `packages/`, and `tools/`.
- **Verification**: Existing unit/integration tests must remain green; new characterization tests must cover behavior before each refactor slice.
- **Out of scope**: no product feature expansion, no schema migration, no route rename, no UI redesign.
