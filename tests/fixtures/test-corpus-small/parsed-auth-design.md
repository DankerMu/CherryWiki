# Authentication Module Design

## Overview

CherryGraph Studio uses JWT-based authentication with refresh token rotation. All API endpoints except `/api/auth/login` and `/api/health` require a valid access token.

## Token Lifecycle

Access tokens expire after 1 hour. Refresh tokens expire after 7 days and are rotated on each use — the old refresh token is invalidated immediately.

### Session Management

Each login creates a session record in the `sessions` table. Sessions track:

- Device information (user agent, IP)
- Last activity timestamp
- Explicit revocation status

Users can view and revoke their own sessions via `GET /api/auth/sessions` and `DELETE /api/auth/sessions/{session_id}`.

## Password Policy

Passwords must meet the following criteria:

- Minimum 8 characters
- At least one uppercase letter
- At least one digit
- At least one special character

Password changes require the current password for verification. Failed attempts are rate-limited to 5 per minute.

## Audit Trail

All authentication events are logged to `audit_logs`:

| Event | Action |
|---|---|
| Login | `auth.login` |
| Logout | `auth.logout` |
| Token refresh | `auth.token_refresh` |
| Password change | `auth.password_change` |
| Session revoke | `auth.session_revoke` |
