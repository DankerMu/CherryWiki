import { mcpToolRegistry } from '@cherrygraph/shared';
import { vi } from 'vitest';

import type { ApiTokenAuthenticatedUser } from '../../api-tokens/api-token.service.js';
import {
  ScriptedDb,
  TEST_ACTOR_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { McpRateLimiter, type McpRateLimitRedisClient } from '../mcp-rate-limit.js';
import { McpService, type McpResponseLike } from '../mcp.service.js';

export {
  TEST_ACTOR_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
};

export function createMcpServiceContext(options: {
  redis?: McpRateLimitRedisClient;
} = {}): {
  service: McpService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
  rateLimiter: McpRateLimiter;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const rateLimiter = new McpRateLimiter(audit.service, options.redis);
  const service = new McpService(db.asDrizzle(), audit.service, rateLimiter);
  return { service, db, audit, rateLimiter };
}

export function createMcpContext(): {
  tenantId: string;
  actorUserId: string;
} {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
  };
}

export function createMcpToolRow(
  overrides: Partial<typeof mcpToolRegistry.$inferSelect> = {},
): typeof mcpToolRegistry.$inferSelect {
  return {
    id: 'tool-1',
    tenant_id: TEST_TENANT_ID,
    tool_name: 'jira-lookup',
    description: 'Jira lookup tool',
    server_url: 'https://mcp.example.com/invoke',
    transport: 'http',
    input_schema: {},
    scopes: [],
    status: 'active',
    policy_json: {},
    created_by: TEST_ACTOR_ID,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function createApiTokenUser(overrides: Partial<ApiTokenAuthenticatedUser> = {}): ApiTokenAuthenticatedUser {
  return {
    sub: TEST_USER_ID,
    tenant_id: TEST_TENANT_ID,
    email: 'user@example.com',
    role: 'viewer',
    group_ids: [],
    token_use: 'access',
    scopes: ['mcp:invoke'],
    token_id: 'api-token-1',
    ...overrides,
  };
}

export function createRedisMock(overrides: Partial<McpRateLimitRedisClient> = {}): McpRateLimitRedisClient {
  return {
    zadd: vi.fn(() => Promise.resolve(1)),
    zremrangebyscore: vi.fn(() => Promise.resolve(0)),
    zcard: vi.fn(() => Promise.resolve(1)),
    expire: vi.fn(() => Promise.resolve(1)),
    ...overrides,
  };
}

export function createResponseMock(): McpResponseLike & {
  header: ReturnType<typeof vi.fn<(name: string, value: string) => void>>;
} {
  return {
    header: vi.fn(),
  };
}
