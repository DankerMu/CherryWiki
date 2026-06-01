# web-chat-boundary-governance Specification

## Purpose
TBD - created by archiving change entropy-governance. Update Purpose after archive.
## Requirements
### Requirement: Chat page becomes a composition boundary

The Web Chat page SHALL be split so page-level composition is separate from session state, space-scope state, input controls, message rendering, and citation/source-chain rendering.

#### Scenario: Existing Chat UX is preserved
- **WHEN** a user opens Chat, switches sessions, sends messages, changes multi-space scope, sees model-unavailable state, or expands citations
- **THEN** the visible behavior and existing i18n text remain compatible with current tests

#### Scenario: Database gating remains stable
- **WHEN** a user toggles database mode with and without a configured Space database
- **THEN** the enabled/disabled state, request payload, completion metadata, and visible gating text remain compatible with current tests

#### Scenario: Layout controls remain stable
- **WHEN** a user uses current Chat layout controls such as sidebar/session list visibility and page scrolling behavior
- **THEN** the refactored page preserves the same visible layout behavior at supported desktop and mobile widths

#### Scenario: Hooks own stateful workflows
- **WHEN** session loading/deletion or selected-space scope management changes after this refactor
- **THEN** the change lands in a focused hook rather than adding more state transitions directly to `Chat.tsx`

### Requirement: Message and citation rendering are isolated

The Web Chat UI SHALL isolate markdown/message part rendering and citation/source-chain rendering into focused components with regression tests.

#### Scenario: Citation navigation remains stable
- **WHEN** a citation includes page, section, graph edge, graph path, or source-space data
- **THEN** the refactored citation component renders the same navigable information and badges as before

#### Scenario: Source chain rendering remains stable
- **WHEN** a citation includes source-chain metadata
- **THEN** the refactored component preserves the same expansion behavior, labels, and navigation targets as before

#### Scenario: Unsafe markdown behavior remains stable
- **WHEN** assistant markdown contains images or external links
- **THEN** image rendering remains disabled and external links retain safe attributes
