import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@cherrygraph/shared';
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { ROLES } from '../constants.js';
import { signAccessToken, signRefreshToken, type AccessTokenPayload } from '../jwt.js';
import { JwtAuthGuard, type AuthenticatedRequestUser } from '../jwt-auth.guard.js';
import { PERMISSIONS_METADATA_KEY } from '../permissions.decorator.js';
import { PUBLIC_METADATA_KEY } from '../public.decorator.js';
import { RbacGuard, type SpacePermissionResolver, type SpacePermissionResolverInput } from '../rbac.guard.js';

const SECRET = 'test-secret-with-enough-entropy';

describe('JwtAuthGuard', () => {
  it('allows a valid token and sets request.user', async () => {
    const token = await signAccessToken(createAccessPayload(), SECRET);
    const request: TestRequest = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };
    const guard = new JwtAuthGuard(new Reflector(), { jwtSecret: SECRET });

    await expect(guard.canActivate(createContext({ request }))).resolves.toBe(true);
    const user = request.user as AuthenticatedRequestUser | undefined;
    expect(user?.sub).toBe('user-1');
    expect(user?.tenant_id).toBe('tenant-1');
  });

  it('throws 401 for a missing token', async () => {
    const guard = new JwtAuthGuard(new Reflector(), { jwtSecret: SECRET });

    await expect(guard.canActivate(createContext({ request: { headers: {} } }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('allows a request already authenticated by an earlier guard', async () => {
    const guard = new JwtAuthGuard(new Reflector(), { jwtSecret: SECRET });

    await expect(
      guard.canActivate(
        createContext({
          request: {
            headers: {
              authorization: 'Bearer cwt_existing_api_token',
            },
            user: createRequestUser(),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('throws 401 for an invalid token', async () => {
    const guard = new JwtAuthGuard(new Reflector(), { jwtSecret: SECRET });

    await expect(
      guard.canActivate(
        createContext({
          request: {
            headers: {
              authorization: 'Bearer invalid-token',
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 when a refresh token is used as a bearer token', async () => {
    const token = await signRefreshToken({ session_id: 'session-1' }, SECRET);
    const guard = new JwtAuthGuard(new Reflector(), { jwtSecret: SECRET });

    await expect(
      guard.canActivate(
        createContext({
          request: {
            headers: {
              authorization: `Bearer ${token}`,
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('skips auth for public handlers', async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, handler);
    const guard = new JwtAuthGuard(new Reflector(), { jwtSecret: SECRET });

    await expect(guard.canActivate(createContext({ handler, request: { headers: {} } }))).resolves.toBe(true);
  });
});

describe('RbacGuard', () => {
  it('allows a user with the required space permission', async () => {
    let resolverInput: SpacePermissionResolverInput | undefined;
    const resolver: SpacePermissionResolver = {
      getPermissionsForUser(input) {
        resolverInput = input;
        return Promise.resolve(['space:view']);
      },
    };
    const guard = new RbacGuard(new Reflector(), resolver);
    const handler = withPermissions(['space:view']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: { space_id: 'space-1' },
            user: createRequestUser(),
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(resolverInput).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      groupIds: ['group-1'],
      spaceId: 'space-1',
    });
  });

  it('throws 403 for a user without the required space permission', async () => {
    const resolver: SpacePermissionResolver = {
      getPermissionsForUser() {
        return Promise.resolve([]);
      },
    };
    const guard = new RbacGuard(new Reflector(), resolver);
    const handler = withPermissions(['space:view']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: { space_id: 'space-1' },
            user: createRequestUser(),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('throws 403 for a space-scoped permission without a target space when the role lacks it', async () => {
    const guard = new RbacGuard(new Reflector(), {
      getPermissionsForUser() {
        return Promise.resolve(['space:admin']);
      },
    });
    const handler = withPermissions(['space:admin']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createRequestUser(),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows an editor through the guard for upload:read without a target space', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['upload:read']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createRequestUser({ role: ROLES.EDITOR }),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('allows an editor through the guard for upload:create without a target space', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['upload:create']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createRequestUser({ role: ROLES.EDITOR }),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('throws 403 for a viewer requesting upload:create without a target space', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['upload:create']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createRequestUser({ role: ROLES.VIEWER }),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('throws 403 for an auditor requesting upload:read without a target space', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['upload:read']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createRequestUser({ role: ROLES.AUDITOR }),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows an admin to authorize a space-scoped permission without a target space', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['space:view']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createRequestUser({ role: ROLES.ADMIN }),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('throws 403 for an API token on a route without explicit permissions', async () => {
    const guard = new RbacGuard(new Reflector());

    const error = await getRejectedHttpException(
      guard.canActivate(
        createContext({
          request: {
            params: {},
            user: createApiTokenRequestUser({ scopes: ['mcp:invoke'] }),
          },
        }),
      ),
    );

    expect(error.getStatus()).toBe(403);
    expect(getHttpExceptionCode(error)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(getHttpExceptionMessage(error)).toBe('API token cannot access routes without explicit permission scope');
  });

  it('allows an API token on a public route without explicit permissions', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPublicMetadata();

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createApiTokenRequestUser({ scopes: ['mcp:invoke'] }),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('allows a JWT session user on a route without explicit permissions', async () => {
    const guard = new RbacGuard(new Reflector());

    await expect(
      guard.canActivate(
        createContext({
          request: {
            params: {},
            user: createRequestUser(),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('allows an API token when both token scope and role permission match', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['admin:user_manage']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createApiTokenRequestUser({ role: ROLES.ADMIN, scopes: ['admin:user_manage'] }),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('throws 403 when an API token role matches but the token scope is missing', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['admin:user_manage']);

    const error = await getRejectedHttpException(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createApiTokenRequestUser({ role: ROLES.ADMIN, scopes: ['admin:audit_view'] }),
          },
        }),
      ),
    );

    expect(error.getStatus()).toBe(403);
    expect(getHttpExceptionCode(error)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(getHttpExceptionDetails(error)).toBeUndefined();
    expect(getHttpExceptionResponse(error)).not.toHaveProperty('denied_scope');
  });

  it('throws 403 when an owner API token lacks the admin REST scope', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['admin:user_manage']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createApiTokenRequestUser({ role: ROLES.OWNER, scopes: ['upload:create'] }),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('does not let an MCP-only scope satisfy a REST admin permission', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['admin:user_manage']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createApiTokenRequestUser({ role: ROLES.OWNER, scopes: ['mcp:invoke'] }),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('checks upload and graphify REST scopes independently for API tokens', async () => {
    const guard = new RbacGuard(new Reflector(), {
      getPermissionsForUser() {
        return Promise.resolve(['upload:create', 'graphify:run']);
      },
    });

    await expect(
      guard.canActivate(
        createContext({
          handler: withPermissions(['upload:create']),
          request: {
            params: { spaceId: 'space-1' },
            user: createApiTokenRequestUser({ role: ROLES.EDITOR, scopes: ['upload:create'] }),
          },
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        createContext({
          handler: withPermissions(['graphify:run']),
          request: {
            params: { spaceId: 'space-1' },
            user: createApiTokenRequestUser({ role: ROLES.EDITOR, scopes: ['upload:create'] }),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('keeps JWT session RBAC behavior free of token scope checks', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['admin:user_manage']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createRequestUser({ role: ROLES.OWNER }),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('allows an API token with all required REST scopes', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['admin', 'admin:user_manage']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: {},
            user: createApiTokenRequestUser({
              role: ROLES.ADMIN,
              scopes: ['admin', 'admin:user_manage'],
            }),
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('uses body space_id for space-scoped chat permissions', async () => {
    let resolverInput: SpacePermissionResolverInput | undefined;
    const guard = new RbacGuard(new Reflector(), {
      getPermissionsForUser(input) {
        resolverInput = input;
        return Promise.resolve(['chat:use']);
      },
    });
    const handler = withPermissions(['chat:use']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            body: { space_id: 'space-1' },
            user: createRequestUser(),
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(resolverInput).toMatchObject({
      spaceId: 'space-1',
      requiredPermissions: ['chat:use'],
    });
  });

  it('throws 403 when chat permission is missing for the target space', async () => {
    const guard = new RbacGuard(new Reflector(), {
      getPermissionsForUser() {
        return Promise.resolve(['space:view']);
      },
    });
    const handler = withPermissions(['chat:use']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            body: { space_id: 'space-1' },
            user: createRequestUser(),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('throws 401 for a malformed user without a role', async () => {
    const guard = new RbacGuard(new Reflector());
    const handler = withPermissions(['space:view']);

    await expect(
      guard.canActivate(
        createContext({
          handler,
          request: {
            params: { space_id: 'space-1' },
            user: {
              sub: 'user-1',
              tenant_id: 'tenant-1',
              email: 'user@example.com',
              group_ids: ['group-1'],
              token_use: 'access',
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('returns PERMISSION_DENIED when authorization fails', async () => {
    const guard = new RbacGuard(new Reflector(), {
      getPermissionsForUser() {
        return Promise.resolve([]);
      },
    });
    const handler = withPermissions(['space:view']);

    try {
      await guard.canActivate(
        createContext({
          handler,
          request: {
            params: { space_id: 'space-1' },
            user: createRequestUser(),
          },
        }),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const response = (err as HttpException).getResponse();
      expect(isRecord(response) ? response.code : undefined).toBe(ErrorCode.PERMISSION_DENIED);
    }
  });
});

type TestRequest = {
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  user?: unknown;
};

function createContext(input: {
  handler?: () => undefined;
  request: TestRequest;
}): ExecutionContext {
  const handler = input.handler ?? (() => undefined);

  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => input.request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function withPermissions(permissions: string[]): () => undefined {
  const handler = () => undefined;
  Reflect.defineMetadata(PERMISSIONS_METADATA_KEY, permissions, handler);
  return handler;
}

function withPublicMetadata(): () => undefined {
  const handler = () => undefined;
  Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, handler);
  return handler;
}

function createAccessPayload(): AccessTokenPayload {
  return {
    sub: 'user-1',
    tenant_id: 'tenant-1',
    email: 'user@example.com',
    role: ROLES.VIEWER,
    group_ids: ['group-1'],
  };
}

function createRequestUser(overrides: Partial<AuthenticatedRequestUser> = {}): AuthenticatedRequestUser {
  return {
    ...createAccessPayload(),
    token_use: 'access',
    ...overrides,
  };
}

function createApiTokenRequestUser(
  overrides: Partial<AuthenticatedRequestUser & { scopes: string[]; token_id: string }> = {},
): AuthenticatedRequestUser & { scopes: string[]; token_id: string } {
  return {
    ...createRequestUser({ role: ROLES.ADMIN }),
    scopes: ['admin:user_manage'],
    token_id: 'api-token-1',
    ...overrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function getRejectedHttpException(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return err as HttpException;
  }

  throw new Error('Expected promise to reject with HttpException');
}

function getHttpExceptionCode(error: HttpException): unknown {
  const response = getHttpExceptionResponse(error);
  return isRecord(response) ? response.code : undefined;
}

function getHttpExceptionMessage(error: HttpException): unknown {
  const response = getHttpExceptionResponse(error);
  return isRecord(response) ? response.message : undefined;
}

function getHttpExceptionDetails(error: HttpException): unknown {
  const response = getHttpExceptionResponse(error);
  return isRecord(response) ? response.details : undefined;
}

function getHttpExceptionResponse(error: HttpException): unknown {
  const response = error.getResponse();
  return response;
}
