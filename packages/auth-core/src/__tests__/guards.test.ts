import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@cherrygraph/shared';
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { ROLES } from '../constants.js';
import { signAccessToken, type AccessTokenPayload } from '../jwt.js';
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
    expect(request.user?.sub).toBe('user-1');
    expect(request.user?.tenant_id).toBe('tenant-1');
  });

  it('throws 401 for a missing token', async () => {
    const guard = new JwtAuthGuard(new Reflector(), { jwtSecret: SECRET });

    await expect(guard.canActivate(createContext({ request: { headers: {} } }))).rejects.toMatchObject({
      status: 401,
    });
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
  user?: AuthenticatedRequestUser;
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

function createAccessPayload(): AccessTokenPayload {
  return {
    sub: 'user-1',
    tenant_id: 'tenant-1',
    email: 'user@example.com',
    role: ROLES.VIEWER,
    group_ids: ['group-1'],
  };
}

function createRequestUser(): AuthenticatedRequestUser {
  return createAccessPayload();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
