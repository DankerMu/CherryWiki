import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../audit/audit.service.js';
import {
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import {
  TEST_SPACE_ID,
  createApiTokenUser,
  createMcpServiceContext,
  createMcpToolRow,
} from './mcp-test-utils.js';

describe('MCP invocation audit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('writes success audit with duration, caller token, space, and redacted argument summary', async () => {
    const { service, db, audit } = createMcpServiceContext();
    db.queueSelect([createMcpToolRow()]);
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ result: 'ok' }), { headers: { 'content-type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await service.invokeTool(
      {
        tool: 'jira-lookup',
        arguments: { query: 'SSO', password: 'do-not-log' },
        space_id: TEST_SPACE_ID,
      },
      {
        caller: createApiTokenUser(),
      },
    );

    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.tool.invoked',
        resource_type: 'mcp_tool',
        resource_id: 'tool-1',
        metadata_json: expect.objectContaining({
          tool_name: 'jira-lookup',
          caller_token_id: 'api-token-1',
          space_id: TEST_SPACE_ID,
          duration_ms: expect.any(Number) as number,
          argument_summary: expect.stringContaining('[redacted]') as string,
        }) as Record<string, unknown>,
      }) as AuditEntry,
    );
    const metadata = audit.push.mock.calls[0]?.[0].metadata_json;
    expect(String(metadata?.argument_summary)).not.toContain('do-not-log');
  });

  it('writes denied audit with denial reason', async () => {
    const { service, db, audit } = createMcpServiceContext();
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
          arguments: { query: 'SSO' },
          space_id: TEST_SPACE_ID,
        },
        {
          caller: createApiTokenUser(),
        },
      ),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.tool.denied',
        metadata_json: expect.objectContaining({
          denial_reason: 'space_denied',
        }) as Record<string, unknown>,
      }) as AuditEntry,
    );
  });

  it('writes error audit when the MCP server request fails', async () => {
    const { service, db, audit } = createMcpServiceContext();
    db.queueSelect([createMcpToolRow()]);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new Error('connect ECONNREFUSED'))),
    );

    const err = await getRejectedHttpException(
      service.invokeTool(
        {
          tool_name: 'jira-lookup',
          arguments: { query: 'SSO' },
          space_id: TEST_SPACE_ID,
        },
        {
          caller: createApiTokenUser(),
        },
      ),
    );

    expect(err.getStatus()).toBe(502);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.MCP_SERVER_ERROR);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.tool.error',
        metadata_json: expect.objectContaining({
          error_code: ErrorCode.MCP_SERVER_ERROR,
        }) as Record<string, unknown>,
      }) as AuditEntry,
    );
  });
});
