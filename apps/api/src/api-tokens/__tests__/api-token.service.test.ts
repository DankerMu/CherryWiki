import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, apiTokens } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../audit/audit.service.js';
import {
  ScriptedDb,
  TEST_ACTOR_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  createUserRow,
  getHttpExceptionCode,
  getHttpExceptionResponse,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { ApiTokenGuard } from '../api-token.guard.js';
import { ApiTokenService, hashRawToken, type ApiTokenAuthenticatedUser } from '../api-token.service.js';

describe('ApiTokenService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates a token, stores only a SHA-256 hash, and returns the raw token once', async () => {
    const { service, db, audit } = createServiceContext();

    const result = await service.createToken(
      {
        name: '  test-mcp-token  ',
        scopes: ['mcp:invoke', ' graph:read '],
        expires_in_days: 30,
      },
      createContext(),
    );

    expect(result.raw_token).toMatch(/^cwt_[a-f0-9]{64}$/);
    expect(result.token_prefix).toBe(result.raw_token.slice(0, 8));
    expect(result).not.toHaveProperty('token_hash');

    const insert = db.inserts[0]?.value as typeof apiTokens.$inferInsert | undefined;
    expect(insert).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_ACTOR_ID,
      name: 'test-mcp-token',
      token_prefix: result.raw_token.slice(0, 8),
      scopes: ['mcp:invoke', 'graph:read'],
    });
    expect(insert?.token_hash).toBe(hashRawToken(result.raw_token));
    expect(insert).not.toHaveProperty('raw_token');
    expect(insert?.expires_at).toBeInstanceOf(Date);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_token.created',
        resource_type: 'api_token',
        resource_id: result.id,
        metadata_json: expect.objectContaining({
          token_prefix: result.token_prefix,
          scopes: ['mcp:invoke', 'graph:read'],
        }) as Record<string, unknown>,
      }) as AuditEntry,
    );
  });

  it('creates a token without expiration when expires_in_days is omitted', async () => {
    const { service, db } = createServiceContext();

    const result = await service.createToken({ name: 'Automation token', scopes: ['mcp:invoke'] }, createContext());

    expect(result.expires_at).toBeNull();
    expect((db.inserts[0]?.value as Partial<typeof apiTokens.$inferInsert> | undefined)?.expires_at).toBeNull();
  });

  it('returns validation details when token creation input fails shared schema validation', async () => {
    const { service } = createServiceContext();

    const err = await getRejectedHttpException(service.createToken({ name: '   ', scopes: [] }, createContext()));
    const response = getHttpExceptionResponse(err);

    expect(err.getStatus()).toBe(422);
    expect(response).toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
    });
    expect(response?.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name' }),
        expect.objectContaining({ path: 'scopes' }),
      ]),
    );
  });

  it('lists tokens without token_hash or raw token fields', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([
      {
        ...createApiTokenRow(),
        token_hash: 'should-not-leak',
      },
    ]);

    const result = await service.listTokens({}, createContext());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'api-token-1',
      name: 'MCP token',
      token_prefix: 'cwt_ab12',
      scopes: ['mcp:invoke'],
    });
    expect(result[0]).not.toHaveProperty('token_hash');
    expect(result[0]).not.toHaveProperty('raw_token');
  });

  it('supports include_revoked=true when listing tokens', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createApiTokenRow({ revoked_at: new Date('2026-05-02T00:00:00.000Z') })]);

    const result = await service.listTokens({ include_revoked: 'true' }, createContext());

    expect(result).toHaveLength(1);
  });

  it('revokes an active token and writes an audit log', async () => {
    const { service, db, audit } = createServiceContext();
    const revokedAt = new Date('2026-05-02T00:00:00.000Z');
    db.queueSelect([createApiTokenRow()]);
    db.queueUpdate([createApiTokenRow({ revoked_at: revokedAt })]);

    const result = await service.revokeToken('api-token-1', createContext());

    expect(result).toEqual({ id: 'api-token-1', revoked_at: revokedAt });
    expect(db.updates[0]?.value).toMatchObject({ revoked_at: expect.any(Date) as Date });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_token.revoked',
        resource_type: 'api_token',
        resource_id: 'api-token-1',
      }) as AuditEntry,
    );
  });

  it('treats revoke as idempotent when the token is already revoked', async () => {
    const { service, db, audit } = createServiceContext();
    const revokedAt = new Date('2026-05-02T00:00:00.000Z');
    db.queueSelect([createApiTokenRow({ revoked_at: revokedAt })]);

    const result = await service.revokeToken('api-token-1', createContext());

    expect(result).toEqual({ id: 'api-token-1', revoked_at: revokedAt });
    expect(db.updates).toHaveLength(0);
    expect(audit.push).not.toHaveBeenCalled();
  });

  it('returns 404 when revoking a missing token', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.revokeToken('missing', createContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.NOT_FOUND);
  });

  it('authenticates a valid raw token, updates last_used_at, and derives caller role through user_id', async () => {
    const { service, db } = createServiceContext();
    const rawToken = createRawToken();
    db.queueSelect([createApiTokenRow({ user_id: TEST_USER_ID, token_hash: hashRawToken(rawToken) })]);
    db.queueSelect([createUserRow({ id: TEST_USER_ID, role: 'space_admin', email: 'space-admin@example.com' })]);

    const result = await service.authenticateRawToken(rawToken);

    expect(result).toMatchObject({
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: 'space-admin@example.com',
      role: 'space_admin',
      group_ids: [],
      scopes: ['mcp:invoke'],
      token_id: 'api-token-1',
    });
    expect(db.updates[0]?.value).toMatchObject({ last_used_at: expect.any(Date) as Date });
  });

  it('rejects expired, revoked, and invalid API tokens with specific error codes', async () => {
    const { service, db } = createServiceContext();
    const rawToken = createRawToken();
    db.queueSelect([
      createApiTokenRow({
        token_hash: hashRawToken(rawToken),
        expires_at: new Date('2020-01-01T00:00:00.000Z'),
      }),
    ]);
    db.queueSelect([
      createApiTokenRow({
        token_hash: hashRawToken(rawToken),
        revoked_at: new Date('2026-05-02T00:00:00.000Z'),
      }),
    ]);
    db.queueSelect([]);

    const expired = await getRejectedHttpException(service.authenticateRawToken(rawToken));
    const revoked = await getRejectedHttpException(service.authenticateRawToken(rawToken));
    const invalid = await getRejectedHttpException(service.authenticateRawToken(rawToken));

    expect(expired.getStatus()).toBe(401);
    expect(getHttpExceptionCode(expired)).toBe(ErrorCode.TOKEN_EXPIRED);
    expect(revoked.getStatus()).toBe(401);
    expect(getHttpExceptionCode(revoked)).toBe(ErrorCode.TOKEN_REVOKED);
    expect(invalid.getStatus()).toBe(401);
    expect(getHttpExceptionCode(invalid)).toBe(ErrorCode.INVALID_TOKEN);
  });
});

describe('ApiTokenGuard', () => {
  it('authenticates cwt_ bearer tokens and attaches the API token caller', async () => {
    const authenticateRawToken = vi.fn<ApiTokenService['authenticateRawToken']>(() =>
      Promise.resolve(createAuthenticatedUser({ token_id: 'api-token-1' })),
    );
    const service = {
      authenticateRawToken,
    } as unknown as ApiTokenService;
    const request = {
      headers: {
        authorization: `Bearer ${createRawToken()}`,
      },
    };
    const guard = new ApiTokenGuard(service, new Reflector());

    await expect(guard.canActivate(createGuardContext(request))).resolves.toBe(true);

    expect(authenticateRawToken).toHaveBeenCalledWith(request.headers.authorization.slice('Bearer '.length));
    expect(request).toMatchObject({
      user: {
        sub: TEST_USER_ID,
        token_id: 'api-token-1',
        scopes: ['mcp:invoke'],
      },
    });
  });

  it('lets JWT bearer tokens continue to the JWT guard', async () => {
    const authenticateRawToken = vi.fn<ApiTokenService['authenticateRawToken']>();
    const guard = new ApiTokenGuard({ authenticateRawToken } as unknown as ApiTokenService, new Reflector());

    await expect(
      guard.canActivate(createGuardContext({ headers: { authorization: 'Bearer jwt-token' } })),
    ).resolves.toBe(true);

    expect(authenticateRawToken).not.toHaveBeenCalled();
  });
});

function createServiceContext(): {
  service: ApiTokenService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const service = new ApiTokenService(db.asDrizzle(), audit.service);
  return { service, db, audit };
}

function createContext(): {
  tenantId: string;
  actorUserId: string;
} {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
  };
}

function createApiTokenRow(overrides: Partial<typeof apiTokens.$inferSelect> = {}): typeof apiTokens.$inferSelect {
  return {
    id: 'api-token-1',
    tenant_id: TEST_TENANT_ID,
    user_id: TEST_USER_ID,
    name: 'MCP token',
    token_hash: hashRawToken(createRawToken()),
    token_prefix: 'cwt_ab12',
    scopes: ['mcp:invoke'],
    last_used_at: null,
    expires_at: new Date('2026-06-01T00:00:00.000Z'),
    revoked_at: null,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createRawToken(fill = 'a'): string {
  return `cwt_${fill.repeat(64)}`;
}

function createAuthenticatedUser(overrides: Partial<ApiTokenAuthenticatedUser> = {}): ApiTokenAuthenticatedUser {
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

function createGuardContext(request: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}
