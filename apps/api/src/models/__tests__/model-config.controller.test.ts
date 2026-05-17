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
import { ModelConfigController, PublicModelConfigController } from '../model-config.controller.js';
import type { ModelConfigService } from '../model-config.service.js';

describe('ModelConfigController', () => {
  it('keeps admin model routes protected by admin:model_manage', () => {
    expect(getMetadata(ModelConfigController, 'listModels')).toBeUndefined();
    expect(getClassMetadata(ModelConfigController)).toEqual(['admin:model_manage']);
  });

  it('does not require admin:model_manage on chat availability endpoint', async () => {
    const guard = new RbacGuard(new Reflector());

    await expect(
      guard.canActivate(createGuardContext(PublicModelConfigController, 'isChatModelAvailable', createRequest('viewer'))),
    ).resolves.toBe(true);

    expect(getMetadata(PublicModelConfigController, 'isChatModelAvailable')).toBeUndefined();
    expect(getClassMetadata(PublicModelConfigController)).toBeUndefined();
  });

  it('rejects unauthenticated chat availability requests', async () => {
    const { controller } = createPublicControllerContext();

    await expect(controller.isChatModelAvailable({})).rejects.toMatchObject({
      status: 401,
    });
  });

  it('dispatches chat availability requests with tenant context and returns boolean only', async () => {
    const { controller, hasAvailableChatModel } = createPublicControllerContext();

    const result = await controller.isChatModelAvailable(createRequest('viewer'));

    expect(hasAvailableChatModel).toHaveBeenCalledWith({
      tenantId: TEST_TENANT_ID,
      actorUserId: TEST_USER_ID,
    });
    expect(result).toEqual({ available: true });
    expect(Object.keys(result)).toEqual(['available']);
  });

  it('allows non-admin users through RBAC while admin model routes remain denied', async () => {
    const guard = new RbacGuard(new Reflector());

    await expect(
      guard.canActivate(createGuardContext(PublicModelConfigController, 'isChatModelAvailable', createRequest('viewer'))),
    ).resolves.toBe(true);

    try {
      await guard.canActivate(createGuardContext(ModelConfigController, 'listModels', createRequest('viewer')));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(403);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
      return;
    }

    throw new Error('Expected RBAC guard to reject non-admin model management access');
  });
});

function createPublicControllerContext(): {
  controller: PublicModelConfigController;
  hasAvailableChatModel: ReturnType<typeof vi.fn<ModelConfigService['hasAvailableChatModel']>>;
} {
  const hasAvailableChatModel = vi.fn<ModelConfigService['hasAvailableChatModel']>(() =>
    Promise.resolve({ available: true }),
  );
  const service = {
    hasAvailableChatModel,
  } as unknown as ModelConfigService;

  return {
    controller: new PublicModelConfigController(service),
    hasAvailableChatModel,
  };
}

function createRequest(role: string): {
  user: AuthenticatedRequestUser;
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
  };
}

type ControllerClass = {
  prototype: object;
};

function getMetadata(controller: ControllerClass, methodName: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, methodName);
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, descriptor?.value as object);
}

function getClassMetadata(controller: ControllerClass): unknown {
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, controller);
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
