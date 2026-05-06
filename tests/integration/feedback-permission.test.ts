import {
  RbacGuard,
  type AuthenticatedRequestUser,
  type SpacePermissionResolver,
} from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  getHttpExceptionCode,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import { FeedbackService } from '../../apps/api/src/feedback/feedback.service.js';

describe('feedback permission integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P4-E6 allows a viewer with space permission to submit feedback', async () => {
    const db = new ScriptedDb();
    const service = new FeedbackService(db.asDrizzle(), createAuditMock().service);
    const request = createRequest(['space:read']);
    const guard = createFeedbackGuard(['space:read']);

    await expect(guard.canActivate(createGuardContext(request))).resolves.toBe(true);
    const result = await service.createFeedback(
      {
        feedback_type: 'incorrect',
        message_id: 'message-1',
        payload_json: { description: 'Wrong answer' },
      },
      {
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
        spaceId: TEST_SPACE_ID,
      },
    );

    expect(result).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      status: 'open',
      message_id: 'message-1',
    });
  });

  it('P4-E6 returns 403 when the user has no space permission', async () => {
    const guard = createFeedbackGuard([]);

    try {
      await guard.canActivate(createGuardContext(createRequest([])));
    } catch (err) {
      expect(getExceptionStatus(err)).toBe(403);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
      return;
    }

    throw new Error('Expected feedback submission to be denied');
  });
});

function createResolver(permissions: string[]): SpacePermissionResolver {
  return {
    getPermissionsForUser: vi.fn(() => Promise.resolve(permissions)),
  };
}

function createFeedbackGuard(permissions: string[]): RbacGuard {
  const reflector = {
    getAllAndOverride: vi.fn(() => ['space:read']),
  };
  return new RbacGuard(reflector, createResolver(permissions));
}

function createRequest(permissions: string[]): {
  user: AuthenticatedRequestUser;
  params: { spaceId: string };
  ip: string;
  headers: Record<string, string>;
  permissions: string[];
} {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: 'viewer@example.com',
      role: 'viewer',
      group_ids: ['group-1'],
      token_use: 'access',
      permissions,
    },
    params: { spaceId: TEST_SPACE_ID },
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'vitest',
      'x-request-id': 'req-1',
    },
    permissions,
  };
}

function createGuardContext(request: unknown): Parameters<RbacGuard['canActivate']>[0] {
  return {
    getHandler: () => createGuardContext,
    getClass: () => class FeedbackTestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as Parameters<RbacGuard['canActivate']>[0];
}

function getExceptionStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('getStatus' in err)) {
    return undefined;
  }

  const exception = err as { getStatus?: () => number };
  return typeof exception.getStatus === 'function' ? exception.getStatus() : undefined;
}
