import { ErrorCode, apiTokens } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import {
  ScriptedDb,
  TEST_ACTOR_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  createUserRow,
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import { ApiTokenService, hashRawToken } from '../../apps/api/src/api-tokens/api-token.service.js';

describe('API token lifecycle integration', () => {
  it('P4-E8 creates, uses, expires, revokes, and rejects an API token', async () => {
    const db = new ScriptedDb();
    const audit = createAuditMock();
    const service = new ApiTokenService(db.asDrizzle(), audit.service);

    const created = await service.createToken(
      {
        name: 'test-mcp-token',
        scopes: ['mcp:invoke', 'graph:read'],
        expires_in_days: 30,
      },
      {
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_ACTOR_ID,
      },
    );
    const inserted = db.inserts[0]?.value as typeof apiTokens.$inferInsert;
    const activeToken = createApiTokenRow({
      ...inserted,
      id: created.id,
      token_hash: hashRawToken(created.raw_token),
      token_prefix: created.token_prefix,
      user_id: TEST_USER_ID,
    });

    db.queueSelect([activeToken]);
    db.queueSelect([createUserRow({ id: TEST_USER_ID, role: 'admin' })]);
    const authenticated = await service.authenticateRawToken(created.raw_token);

    expect(authenticated).toMatchObject({
      sub: TEST_USER_ID,
      role: 'admin',
      scopes: ['mcp:invoke', 'graph:read'],
      token_id: created.id,
    });

    const expiredToken = createApiTokenRow({
      ...activeToken,
      expires_at: new Date('2020-01-01T00:00:00.000Z'),
    });
    db.queueSelect([expiredToken]);
    const expired = await getRejectedHttpException(service.authenticateRawToken(created.raw_token));
    expect(expired.getStatus()).toBe(401);
    expect(getHttpExceptionCode(expired)).toBe(ErrorCode.TOKEN_EXPIRED);

    const revokedAt = new Date('2026-05-02T00:00:00.000Z');
    db.queueSelect([expiredToken]);
    db.queueUpdate([createApiTokenRow({ ...expiredToken, revoked_at: revokedAt })]);
    await expect(
      service.revokeToken(created.id, { tenantId: TEST_TENANT_ID, actorUserId: TEST_ACTOR_ID }),
    ).resolves.toEqual({ id: created.id, revoked_at: revokedAt });

    db.queueSelect([createApiTokenRow({ ...expiredToken, revoked_at: revokedAt })]);
    const revoked = await getRejectedHttpException(service.authenticateRawToken(created.raw_token));
    expect(revoked.getStatus()).toBe(401);
    expect(getHttpExceptionCode(revoked)).toBe(ErrorCode.TOKEN_REVOKED);
  });
});

function createApiTokenRow(overrides: Partial<typeof apiTokens.$inferSelect> = {}): typeof apiTokens.$inferSelect {
  return {
    id: 'api-token-1',
    tenant_id: TEST_TENANT_ID,
    user_id: TEST_USER_ID,
    name: 'MCP token',
    token_hash: hashRawToken(`cwt_${'a'.repeat(64)}`),
    token_prefix: 'cwt_ab12',
    scopes: ['mcp:invoke'],
    last_used_at: null,
    expires_at: new Date('2026-06-01T00:00:00.000Z'),
    revoked_at: null,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}
