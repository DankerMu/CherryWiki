## ADDED Requirements

### Requirement: API error throwing uses one helper

API services and controllers SHALL use a single common helper for throwing HTTP errors with the project's error envelope.

#### Scenario: Local throw helpers are removed
- **WHEN** a service or controller needs to throw an API error with `{ code, message }`
- **THEN** it imports the common API error helper instead of defining a local `throwApiError` function

#### Scenario: Error envelope remains compatible
- **WHEN** the global HTTP exception filter handles an error thrown by the common helper
- **THEN** the response still uses `{ error: { code, message, details? }, meta: { request_id } }`

#### Scenario: HTTP status remains compatible
- **WHEN** an existing local helper call is migrated to the common helper
- **THEN** the HTTP status, `error.code`, message, details payload, and `meta.request_id` behavior remain the same for representative 400, 401, 403, 404, 409, 422, and 500 paths

### Requirement: Error codes are canonical

Error code values SHALL be defined in `packages/shared/src/errors.ts` when they are returned to API clients.

#### Scenario: Local string error code is promoted
- **WHEN** existing API code returns a string code that is not in shared `ErrorCode`
- **THEN** the code is added to `ErrorCode`, covered by tests, and used through the common helper

#### Scenario: Unknown local codes do not spread
- **WHEN** a new API error is added after this change
- **THEN** tests or lintable code review evidence must show it uses a shared `ErrorCode` value rather than an untracked local string

#### Scenario: Local helper definitions are blocked by scan
- **WHEN** the API error migration is complete
- **THEN** a repository scan shows no `function throwApiError` definitions under `apps/api/src/**` outside the common helper file
