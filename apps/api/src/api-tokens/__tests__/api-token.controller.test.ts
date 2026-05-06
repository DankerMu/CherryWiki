import 'reflect-metadata';

import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_METADATA_KEY,
  RbacGuard,
  type AuthenticatedRequestUser,
} from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  TEST_TENANT_ID,
  TEST_USER_ID,
  getHttpExceptionCode,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { ApiTokenAdminController } from '../api-token.controller.js';
import type { ApiTokenService } from '../api-token.service.js';

describe('ApiTokenAdminController', () => {
  it('applies admin permissions metadata', () => {
    expect(getMetadata(ApiTokenAdminController, 'createToken')).toEqual(['admin:user_manage']);
    expect(getMetadata(ApiTokenAdminController, 'listTokens')).toEqual(['admin:user_manage']);
    expect(getMetadata(ApiTokenAdminController, 'revokeToken')).toEqual(['admin:user_manage']);
  });

  it('allows admins and rejects non-admins through the RBAC guard', async () => {
    const guard = new RbacGuard(new Reflector());

    await expect(
      guard.canActivate(createGuardContext(ApiTokenAdminController, 'createToken', createRequest('admin'))),
    ).resolves.toBe(true);

    try {
      await guard.canActivate(createGuardContext(ApiTokenAdminController, 'createToken', createRequest('viewer')));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(403);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
      return;
    }

    throw new Error('Expected RBAC guard to reject non-admin API token management');
  });

  it('passes create requests to the service and returns raw_token once', async () => {
    const { service, createToken } = createServiceMock();
    const controller = new ApiTokenAdminController(service);
    const body = { name: 'MCP token', scopes: ['mcp:invoke'] };

    const result = await controller.createToken(body, createRequest('admin'));

    expect(createToken).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
      }),
    );
    expect(result.raw_token).toMatch(/^cwt_[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty('token_hash');
  });

  it('returns list results with prefixes and no hashes', async () => {
    const { service, listTokens } = createServiceMock();
    const controller = new ApiTokenAdminController(service);

    const result = await controller.listTokens({}, createRequest('admin'));

    expect(listTokens).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
      }),
    );
    expect(result[0]).toMatchObject({ token_prefix: 'cwt_ab12' });
    expect(result[0]).not.toHaveProperty('token_hash');
  });
});

function createServiceMock(): {
  service: ApiTokenService;
  createToken: ReturnType<typeof vi.fn<ApiTokenService['createToken']>>;
  listTokens: ReturnType<typeof vi.fn<ApiTokenService['listTokens']>>;
  revokeToken: ReturnType<typeof vi.fn<ApiTokenService['revokeToken']>>;
} {
  const listItem = {
    id: 'api-token-1',
    name: 'MCP token',
    token_prefix: 'cwt_ab12',
    scopes: ['mcp:invoke'],
    last_used_at: null,
    expires_at: null,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
  };
  const createToken = vi.fn<ApiTokenService['createToken']>(() =>
    Promise.resolve({
      ...listItem,
      raw_token: `cwt_${'a'.repeat(64)}`,
    }),
  );
  const listTokens = vi.fn<ApiTokenService['listTokens']>(() => Promise.resolve([listItem]));
  const revokeToken = vi.fn<ApiTokenService['revokeToken']>(() =>
    Promise.resolve({ id: 'api-token-1', revoked_at: new Date('2026-05-02T00:00:00.000Z') }),
  );

  return {
    createToken,
    listTokens,
    revokeToken,
    service: {
      createToken,
      listTokens,
      revokeToken,
    } as unknown as ApiTokenService,
  };
}

function createRequest(role: string): {
  user: AuthenticatedRequestUser;
  ip: string;
  headers: Record<string, string>;
} {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: `${role}@example.com`,
      role,
      group_ids: [],
      token_use: 'access',
    },
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'vitest',
      'x-request-id': 'req-1',
    },
  };
}

type ControllerClass = {
  prototype: object;
};

function getMetadata(controller: ControllerClass, methodName: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, methodName);
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, descriptor?.value as object);
}

function createGuardContext(controller: ControllerClass, methodName: string, request: unknown): ExecutionContext {
  const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, methodName);
  return {
    getHandler: () => descriptor?.value as () => unknown,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}
