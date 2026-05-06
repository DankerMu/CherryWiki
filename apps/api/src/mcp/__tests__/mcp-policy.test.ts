import { describe, expect, it } from 'vitest';

import { checkMcpAuthorization } from '../mcp-policy.js';

describe('checkMcpAuthorization', () => {
  it('requires the mcp:invoke token scope', () => {
    expect(
      checkMcpAuthorization({
        tokenScopes: ['ticket:read'],
        tokenRole: 'admin',
        spaceId: 'space-1',
        policy: {},
      }),
    ).toEqual({ authorized: false, denial_reason: 'missing_mcp_invoke_scope' });
  });

  it('allows access when allowed_scopes intersects token scopes', () => {
    expect(
      checkMcpAuthorization({
        tokenScopes: ['mcp:invoke', 'ticket:read'],
        tokenRole: 'viewer',
        spaceId: 'space-1',
        policy: {
          allowed_scopes: ['ticket:read', 'ticket:write'],
        },
      }),
    ).toEqual({ authorized: true });
  });

  it('denies access when allowed_scopes has no intersection', () => {
    expect(
      checkMcpAuthorization({
        tokenScopes: ['mcp:invoke', 'ticket:read'],
        tokenRole: 'viewer',
        spaceId: 'space-1',
        policy: {
          allowed_scopes: ['ticket:write'],
        },
      }),
    ).toEqual({ authorized: false, denial_reason: 'tool_scope_denied' });
  });

  it('enforces allowed_roles when configured', () => {
    expect(
      checkMcpAuthorization({
        tokenScopes: ['mcp:invoke'],
        tokenRole: 'viewer',
        spaceId: 'space-1',
        policy: {
          allowed_roles: ['admin', 'editor'],
        },
      }),
    ).toEqual({ authorized: false, denial_reason: 'role_denied' });
  });

  it('enforces allowed_spaces when configured', () => {
    expect(
      checkMcpAuthorization({
        tokenScopes: ['mcp:invoke'],
        tokenRole: 'editor',
        spaceId: 'space-2',
        policy: {
          allowed_roles: ['editor'],
          allowed_spaces: ['space-1'],
        },
      }),
    ).toEqual({ authorized: false, denial_reason: 'space_denied' });
  });

  it('treats empty allowed_roles, allowed_spaces, and allowed_scopes as open', () => {
    expect(
      checkMcpAuthorization({
        tokenScopes: ['mcp:invoke'],
        tokenRole: 'viewer',
        spaceId: 'space-any',
        policy: {
          allowed_roles: [],
          allowed_spaces: [],
          allowed_scopes: [],
        },
      }),
    ).toEqual({ authorized: true });
  });
});
