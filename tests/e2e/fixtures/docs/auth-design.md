# JWT Authentication Architecture

CherryWiki uses short-lived JWT access tokens (1-hour TTL) paired with rotating refresh tokens (7-day TTL) for stateless authentication.

## Login Flow

1. User submits credentials to `POST /api/auth/login`
2. Server validates email/password against argon2id hash
3. Server issues access_token + refresh_token pair
4. Access token contains: sub (user_id), tenant_id, role, group_ids

## Token Refresh

When the access token expires, the client sends the refresh token to `POST /api/auth/refresh`. The server:
- Validates the refresh token signature and expiry
- Rotates the refresh token (old token invalidated immediately)
- Issues a new access_token + refresh_token pair

Refresh tokens are stored in the `sessions` table for explicit revocation. Each session tracks device information, IP address, and last activity timestamp.

## Security Measures

- Failed login attempts are rate-limited (5/min per IP)
- All authentication events are logged to `audit_logs`
- Session tokens use cryptographically secure random IDs
- Password hashing uses argon2id with recommended parameters
