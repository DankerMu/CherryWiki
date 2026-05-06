import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../apps/api/src/audit/audit.service.js';
import {
  TEST_SPACE_ID,
  createApiTokenUser,
  createMcpContext,
  createMcpServiceContext,
  createMcpToolRow,
} from '../../apps/api/src/mcp/__tests__/mcp-test-utils.js';

describe('MCP registry integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('P4-E4 registers, sets policy, invokes, and audits the full flow', async () => {
    const { service, db, audit } = createMcpServiceContext();
    db.queueSelect([]);

    const created = await service.createTool(
      {
        tool_name: 'jira-lookup',
        server_url: 'https://mcp.example.com/invoke',
        transport: 'http',
        scopes: ['ticket:read'],
      },
      createMcpContext(),
    );

    const policy = {
      allowed_roles: ['viewer'],
      allowed_spaces: [TEST_SPACE_ID],
      allowed_scopes: ['ticket:read'],
      rate_limit_rpm: 0,
    };
    db.queueSelect([created]);
    db.queueUpdate([createMcpToolRow({ ...created, policy_json: policy })]);

    await service.updatePolicy(created.id, policy, createMcpContext());

    db.queueSelect([createMcpToolRow({ ...created, policy_json: policy })]);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(JSON.stringify({ issue: 'CW-154' }), { headers: { 'content-type': 'application/json' } })),
      ),
    );

    const result = await service.invokeTool(
      {
        tool: 'jira-lookup',
        arguments: { key: 'CW-154' },
        space_id: TEST_SPACE_ID,
      },
      {
        caller: createApiTokenUser({ scopes: ['mcp:invoke', 'ticket:read'] }),
      },
    );

    expect(result).toEqual({ issue: 'CW-154' });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.tool.registered',
        resource_id: created.id,
      }) as AuditEntry,
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.tool.invoked',
        resource_id: created.id,
      }) as AuditEntry,
    );
  });
});
