import { HttpException } from '@nestjs/common';
import type { AuditEntry, AuditService } from '../../audit/audit.service.js';
import type { SessionService } from '../../auth/session.service.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { vi } from 'vitest';
import { groups, spaces, users } from '@cherrygraph/shared';

export const TEST_TENANT_ID = 'tenant-1';
export const TEST_ACTOR_ID = 'admin-1';
export const TEST_USER_ID = 'user-1';
export const TEST_GROUP_ID = 'group-1';
export const TEST_SPACE_ID = 'space-1';

export type UserRow = typeof users.$inferSelect;
export type GroupRow = typeof groups.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;

export type OperationRecord = {
  table?: unknown;
  value?: unknown;
};

export type AuditMock = {
  service: AuditService;
  push: ReturnType<typeof vi.fn<(entry: AuditEntry) => void>>;
};

export type SessionMock = {
  service: SessionService;
  revokeAllActiveSessionsForUser: ReturnType<
    typeof vi.fn<(tenantId: string, userId: string, revokedAt: Date) => Promise<void>>
  >;
};

export type RedisMock = {
  publish: ReturnType<typeof vi.fn<(channel: string, message: string) => Promise<number>>>;
};

export class ScriptedDb {
  readonly inserts: OperationRecord[] = [];
  readonly updates: OperationRecord[] = [];
  readonly deletes: OperationRecord[] = [];
  readonly selectFields: unknown[] = [];
  readonly limitCalls: number[] = [];
  readonly offsetCalls: number[] = [];
  readonly selectResults: unknown[][] = [];
  readonly insertResults: unknown[][] = [];
  readonly updateResults: unknown[][] = [];
  readonly insertErrors: Error[] = [];
  readonly updateErrors: Error[] = [];

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

  queueInsertError(error: Error): void {
    this.insertErrors.push(error);
  }

  queueUpdateError(error: Error): void {
    this.updateErrors.push(error);
  }

  transaction<T>(callback: (tx: NodePgDatabase) => Promise<T>): Promise<T> {
    return callback(this.asDrizzle());
  }

  select(fields?: unknown): ScriptedQueryBuilder {
    this.selectFields.push(fields);
    return new ScriptedQueryBuilder(this, this.selectResults.shift() ?? []);
  }

  insert(table?: unknown): { values: (value: unknown) => ScriptedMutationBuilder } {
    return {
      values: (value: unknown) => {
        this.inserts.push({ table, value });
        return new ScriptedMutationBuilder(
          this.insertResults.shift() ?? normalizeInsertedRows(value),
          this.insertErrors.shift(),
        );
      },
    };
  }

  update(table?: unknown): { set: (value: unknown) => ScriptedMutationBuilder } {
    return {
      set: (value: unknown) => {
        this.updates.push({ table, value });
        return new ScriptedMutationBuilder(this.updateResults.shift() ?? [], this.updateErrors.shift());
      },
    };
  }

  delete(table?: unknown): ScriptedMutationBuilder {
    this.deletes.push({ table });
    return new ScriptedMutationBuilder([]);
  }
}

export class ScriptedQueryBuilder implements PromiseLike<unknown[]> {
  constructor(
    private readonly db: ScriptedDb,
    private readonly result: unknown[],
  ) {}

  from(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  leftJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  groupBy(): this {
    return this;
  }

  limit(limit: number): this {
    this.db.limitCalls.push(limit);
    return this;
  }

  offset(offset: number): Promise<unknown[]> {
    this.db.offsetCalls.push(offset);
    return Promise.resolve(this.result);
  }

  returning(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export class ScriptedMutationBuilder implements PromiseLike<unknown[]> {
  constructor(
    private readonly result: unknown[],
    private readonly error?: Error,
  ) {}

  where(): this {
    return this;
  }

  returning(): Promise<unknown[]> {
    if (this.error !== undefined) {
      return Promise.reject(this.error);
    }

    return Promise.resolve(this.result);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const promise =
      this.error === undefined ? Promise.resolve(this.result) : Promise.reject<unknown[]>(this.error);
    return promise.then(onfulfilled ?? undefined, onrejected ?? undefined);
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

export function createSessionMock(): SessionMock {
  const revokeAllActiveSessionsForUser = vi.fn<
    (tenantId: string, userId: string, revokedAt: Date) => Promise<void>
  >(() => Promise.resolve());
  return {
    revokeAllActiveSessionsForUser,
    service: {
      revokeAllActiveSessionsForUser,
    } as unknown as SessionService,
  };
}

export function createRedisMock(): RedisMock {
  return {
    publish: vi.fn<(channel: string, message: string) => Promise<number>>(() => Promise.resolve(1)),
  };
}

export function createUserRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: TEST_USER_ID,
    tenant_id: TEST_TENANT_ID,
    email: 'user@example.com',
    display_name: 'Test User',
    password_hash: 'password-hash',
    role: 'viewer',
    status: 'active',
    permission_version: 1,
    last_login_at: null,
    created_at: new Date('2026-04-01T00:00:00.000Z'),
    updated_at: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function createGroupRow(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    id: TEST_GROUP_ID,
    tenant_id: TEST_TENANT_ID,
    name: 'Editors',
    description: 'Editor group',
    permission_version: 1,
    created_at: new Date('2026-04-02T00:00:00.000Z'),
    ...overrides,
  };
}

export function createSpaceRow(overrides: Partial<SpaceRow> = {}): SpaceRow {
  return {
    id: TEST_SPACE_ID,
    tenant_id: TEST_TENANT_ID,
    name: 'Knowledge',
    slug: 'knowledge',
    description: 'Knowledge space',
    status: 'active',
    docmost_space_id: null,
    wiki_repo_path: '/data/wiki/space-1',
    active_graphify_run_id: null,
    active_index_snapshot_id: null,
    index_consistency_status: 'healthy',
    permission_version: 1,
    strict_knowledge_only: true,
    graphify_config: {},
    default_publish_policy: 'editor_publish',
    created_at: new Date('2026-04-03T00:00:00.000Z'),
    updated_at: new Date('2026-04-03T00:00:00.000Z'),
    ...overrides,
  };
}

export function createUniqueViolation(constraint: string): Error {
  const error = new Error('unique violation');
  Object.assign(error, {
    code: '23505',
    constraint,
  });
  return error;
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

export async function getRejectedHttpException(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpException) {
      return err;
    }

    throw err;
  }

  throw new Error('Expected promise to reject with HttpException');
}

function normalizeInsertedRows(value: unknown): unknown[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item: unknown): unknown => {
    if (!isRecord(item)) {
      return item;
    }

    return {
      created_at: new Date('2026-04-29T00:00:00.000Z'),
      updated_at: new Date('2026-04-29T00:00:00.000Z'),
      last_login_at: null,
      permission_version: 1,
      ...item,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
