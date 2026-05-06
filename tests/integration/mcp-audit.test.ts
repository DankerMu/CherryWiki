import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../apps/api/src/audit/audit.service.js';
import {
  TEST_SPACE_ID,
  createApiTokenUser,
  createMcpServiceContext,
  createMcpToolRow,
} from '../../apps/api/src/mcp/__tests__/mcp-test-utils.js';

describe('MCP audit integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('P4-E10 records complete invocation audit metadata', async () => {
    const { service, db, audit } = createMcpServiceContext();
    db.queueSelect([createMcpToolRow()]);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })),
      ),
    );

    await service.invokeTool(
      {
        tool_name: 'jira-lookup',
        arguments: { key: 'CW-154' },
        space_id: TEST_SPACE_ID,
      },
      {
        caller: createApiTokenUser(),
      },
    );

    const entry = audit.push.mock.calls.find((call) => call[0].action === 'mcp.tool.invoked')?.[0] as
      | AuditEntry
      | undefined;

    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      action: 'mcp.tool.invoked',
      resource_type: 'mcp_tool',
      resource_id: 'tool-1',
      space_id: TEST_SPACE_ID,
      metadata_json: expect.objectContaining({
        tool_name: 'jira-lookup',
        caller_token_id: 'api-token-1',
        space_id: TEST_SPACE_ID,
        duration_ms: expect.any(Number) as number,
        argument_summary: '{"key":"CW-154"}',
      }) as Record<string, unknown>,
    });
  });
});
