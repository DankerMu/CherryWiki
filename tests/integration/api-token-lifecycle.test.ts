import { ErrorCode, apiTokens } from '@cherrygraph/shared';
import { type ExecutionContext } from '@nestjs/common';
import { RbacGuard } from '@cherrygraph/auth-core';
import { readFileSync } from 'node:fs';
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
import { ApiTokenGuard } from '../../apps/api/src/api-tokens/api-token.guard.js';
import { ApiTokenService, hashRawToken } from '../../apps/api/src/api-tokens/api-token.service.js';

const permissionsByHandler = new WeakMap<object, string[]>();

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

  it('enforces REST route scopes after cwt API token authentication', async () => {
    const rawToken = `cwt_${'b'.repeat(64)}`;
    const db = new ScriptedDb();
    const audit = createAuditMock();
    const service = new ApiTokenService(db.asDrizzle(), audit.service);
    const reflector = createReflector();
    const apiTokenGuard = new ApiTokenGuard(service, reflector);
    const rbacGuard = new RbacGuard(reflector);
    const handler = withPermissions(['admin:user_manage']);

    const deniedRequest = createBearerRequest(rawToken);
    db.queueSelect([
      createApiTokenRow({
        token_hash: hashRawToken(rawToken),
        scopes: ['mcp:invoke'],
      }),
    ]);
    db.queueSelect([createUserRow({ id: TEST_USER_ID, role: 'owner' })]);

    await expect(apiTokenGuard.canActivate(createContext(handler, deniedRequest))).resolves.toBe(true);
    const denied = await getRejectedHttpException(rbacGuard.canActivate(createContext(handler, deniedRequest)));
    expect(denied.getStatus()).toBe(403);
    expect(getHttpExceptionCode(denied)).toBe(ErrorCode.PERMISSION_DENIED);

    const allowedRequest = createBearerRequest(rawToken);
    db.queueSelect([
      createApiTokenRow({
        token_hash: hashRawToken(rawToken),
        scopes: ['admin:user_manage'],
      }),
    ]);
    db.queueSelect([createUserRow({ id: TEST_USER_ID, role: 'owner' })]);

    await expect(apiTokenGuard.canActivate(createContext(handler, allowedRequest))).resolves.toBe(true);
    await expect(rbacGuard.canActivate(createContext(handler, allowedRequest))).resolves.toBe(true);
  });

  it('keeps the OpenAPI token list endpoint aligned with the controller contract', () => {
    const openapi = readFileSync(new URL('../../docs/schemas/openapi.yaml', import.meta.url), 'utf8');
    const listEndpoint = sliceBetween(openapi, '  /admin/api-tokens:', '  /admin/api-tokens/{token_id}:');
    const apiTokenSchema = sliceBetween(openapi, '    ApiToken:', '    ApiTokenCreated:');
    const createTokenSchema = sliceBetween(openapi, '    CreateApiTokenRequest:', '    # --- Phase 4: MCP ---');

    expect(listEndpoint).toContain("enum: ['true', 'false']");
    expect(listEndpoint).not.toContain("name: user_id");
    expect(listEndpoint).not.toContain('#/components/parameters/pageParam');
    expect(listEndpoint).not.toContain('#/components/parameters/perPageParam');
    expect(apiTokenSchema).toContain('last_used_at');
    expect(apiTokenSchema).not.toContain('user_id');
    expect(apiTokenSchema).not.toContain('revoked_at');
    expect(createTokenSchema).toContain('admin:user_manage');
    expect(createTokenSchema).toContain('upload:create');
    expect(createTokenSchema).toContain('graphify:run');
    expect(createTokenSchema).toContain('mcp:invoke');
    expect(createTokenSchema).toContain('MCP-only');
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
    expires_at: new Date('2099-06-01T00:00:00.000Z'),
    revoked_at: null,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function withPermissions(permissions: string[]): () => undefined {
  const handler = () => undefined;
  permissionsByHandler.set(handler, permissions);
  return handler;
}

function createBearerRequest(rawToken: string): {
  headers: Record<string, string>;
  user?: unknown;
} {
  return {
    headers: {
      authorization: `Bearer ${rawToken}`,
    },
  };
}

function createContext(handler: () => undefined, request: unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function createReflector(): ConstructorParameters<typeof RbacGuard>[0] {
  return {
    getAllAndOverride<T>(_metadataKey: string | symbol, targets: Array<object | undefined>): T | undefined {
      void _metadataKey;

      for (const target of targets) {
        if (target === undefined) {
          continue;
        }

        const value = permissionsByHandler.get(target) as T | undefined;
        if (value !== undefined) {
          return value;
        }
      }

      return undefined;
    },
  } as ConstructorParameters<typeof RbacGuard>[0];
}

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`OpenAPI marker not found: ${start}`);
  }

  return source.slice(startIndex, endIndex);
}
