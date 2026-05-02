# Auth System

## Overview

The authentication system provides JWT-based access control for CherryGraph Studio. It handles user login, token lifecycle management, and session tracking.

## Key Components

### JWT Authentication
JWT tokens serve as the primary authentication mechanism. Access tokens have a 1-hour TTL, while refresh tokens last 7 days with rotation on each use.

### Refresh Token Rotation
Each token refresh invalidates the previous refresh token immediately, preventing token replay attacks.

### Session Management
Login events create session records tracking device information, IP address, and last activity. Users can view and revoke their own sessions through the API.

## Relationships

- JWT Authentication **uses** Refresh Token Rotation
- JWT Authentication **creates** Session Management records
- JWT Authentication **integrates with** RBAC Permission Model (inferred)

## Sources

- parsed-auth-design.md
