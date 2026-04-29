import { HttpException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { sessions, users } from '@cherrygraph/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { vi } from 'vitest';

import type { AuditEntry, AuditService } from '../../audit/audit.service.js';

export const TEST_JWT_SECRET = 'test-jwt-secret-at-least-32-characters';
export const TEST_TENANT_ID = 'tenant-1';
export const TEST_USER_ID = 'user-1';
export const TEST_EMAIL = 'user@example.com';

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

export type AuditMock = {
  service: AuditService;
  push: ReturnType<typeof vi.fn<(entry: AuditEntry) => void>>;
};

export class FakeDb {
  readonly inserts: unknown[] = [];
  readonly updates: unknown[] = [];
  readonly selectFields: unknown[] = [];
  readonly selectResults: unknown[][] = [];
  readonly insertResults: unknown[][] = [];
  readonly updateResults: unknown[][] = [];

  asDrizzle(): NodePgDatabase {
    return this as unknown as NodePgDatabase;
  }

  queueSelect(result: unknown[]): void {
    this.selectResults.push(result);
  }

  queueInsert(result: unknown[]): void {
    this.insertResults.push(result);
  }

  queueUpdate(result: unknown[]): void {
    this.updateResults.push(result);
  }

  select(fields?: unknown): FakeQueryBuilder {
    this.selectFields.push(fields);
    return new FakeQueryBuilder(this.selectResults.shift() ?? []);
  }

  insert(): { values: (value: unknown) => FakeInsertReturningBuilder } {
    return {
      values: (value: unknown) => {
        this.inserts.push(value);
        return new FakeInsertReturningBuilder(this.insertResults.shift() ?? normalizeInsertedRows(value));
      },
    };
  }

  update(): { set: (value: unknown) => FakeQueryBuilder } {
    return {
      set: (value: unknown) => {
        this.updates.push(value);
        return new FakeQueryBuilder(this.updateResults.shift() ?? []);
      },
    };
  }
}

class FakeQueryBuilder implements PromiseLike<unknown[]> {
  constructor(private readonly result: unknown[]) {}

  from(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class FakeInsertReturningBuilder {
  constructor(private readonly result: unknown[]) {}

  returning(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }
}

export class FakeRedis {
  readonly values = new Map<string, string>();
  readonly expirations = new Map<string, number>();
  readonly deletedKeys: string[] = [];

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  incr(key: string): Promise<number> {
    const nextValue = Number(this.values.get(key) ?? '0') + 1;
    this.values.set(key, String(nextValue));
    return Promise.resolve(nextValue);
  }

  expire(key: string, seconds: number): Promise<number> {
    this.expirations.set(key, seconds);
    return Promise.resolve(1);
  }

  del(key: string): Promise<number> {
    this.deletedKeys.push(key);
    const existed = this.values.delete(key);
    return Promise.resolve(existed ? 1 : 0);
  }
}

export function createAuditMock(): AuditMock {
  const push = vi.fn<(entry: AuditEntry) => void>();
  return {
    push,
    service: {
      push,
    } as unknown as AuditService,
  };
}

export function createUser(passwordHash: string, overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: TEST_USER_ID,
    tenant_id: TEST_TENANT_ID,
    email: TEST_EMAIL,
    display_name: 'Test User',
    password_hash: passwordHash,
    role: 'editor',
    status: 'active',
    permission_version: 1,
    last_login_at: null,
    created_at: new Date('2026-04-01T00:00:00.000Z'),
    updated_at: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function createSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'session-1',
    tenant_id: TEST_TENANT_ID,
    user_id: TEST_USER_ID,
    refresh_token_hash: 'refresh-token-hash',
    ip: '203.0.113.10',
    user_agent: 'vitest-agent',
    last_used_at: new Date('2026-04-29T11:00:00.000Z'),
    expires_at: new Date(Date.now() + 60 * 60 * 1_000),
    revoked_at: null,
    created_at: new Date('2026-04-29T10:00:00.000Z'),
    ...overrides,
  };
}

export function createAuthenticatedUser(
  overrides: Partial<AuthenticatedRequestUser> = {},
): AuthenticatedRequestUser {
  return {
    sub: TEST_USER_ID,
    tenant_id: TEST_TENANT_ID,
    email: TEST_EMAIL,
    role: 'editor',
    group_ids: ['group-1'],
    token_use: 'access',
    ...overrides,
  };
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Expected record');
  }

  return value;
}

export function getHttpExceptionCode(err: unknown): unknown {
  if (!(err instanceof HttpException)) {
    return undefined;
  }

  const response = err.getResponse();
  return isRecord(response) ? response.code : undefined;
}

function normalizeInsertedRows(value: unknown): unknown[] {
  const values: readonly unknown[] = Array.isArray(value) ? (value as readonly unknown[]) : [value];
  return values.map((item: unknown): unknown => {
    if (!isRecord(item) || typeof item.refresh_token_hash !== 'string') {
      return item;
    }

    return {
      ip: null,
      user_agent: null,
      last_used_at: null,
      revoked_at: null,
      created_at: new Date(),
      ...item,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
