import { describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../audit/audit.service.js';
import type { McpRateLimitParams } from '../mcp-rate-limit.js';
import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createMcpServiceContext,
  createRedisMock,
} from './mcp-test-utils.js';

describe('McpRateLimiter', () => {
  it('allows requests within the sliding window limit', async () => {
    const redis = createRedisMock({
      zcard: vi.fn(() => Promise.resolve(5)),
    });
    const { rateLimiter } = createMcpServiceContext({ redis });

    const result = await rateLimiter.check(createParams({ limitRpm: 5 }));

    expect(result).toEqual({ limited: false });
    expect(redis.zadd).toHaveBeenCalledWith(
      'mcp:rate:api-token-1:tool-1',
      expect.any(Number),
      expect.any(String),
    );
    expect(redis.zremrangebyscore).toHaveBeenCalledWith(
      'mcp:rate:api-token-1:tool-1',
      0,
      expect.any(Number),
    );
    expect(redis.zcard).toHaveBeenCalledWith('mcp:rate:api-token-1:tool-1');
    expect(redis.expire).toHaveBeenCalledWith('mcp:rate:api-token-1:tool-1', 60);
  });

  it('returns limited with retryAfter when the window is exceeded', async () => {
    const redis = createRedisMock({
      zcard: vi.fn(() => Promise.resolve(6)),
    });
    const { rateLimiter } = createMcpServiceContext({ redis });

    await expect(rateLimiter.check(createParams({ limitRpm: 5 }))).resolves.toEqual({
      limited: true,
      retryAfter: 60,
    });
  });

  it('skips rate limiting when rate_limit_rpm is missing or zero', async () => {
    const redis = createRedisMock();
    const { rateLimiter } = createMcpServiceContext({ redis });

    await expect(rateLimiter.check(createParams({ limitRpm: undefined }))).resolves.toEqual({ limited: false });
    await expect(rateLimiter.check(createParams({ limitRpm: 0 }))).resolves.toEqual({ limited: false });
    expect(redis.zadd).not.toHaveBeenCalled();
  });

  it('fails open and audits when Redis is unavailable', async () => {
    const { rateLimiter, audit } = createMcpServiceContext();

    await expect(rateLimiter.check(createParams({ limitRpm: 5 }))).resolves.toEqual({ limited: false });

    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.rate_limit.redis_unavailable',
        resource_type: 'mcp_tool',
        resource_id: 'tool-1',
        metadata_json: expect.objectContaining({
          tool_name: 'jira-lookup',
          caller_token_id: 'api-token-1',
        }) as Record<string, unknown>,
      }) as AuditEntry,
    );
  });
});

function createParams(overrides: Partial<McpRateLimitParams> = {}): McpRateLimitParams {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    tokenId: 'api-token-1',
    toolId: 'tool-1',
    toolName: 'jira-lookup',
    spaceId: TEST_SPACE_ID,
    limitRpm: 5,
    ...overrides,
  };
}
