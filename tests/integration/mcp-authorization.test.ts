import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import {
  TEST_SPACE_ID,
  createApiTokenUser,
  createMcpServiceContext,
  createMcpToolRow,
} from '../../apps/api/src/mcp/__tests__/mcp-test-utils.js';

describe('MCP authorization integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('P4-E9 allows authorized space and intersecting scope', async () => {
    const { service, db } = createMcpServiceContext();
    db.queueSelect([
      createMcpToolRow({
        policy_json: {
          allowed_roles: ['editor'],
          allowed_spaces: [TEST_SPACE_ID],
          allowed_scopes: ['ticket:read'],
          rate_limit_rpm: 0,
        },
      }),
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })),
      ),
    );

    await expect(
      service.invokeTool(
        {
          tool_name: 'jira-lookup',
          arguments: { key: 'CW-154' },
          space_id: TEST_SPACE_ID,
        },
        {
          caller: createApiTokenUser({ role: 'editor', scopes: ['mcp:invoke', 'ticket:read'] }),
        },
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('P4-E9 denies unauthorized space', async () => {
    const { service, db } = createMcpServiceContext();
    db.queueSelect([
      createMcpToolRow({
        policy_json: {
          allowed_spaces: ['space-other'],
        },
      }),
    ]);

    const err = await getRejectedHttpException(
      service.invokeTool(
        {
          tool_name: 'jira-lookup',
          arguments: {},
          space_id: TEST_SPACE_ID,
        },
        {
          caller: createApiTokenUser(),
        },
      ),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
  });

  it('P4-E9 denies empty scope intersection', async () => {
    const { service, db } = createMcpServiceContext();
    db.queueSelect([
      createMcpToolRow({
        policy_json: {
          allowed_scopes: ['ticket:write'],
        },
      }),
    ]);

    const err = await getRejectedHttpException(
      service.invokeTool(
        {
          tool_name: 'jira-lookup',
          arguments: {},
          space_id: TEST_SPACE_ID,
        },
        {
          caller: createApiTokenUser({ scopes: ['mcp:invoke', 'ticket:read'] }),
        },
      ),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
  });
});
