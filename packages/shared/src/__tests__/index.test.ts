import { describe, expect, it } from 'vitest';
import { ErrorCode, envSchema } from '@cherrygraph/shared';
import type { RequestContext } from '@cherrygraph/shared';

describe('@cherrygraph/shared exports', () => {
  it('re-exports ErrorCode, envSchema, and RequestContext', () => {
    const context: RequestContext = {
      request_id: 'req_001',
      tenant_id: 'tenant_001',
      user_id: null,
      space_id: null,
    };

    expect(ErrorCode.UNAUTHENTICATED).toBe('UNAUTHENTICATED');
    expect(typeof envSchema.parse).toBe('function');
    expect(context.request_id).toBe('req_001');
  });
});
