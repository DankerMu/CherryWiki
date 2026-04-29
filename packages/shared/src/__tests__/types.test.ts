import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../types.js';

describe('RequestContext', () => {
  it('accepts all required request context fields', () => {
    const context: RequestContext = {
      request_id: 'req_001',
      tenant_id: 'tenant_001',
      user_id: 'user_001',
      space_id: 'space_001',
    };

    const requestId: string = context.request_id;
    const tenantId: string = context.tenant_id;
    const userId: string | null = context.user_id;
    const spaceId: string | null = context.space_id;

    expect(requestId).toBe('req_001');
    expect(tenantId).toBe('tenant_001');
    expect(userId).toBe('user_001');
    expect(spaceId).toBe('space_001');
  });

  it('accepts null user_id and space_id values', () => {
    const context: RequestContext = {
      request_id: 'req_002',
      tenant_id: 'tenant_001',
      user_id: null,
      space_id: null,
    };

    expect(context.user_id).toBeNull();
    expect(context.space_id).toBeNull();
  });
});
