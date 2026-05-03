## ADDED Requirements

### Requirement: Chat sessions table
The system SHALL define a `chat_sessions` table with columns: id (PK, text), tenant_id (FK tenants), space_id (FK spaces), user_id (FK users), title (text, nullable), created_at (timestamptz), updated_at (timestamptz). The table SHALL have indices on (tenant_id, space_id, user_id) and (user_id, updated_at DESC).

#### Scenario: Session creation
- **WHEN** a new chat session record is inserted
- **THEN** id SHALL be a UUID (via crypto.randomUUID(), consistent with project convention), created_at and updated_at SHALL default to now(), title SHALL be null (auto-generated after first response)

#### Scenario: Session belongs to space
- **WHEN** querying sessions for a space
- **THEN** results SHALL be filtered by both tenant_id and space_id

### Requirement: Chat messages table
The system SHALL define a `chat_messages` table with columns: id (PK, text), session_id (FK chat_sessions, ON DELETE CASCADE), role (text, enum: 'user'/'assistant'/'system'), content (text), token_count (integer, nullable), citations_json (jsonb, default '[]'), metadata_json (jsonb, default '{}'), created_at (timestamptz). The table SHALL have an index on (session_id, created_at ASC).

#### Scenario: Message ordering
- **WHEN** messages are queried for a session
- **THEN** they SHALL be returned ordered by created_at ASC

#### Scenario: Role validation
- **WHEN** a message is inserted with role not in ('user', 'assistant', 'system')
- **THEN** the insert SHALL be rejected by Zod validation

### Requirement: Answer citations table
The system SHALL define an `answer_citations` table with columns: id (PK, text), message_id (FK chat_messages, ON DELETE CASCADE), wiki_page_pk (FK wiki_pages), section_id (FK wiki_sections, nullable), chunk_id (FK wiki_chunks, nullable), relevance_score (real), source_chain_json (jsonb), display_text (text), created_at (timestamptz). The table SHALL have indices on (message_id) and (wiki_page_pk).

#### Scenario: Citation links to wiki page
- **WHEN** a citation record is created
- **THEN** wiki_page_pk MUST reference a valid published wiki page

#### Scenario: Citation cascade delete
- **WHEN** a chat message is deleted
- **THEN** all associated answer_citations SHALL be cascade deleted

### Requirement: Zod validation schemas
The system SHALL export Zod schemas: chatSessionSchema, chatMessageSchema, answerCitationSchema, chatMessageRoleSchema (z.enum(['user','assistant','system'])). These SHALL be consistent with the Drizzle table definitions.

#### Scenario: Schema validation round-trip
- **WHEN** a valid chat_messages row is parsed through chatMessageSchema
- **THEN** it SHALL pass validation without errors

#### Scenario: Invalid role rejected
- **WHEN** a message with role='tool' is validated against chatMessageRoleSchema
- **THEN** validation SHALL fail with ZodError
