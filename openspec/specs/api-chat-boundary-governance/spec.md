# api-chat-boundary-governance Specification

## Purpose
TBD - created by archiving change entropy-governance. Update Purpose after archive.
## Requirements
### Requirement: Chat service remains the public backend contract

The API SHALL keep `ChatService` as the public service consumed by the Chat controller while moving internal responsibilities into bounded collaborators.

#### Scenario: REST and SSE behavior is preserved
- **WHEN** a client sends an existing Chat request through the current controller route
- **THEN** the route, request DTO, response shape, SSE event names, and existing error codes remain compatible with pre-refactor behavior

#### Scenario: Chat service delegates bounded responsibilities
- **WHEN** session/scope, retrieval/rerank, model resolution, or persistence logic is changed after this refactor
- **THEN** the change lands in a focused collaborator or helper rather than adding another mixed responsibility block to `ChatService`

#### Scenario: Model resolution remains stable
- **WHEN** Chat resolves chat, embedding, or rerank model configuration for an existing request path
- **THEN** the selected provider config, missing-model error code, HTTP status, and fallback behavior match pre-refactor behavior

#### Scenario: Agent and static routing remains stable
- **WHEN** a request uses `enable_deep_analysis`, `enable_database`, a bound Agent conversation, or graph retrieval modes that currently route to Agent
- **THEN** the request still chooses the same Agent/static path and emits the same observable stream events as before the refactor

#### Scenario: Persistence and SSE shaping remain stable
- **WHEN** Chat writes messages, citations, retrieval traces, model usage logs, or completion metadata
- **THEN** the persisted table rows and SSE event names/order/data shapes remain compatible with current tests

### Requirement: Chat session and scope behavior is independently testable

The API SHALL isolate Chat session lifecycle, multi-space scope normalization, and space permission checks behind a focused boundary with regression tests.

#### Scenario: Existing session operations still pass
- **WHEN** tests create, list, open, update scope for, and delete Chat sessions
- **THEN** the behavior matches the current API contract including multi-space session support and unauthorized-space rejection

#### Scenario: Scope validation remains consistent
- **WHEN** a request provides empty, duplicate, over-limit, or mismatched `space_ids`
- **THEN** the API returns the same validation or permission behavior as before the refactor

### Requirement: Chat retrieval and rerank behavior is independently testable

The API SHALL isolate static retrieval, graph context retrieval, RRF fusion, rerank fallback, trace metadata, and strict/no-hit behavior behind a focused boundary with regression tests.

#### Scenario: Rerank failures remain non-fatal
- **WHEN** a configured rerank model times out, fails URL validation, or returns no usable scores
- **THEN** Chat keeps the RRF retrieval order and records rerank metadata without failing the user request

#### Scenario: Retrieval mode behavior remains stable
- **WHEN** a request uses `wiki_only`, `graph_rag`, `path_first`, or `community_first`
- **THEN** static retrieval behavior and Agent routing behavior remain separated, and each path produces the same observable context/citation behavior covered by existing tests
