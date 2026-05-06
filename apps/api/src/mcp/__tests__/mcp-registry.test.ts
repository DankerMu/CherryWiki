import { ErrorCode, mcpToolRegistry } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../audit/audit.service.js';
import {
  createUniqueViolation,
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import {
  TEST_ACTOR_ID,
  TEST_TENANT_ID,
  createMcpContext,
  createMcpServiceContext,
  createMcpToolRow,
} from './mcp-test-utils.js';

describe('McpService registry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a tool, stores it as active, and writes audit', async () => {
    const { service, db, audit } = createMcpServiceContext();
    db.queueSelect([]);

    const result = await service.createTool(
      {
        name: 'jira-lookup',
        description: 'Jira lookup tool',
        server_url: 'https://mcp.example.com/invoke',
        transport: 'http',
        scopes: ['ticket:read'],
      },
      createMcpContext(),
    );

    expect(db.inserts[0]?.table).toBe(mcpToolRegistry);
    expect(db.inserts[0]?.value).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      created_by: TEST_ACTOR_ID,
      tool_name: 'jira-lookup',
      status: 'active',
      policy_json: {},
      scopes: ['ticket:read'],
    });
    expect(result).toMatchObject({
      tool_name: 'jira-lookup',
      status: 'active',
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.tool.registered',
        resource_type: 'mcp_tool',
        resource_id: result.id,
        metadata_json: expect.objectContaining({
          tool_name: 'jira-lookup',
          transport: 'http',
        }) as Record<string, unknown>,
      }) as AuditEntry,
    );
  });

  it('rejects duplicate tool names within a tenant', async () => {
    const { service, db } = createMcpServiceContext();
    db.queueSelect([createMcpToolRow()]);

    const err = await getRejectedHttpException(
      service.createTool(
        {
          tool_name: 'jira-lookup',
          server_url: 'https://mcp.example.com/invoke',
        },
        createMcpContext(),
      ),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.TOOL_NAME_EXISTS);
  });

  it('maps database unique violations to TOOL_NAME_EXISTS', async () => {
    const { service, db } = createMcpServiceContext();
    db.queueSelect([]);
    db.queueInsertError(createUniqueViolation('mcp_tool_registry_tenant_id_tool_name_unique'));

    const err = await getRejectedHttpException(
      service.createTool(
        {
          tool_name: 'jira-lookup',
          server_url: 'https://mcp.example.com/invoke',
        },
        createMcpContext(),
      ),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.TOOL_NAME_EXISTS);
  });

  it('lists active tools by default and can include inactive tools', async () => {
    const { service, db } = createMcpServiceContext();
    db.queueSelect([createMcpToolRow()]);
    db.queueSelect([createMcpToolRow(), createMcpToolRow({ id: 'tool-2', status: 'inactive' })]);

    const active = await service.listTools({}, createMcpContext());
    const all = await service.listTools({ include_inactive: 'true' }, createMcpContext());

    expect(active).toHaveLength(1);
    expect(all).toHaveLength(2);
  });

  it('soft deletes a tool and writes audit', async () => {
    const { service, db, audit } = createMcpServiceContext();
    db.queueSelect([createMcpToolRow()]);
    db.queueUpdate([createMcpToolRow({ status: 'inactive' })]);

    const result = await service.deleteTool('tool-1', createMcpContext());

    expect(db.updates[0]?.table).toBe(mcpToolRegistry);
    expect(db.updates[0]?.value).toMatchObject({ status: 'inactive' });
    expect(result.status).toBe('inactive');
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.tool.deleted',
        resource_type: 'mcp_tool',
        resource_id: 'tool-1',
      }) as AuditEntry,
    );
  });

  it('updates the full policy model', async () => {
    const { service, db } = createMcpServiceContext();
    db.queueSelect([createMcpToolRow()]);
    db.queueUpdate([
      createMcpToolRow({
        policy_json: {
          allowed_roles: ['admin', 'editor'],
          allowed_spaces: ['space-1'],
          allowed_scopes: ['ticket:read'],
          rate_limit_rpm: 60,
        },
      }),
    ]);

    const result = await service.updatePolicy(
      'tool-1',
      {
        allowed_roles: ['admin', 'editor'],
        allowed_spaces: ['space-1'],
        allowed_scopes: ['ticket:read'],
        rate_limit_rpm: 60,
      },
      createMcpContext(),
    );

    expect(db.updates[0]?.value).toMatchObject({
      policy_json: {
        allowed_roles: ['admin', 'editor'],
        allowed_spaces: ['space-1'],
        allowed_scopes: ['ticket:read'],
        rate_limit_rpm: 60,
      },
    });
    expect(result.policy_json).toMatchObject({ rate_limit_rpm: 60 });
  });
});
