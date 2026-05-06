import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../apps/api/src/audit/audit.service.js';
import {
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import {
  TEST_SPACE_ID,
  createApiTokenUser,
  createMcpServiceContext,
  createMcpToolRow,
  createRedisMock,
  createResponseMock,
} from '../../apps/api/src/mcp/__tests__/mcp-test-utils.js';

describe('MCP rate limit integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('P4-E11 returns 429 on the N+1 request within the sliding window', async () => {
    const redis = createRedisMock({
      zcard: vi
        .fn<() => Promise<number>>()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3),
    });
    const { service, db, audit } = createMcpServiceContext({ redis });
    const tool = createMcpToolRow({
      policy_json: {
        rate_limit_rpm: 2,
      },
    });
    db.queueSelect([tool]);
    db.queueSelect([tool]);
    db.queueSelect([tool]);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })),
      ),
    );

    await service.invokeTool(
      {
        tool_name: 'jira-lookup',
        arguments: {},
        space_id: TEST_SPACE_ID,
      },
      {
        caller: createApiTokenUser(),
      },
    );
    await service.invokeTool(
      {
        tool_name: 'jira-lookup',
        arguments: {},
        space_id: TEST_SPACE_ID,
      },
      {
        caller: createApiTokenUser(),
      },
    );

    const response = createResponseMock();
    const err = await getRejectedHttpException(
      service.invokeTool(
        {
          tool_name: 'jira-lookup',
          arguments: {},
          space_id: TEST_SPACE_ID,
        },
        {
          caller: createApiTokenUser(),
          response,
        },
      ),
    );

    expect(err.getStatus()).toBe(429);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.RATE_LIMITED);
    expect(response.header).toHaveBeenCalledWith('Retry-After', '60');
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.rate_limit.exceeded',
        resource_id: 'tool-1',
      }) as AuditEntry,
    );
  });
});
