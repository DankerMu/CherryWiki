## ADDED Requirements

### Requirement: Bridge NestJS module registration

The system SHALL register a BridgeModule in Docmost's `app.module.ts` imports array. The module SHALL be located at `apps/server/src/integrations/bridge/bridge.module.ts` and SHALL register all Bridge controllers and guards.

#### Scenario: Module loads successfully on Docmost startup
- **WHEN** Docmost server starts with DOCMOST_BRIDGE_SECRET environment variable set
- **THEN** BridgeModule registers without error and Bridge endpoints become available

#### Scenario: Module disabled when secret not configured
- **WHEN** Docmost server starts without DOCMOST_BRIDGE_SECRET environment variable
- **THEN** BridgeModule logs a warning and all Bridge endpoints return 503 Service Unavailable

### Requirement: Bridge routes excluded from workspace middleware

The system SHALL add `/api/internal/bridge` to the excludedPaths list in `main.ts` so Bridge routes bypass Docmost's workspaceId middleware. Only this specific prefix SHALL be excluded.

#### Scenario: Bridge routes bypass workspace check
- **WHEN** a request arrives at /api/internal/bridge/* with valid HMAC signature
- **THEN** the request is processed without requiring X-Workspace-Id header

#### Scenario: Non-bridge routes still require workspace
- **WHEN** a request arrives at /api/pages/* without X-Workspace-Id header
- **THEN** Docmost's workspace middleware rejects the request as before

### Requirement: BridgeAuthGuard HMAC-SHA256 verification

The system SHALL implement a BridgeAuthGuard that validates every request to /api/internal/bridge/* using:
1. Bearer token in Authorization header matching DOCMOST_BRIDGE_SECRET
2. HMAC-SHA256 signature in X-Bridge-Signature header
3. Timestamp in X-Bridge-Timestamp header (Unix seconds)
4. Nonce in X-Bridge-Nonce header (UUID, unique per request)

The HMAC payload SHALL be: `${timestamp}\n${nonce}\n${method}\n${path}\n${bodyHash}` where bodyHash is SHA256 of the raw request body (empty string hash for GET requests).

The system SHALL reject requests where the nonce has been seen within the past 10 minutes (using Redis SETNX with TTL=600s). This provides defense-in-depth beyond the timestamp window.

#### Scenario: Valid signature accepted
- **WHEN** request has correct Bearer token AND valid HMAC signature AND timestamp within 5 minutes AND fresh nonce
- **THEN** request proceeds to the controller

#### Scenario: Invalid HMAC signature rejected
- **WHEN** request has correct Bearer token BUT invalid HMAC signature
- **THEN** response is 401 with error code BRIDGE_HMAC_INVALID

#### Scenario: Missing Bearer token rejected
- **WHEN** request has no Authorization header or incorrect Bearer token
- **THEN** response is 401 with error code BRIDGE_AUTH_MISSING

#### Scenario: Expired timestamp rejected (replay protection)
- **WHEN** request has valid signature BUT X-Bridge-Timestamp is older than 5 minutes from server time
- **THEN** response is 401 with error code BRIDGE_TIMESTAMP_EXPIRED

#### Scenario: Missing timestamp rejected
- **WHEN** request has valid Bearer and HMAC but no X-Bridge-Timestamp header
- **THEN** response is 401 with error code BRIDGE_TIMESTAMP_MISSING

#### Scenario: Duplicate nonce rejected (replay protection)
- **WHEN** request has valid signature and timestamp BUT X-Bridge-Nonce was already used within 10 minutes
- **THEN** response is 401 with error code BRIDGE_NONCE_REUSED

#### Scenario: Missing nonce rejected
- **WHEN** request has valid Bearer, HMAC, and timestamp but no X-Bridge-Nonce header
- **THEN** response is 401 with error code BRIDGE_NONCE_MISSING

### Requirement: Secret rotation with dual-key window

The system SHALL support dual-key rotation for DOCMOST_BRIDGE_SECRET. When `DOCMOST_BRIDGE_SECRET_NEXT` is set, the BridgeAuthGuard SHALL accept signatures computed with either the current or the next key. The rotation window SHALL be 24 hours, after which the old key MUST be removed and the next key becomes current.

#### Scenario: Request signed with current key accepted
- **WHEN** request is signed with DOCMOST_BRIDGE_SECRET (current)
- **THEN** authentication succeeds

#### Scenario: Request signed with next key accepted during rotation
- **WHEN** DOCMOST_BRIDGE_SECRET_NEXT is configured AND request is signed with the next key
- **THEN** authentication succeeds

#### Scenario: Request signed with expired old key rejected
- **WHEN** DOCMOST_BRIDGE_SECRET was rotated (old key removed) AND request is signed with the old key
- **THEN** response is 401 with error code BRIDGE_HMAC_INVALID

### Requirement: Fork development red lines as acceptance criteria

The Bridge module SHALL NOT violate the following constraints (Doc 22 §5A):
1. SHALL NOT depend on Docmost private/unexported APIs — only use public DI container services
2. SHALL NOT add new Drizzle migrations to Docmost
3. SHALL NOT introduce new npm dependencies to Docmost
4. SHALL NOT add non-Bridge paths to excludedPaths

#### Scenario: No private API usage
- **WHEN** Bridge module code is reviewed
- **THEN** all imported services are obtained via NestJS public DI (e.g., PageService, AttachmentService), no internal file imports

#### Scenario: No new Drizzle migrations
- **WHEN** `apps/server/src/db/migrations/` is checked after Bridge development
- **THEN** no new migration files exist compared to baseline v0.80.1

### Requirement: Docker network isolation

The Bridge API endpoints SHALL only be accessible within the Docker cherry-net network. The Docmost service SHALL NOT map Bridge ports to the host machine. Nginx SHALL NOT proxy /api/internal/bridge/* to external traffic.

#### Scenario: Bridge port not exposed to host
- **WHEN** docker-compose.yml is inspected for the docmost service
- **THEN** no port mapping exposes the Bridge API to the host (only internal cherry-net communication)

#### Scenario: Nginx blocks Bridge path
- **WHEN** an external request targets /api/internal/bridge/* through Nginx
- **THEN** Nginx returns 404 or does not route the request to Docmost
