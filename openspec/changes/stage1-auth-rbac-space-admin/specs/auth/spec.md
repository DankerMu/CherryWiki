## ADDED Requirements

### Requirement: User login with email and password
The system SHALL authenticate users via email + password and return a JWT access_token (1h TTL) and refresh_token (7d TTL). The access_token SHALL be returned in the response body. The refresh_token SHALL be set as an httpOnly secure cookie AND returned in the response body.

#### Scenario: Successful login
- **WHEN** user POSTs to `/api/auth/login` with valid email and password
- **THEN** system returns `200` with `access_token`, `refresh_token`, `expires_in`, and user profile (id, email, name, role, groups)

#### Scenario: Invalid credentials
- **WHEN** user POSTs to `/api/auth/login` with wrong password
- **THEN** system returns `401` with error code `INVALID_CREDENTIALS`
- **THEN** system records a failed login attempt for that email

#### Scenario: Disabled account
- **WHEN** user POSTs to `/api/auth/login` with a disabled account's email
- **THEN** system returns `401` with error code `ACCOUNT_DISABLED`

### Requirement: Login lockout after repeated failures
The system SHALL lock an account for 15 minutes after 5 consecutive failed login attempts from any IP.

#### Scenario: Account lockout triggered
- **WHEN** user fails login 5 times consecutively for the same email
- **THEN** the 6th attempt returns `401` with error code `ACCOUNT_LOCKED`
- **THEN** lockout expires after 15 minutes

#### Scenario: Successful login resets counter
- **WHEN** user fails login 3 times then succeeds
- **THEN** the failure counter resets to 0

### Requirement: Login rate limiting
The system SHALL rate limit login attempts to 10 requests per minute per IP address.

#### Scenario: Rate limit exceeded
- **WHEN** more than 10 login requests arrive from the same IP within 1 minute
- **THEN** system returns `429 Too Many Requests` with `X-RateLimit-Reset` header

### Requirement: Token refresh
The system SHALL issue a new access_token and refresh_token pair when a valid refresh_token is presented. The old refresh_token SHALL be invalidated (rotation).

#### Scenario: Successful refresh
- **WHEN** user POSTs to `/api/auth/refresh` with a valid refresh_token
- **THEN** system returns new `access_token` and `refresh_token`
- **THEN** the old refresh_token is invalidated in the sessions table

#### Scenario: Invalid refresh token
- **WHEN** user POSTs to `/api/auth/refresh` with an expired or revoked refresh_token
- **THEN** system returns `401` with error code `INVALID_REFRESH_TOKEN`

#### Scenario: Revoked token
- **WHEN** user POSTs to `/api/auth/refresh` with a refresh_token that has been revoked via session management
- **THEN** system returns `401` with error code `TOKEN_REVOKED`

### Requirement: Logout
The system SHALL revoke the current session's refresh_token on logout.

#### Scenario: Successful logout
- **WHEN** authenticated user POSTs to `/api/auth/logout`
- **THEN** system revokes the session (sets `revoked_at` in sessions table)
- **THEN** system records `auth.logout` audit event
- **THEN** system returns `200` with `{ "data": { "success": true } }`

### Requirement: Current user profile
The system SHALL return the authenticated user's profile including their groups and accessible spaces.

#### Scenario: Get current user
- **WHEN** authenticated user GETs `/api/auth/me`
- **THEN** system returns user id, email, name, role, groups (id + name), and spaces (id + name + role)

#### Scenario: Unauthenticated request
- **WHEN** request without valid access_token GETs `/api/auth/me`
- **THEN** system returns `401` with error code `UNAUTHENTICATED`

### Requirement: Password change
The system SHALL allow authenticated users to change their own password.

#### Scenario: Successful password change
- **WHEN** authenticated user POSTs to `/api/auth/password/change` with correct current_password and valid new_password
- **THEN** system updates the password hash
- **THEN** system records `auth.password_change` audit event

#### Scenario: Wrong current password
- **WHEN** user provides incorrect current_password
- **THEN** system returns `400` with error code `INVALID_CURRENT_PASSWORD`

#### Scenario: Weak new password
- **WHEN** new_password does not meet strength requirements (min 8 chars, mix of letter/number/symbol)
- **THEN** system returns `422` with error code `PASSWORD_TOO_WEAK`

### Requirement: Session management
The system SHALL allow users to view and revoke their own sessions.

#### Scenario: List sessions
- **WHEN** authenticated user GETs `/api/auth/sessions`
- **THEN** system returns list of active sessions with id, ip, user_agent, created_at, last_used_at, and is_current flag

#### Scenario: Revoke a session
- **WHEN** authenticated user DELETEs `/api/auth/sessions/{session_id}` for their own session
- **THEN** system revokes that session
- **THEN** system records `auth.session_revoke` audit event

#### Scenario: Revoke other user's session
- **WHEN** user attempts to DELETE a session belonging to another user
- **THEN** system returns `404` with error code `SESSION_NOT_FOUND`

### Requirement: Password hashing with argon2id
The system SHALL hash all passwords using argon2id. The system MUST NOT store plaintext passwords.

#### Scenario: Password stored securely
- **WHEN** a user is created or changes password
- **THEN** the password is hashed with argon2id before storage
- **THEN** the original plaintext password is not persisted anywhere

### Requirement: JWT payload structure
The access_token JWT SHALL contain tenant_id, user_id, email, role, and group_ids. It MUST NOT contain the password hash or any secret material.

#### Scenario: JWT contains required claims
- **WHEN** an access_token is issued
- **THEN** the JWT payload includes `sub` (user_id), `tenant_id`, `email`, `role`, `group_ids`, `iat`, `exp`
