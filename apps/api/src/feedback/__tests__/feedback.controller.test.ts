import 'reflect-metadata';

import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_METADATA_KEY,
  RbacGuard,
  type AuthenticatedRequestUser,
  type SpacePermissionResolver,
} from '@cherrygraph/auth-core';
import { ErrorCode, feedbackItems } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  getHttpExceptionCode,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { FeedbackAdminController, FeedbackController } from '../feedback.controller.js';
import type { FeedbackService } from '../feedback.service.js';

describe('FeedbackController', () => {
  it('applies feedback permissions metadata', () => {
    expect(getMetadata(FeedbackController, 'createFeedback')).toEqual(['space:read']);
    expect(getMetadata(FeedbackAdminController, 'listFeedback')).toEqual(['admin:user_manage']);
    expect(getMetadata(FeedbackAdminController, 'resolveFeedback')).toEqual(['admin:user_manage']);
  });

  it('allows a viewer with space read permission to submit feedback', async () => {
    const { service, createFeedback } = createServiceMock();
    const controller = new FeedbackController(service);
    const request = createRequest('viewer');
    const guard = new RbacGuard(new Reflector(), createResolver(['space:read']));

    await expect(guard.canActivate(createGuardContext(FeedbackController, 'createFeedback', request))).resolves.toBe(true);
    await controller.createFeedback(TEST_SPACE_ID, { feedback_type: 'incorrect', message_id: 'message-1' }, request);

    expect(createFeedback).toHaveBeenCalledWith(
      { feedback_type: 'incorrect', message_id: 'message-1' },
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
        spaceId: TEST_SPACE_ID,
      }),
    );
  });

  it('rejects feedback submission without space permission', async () => {
    const guard = new RbacGuard(new Reflector(), createResolver([]));

    try {
      await guard.canActivate(createGuardContext(FeedbackController, 'createFeedback', createRequest('viewer')));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(403);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
      return;
    }

    throw new Error('Expected RBAC guard to reject feedback submission');
  });

  it('passes admin list filters to the service', async () => {
    const { service, listFeedback } = createServiceMock();
    const controller = new FeedbackAdminController(service);
    const query = {
      status: 'open',
      feedback_type: 'incorrect',
      space_id: TEST_SPACE_ID,
      user_id: TEST_USER_ID,
      limit: 10,
    };

    await controller.listFeedback(query, createRequest('admin'));

    expect(listFeedback).toHaveBeenCalledWith(
      query,
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
      }),
    );
  });

  it('passes admin resolve requests to the service', async () => {
    const { service, resolveFeedback } = createServiceMock();
    const controller = new FeedbackAdminController(service);

    await controller.resolveFeedback('feedback-1', { resolution: 'accepted', notes: 'Fixed' }, createRequest('admin'));

    expect(resolveFeedback).toHaveBeenCalledWith(
      'feedback-1',
      { resolution: 'accepted', notes: 'Fixed' },
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
      }),
    );
  });
});

function createServiceMock(): {
  service: FeedbackService;
  createFeedback: ReturnType<typeof vi.fn<FeedbackService['createFeedback']>>;
  listFeedback: ReturnType<typeof vi.fn<FeedbackService['listFeedback']>>;
  resolveFeedback: ReturnType<typeof vi.fn<FeedbackService['resolveFeedback']>>;
} {
  const createFeedback = vi.fn<FeedbackService['createFeedback']>(() => Promise.resolve(createFeedbackRow()));
  const listFeedback = vi.fn<FeedbackService['listFeedback']>(() =>
    Promise.resolve({ items: [createFeedbackRow()], next_cursor: null, has_next: false, limit: 20 }),
  );
  const resolveFeedback = vi.fn<FeedbackService['resolveFeedback']>(() =>
    Promise.resolve(createFeedbackRow({ status: 'resolved' })),
  );

  return {
    createFeedback,
    listFeedback,
    resolveFeedback,
    service: {
      createFeedback,
      listFeedback,
      resolveFeedback,
    } as unknown as FeedbackService,
  };
}

function createResolver(permissions: string[]): SpacePermissionResolver {
  return {
    getPermissionsForUser: vi.fn(() => Promise.resolve(permissions)),
  };
}

function createRequest(role: string): {
  user: AuthenticatedRequestUser;
  params: { spaceId: string };
  ip: string;
  headers: Record<string, string>;
} {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: `${role}@example.com`,
      role,
      group_ids: ['group-1'],
      token_use: 'access',
    },
    params: { spaceId: TEST_SPACE_ID },
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'vitest',
      'x-request-id': 'req-1',
    },
  };
}

function createFeedbackRow(overrides: Partial<typeof feedbackItems.$inferSelect> = {}): typeof feedbackItems.$inferSelect {
  return {
    id: 'feedback-1',
    tenant_id: TEST_TENANT_ID,
    user_id: TEST_USER_ID,
    message_id: 'message-1',
    space_id: TEST_SPACE_ID,
    feedback_type: 'incorrect',
    status: 'open',
    payload_json: {},
    created_at: new Date('2026-05-01T10:00:00.000Z'),
    resolved_by: null,
    resolution_note: null,
    resolved_at: null,
    ...overrides,
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
