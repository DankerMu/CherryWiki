## ADDED Requirements

### Requirement: Critical modules have scoped agent instructions

Critical implementation boundaries SHALL have scoped `AGENTS.md` files that describe local ownership boundaries, verification commands, and pitfalls without weakening root instructions.

#### Scenario: API scope is explicit
- **WHEN** an agent works under `apps/api/`
- **THEN** it can read a scoped instruction file covering NestJS/API boundaries, shared package reuse, error contract, permission checks, and targeted API test commands

#### Scenario: Web scope is explicit
- **WHEN** an agent works under `apps/web/`
- **THEN** it can read a scoped instruction file covering React/Ant Design patterns, i18n expectations, theme tokens, and targeted Web test/typecheck commands

#### Scenario: Worker scopes are explicit
- **WHEN** an agent works under Python or Node worker directories
- **THEN** it can read scoped instructions covering venv usage, queue protocol, Docker/CI considerations, and worker-specific tests

#### Scenario: Package and tool scopes are explicit
- **WHEN** an agent works under `packages/` or `tools/`
- **THEN** scoped instructions clarify framework-neutral package boundaries, CLI behavior, and targeted verification commands

### Requirement: Scoped instructions stay concise and non-conflicting

Scoped `AGENTS.md` files SHALL reference root rules for global policy and only add stricter module-local guidance.

#### Scenario: Root rules remain authoritative
- **WHEN** a scoped instruction file is added
- **THEN** it does not relax root requirements for completeness, Python venv usage, Docker safety, testing, or progress updates

#### Scenario: Reference projects stay out of implementation scope
- **WHEN** scoped instructions describe entropy governance or verification scope
- **THEN** they explicitly keep `external/*` reference or forked third-party code out of this project's implementation refactor scope
