# JWT Authentication

JWT Authentication is the central authentication mechanism for CherryGraph Studio. It issues short-lived access tokens (1h TTL) paired with rotating refresh tokens (7d TTL).

## Token Lifecycle

1. User submits credentials to `POST /api/auth/login`
2. Server validates and returns access + refresh token pair
3. Access token is included in `Authorization: Bearer` header for API calls
4. When access token expires, client uses refresh token to obtain a new pair
5. Old refresh token is invalidated on rotation

## Security Properties

- Access tokens are stateless JWTs verified by signature
- Refresh tokens are stored in the sessions table for explicit revocation
- All authentication events are logged to audit_logs
- Failed login attempts are rate-limited (5/min per IP)

## Connected Concepts

- Uses **Refresh Token Rotation** for token renewal
- Creates **Session Management** records on login
- Integrates with **RBAC Permission Model** for authorization

## Sources

- parsed-auth-design.md (L5, L9)
