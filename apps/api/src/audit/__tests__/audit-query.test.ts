import { audit_logs } from '@cherrygraph/shared';
import type { AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';

import { AuditLogQueryDto, AuditQueryController, type AuditLogResponse } from '../audit-query.controller.js';

type AuditLogRow = typeof audit_logs.$inferSelect;

const TEST_TENANT_ID = 'tenant-1';
const OTHER_TENANT_ID = 'tenant-2';
const TEST_ACTOR_ID = 'user-1';
const TEST_SPACE_ID = 'space-1';
const dialect = new PgDialect();

describe('AuditQueryController', () => {
  it('lists audit logs with pagination', async () => {
    const db = new ScriptedAuditDb();
    db.queueSelect([createAuditLogRow({ id: 'audit-2', action: 'space.update' })]);
    db.queueSelect([{ total: 3 }]);
    const controller = new AuditQueryController(db.asDrizzle());

    const result = await controller.listAuditLogs(
      createQuery({ page: 2, per_page: 1, sort: '-created_at' }),
      createRequest(),
    );

    expect(result.data).toEqual([
      expect.objectContaining<Partial<AuditLogResponse>>({
        id: 'audit-2',
        action: 'space.update',
        actor_user_id: TEST_ACTOR_ID,
        space_id: TEST_SPACE_ID,
      }),
    ]);
    expect(result.pagination).toEqual({
      page: 2,
      per_page: 1,
      total: 3,
      has_next: true,
    });
    expect(db.limitCalls).toEqual([1]);
    expect(db.offsetCalls).toEqual([1]);
    expect(getWhereQuery(db).params).toEqual([TEST_TENANT_ID]);
  });

  it('filters by action', async () => {
    const db = createDbWithSingleResult();
    const controller = new AuditQueryController(db.asDrizzle());

    await controller.listAuditLogs(createQuery({ action: 'auth.login' }), createRequest());

    expect(getWhereQuery(db).sql).toContain('"audit_logs"."action" =');
    expect(getWhereQuery(db).params).toEqual([TEST_TENANT_ID, 'auth.login']);
  });

  it('filters by actor', async () => {
    const db = createDbWithSingleResult();
    const controller = new AuditQueryController(db.asDrizzle());

    await controller.listAuditLogs(createQuery({ actor: 'user-2' }), createRequest());

    expect(getWhereQuery(db).sql).toContain('"audit_logs"."actor_user_id" =');
    expect(getWhereQuery(db).params).toEqual([TEST_TENANT_ID, 'user-2']);
  });

  it('filters by space_id', async () => {
    const db = createDbWithSingleResult();
    const controller = new AuditQueryController(db.asDrizzle());

    await controller.listAuditLogs(createQuery({ space_id: 'space-2' }), createRequest());

    expect(getWhereQuery(db).sql).toContain('"audit_logs"."space_id" =');
    expect(getWhereQuery(db).params).toEqual([TEST_TENANT_ID, 'space-2']);
  });

  it('filters by time range', async () => {
    const db = createDbWithSingleResult();
    const controller = new AuditQueryController(db.asDrizzle());

    await controller.listAuditLogs(
      createQuery({
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-28T23:59:59.000Z',
      }),
      createRequest(),
    );

    const query = getWhereQuery(db);
    expect(query.sql).toContain('"audit_logs"."created_at" >=');
    expect(query.sql).toContain('"audit_logs"."created_at" <=');
    expect(query.params).toEqual([
      TEST_TENANT_ID,
      '2026-04-01T00:00:00.000Z',
      '2026-04-28T23:59:59.000Z',
    ]);
  });

  it('combines filters and remains tenant-scoped', async () => {
    const db = createDbWithSingleResult();
    const controller = new AuditQueryController(db.asDrizzle());

    await controller.listAuditLogs(
      createQuery({
        actor: 'user-2',
        action: 'space.permission_change',
        space: 'space-3',
        from: '2026-04-02T00:00:00.000Z',
        to: '2026-04-03T00:00:00.000Z',
      }),
      createRequest({
        user: createUser({ tenant_id: OTHER_TENANT_ID }),
      }),
    );

    expect(getWhereQuery(db).params).toEqual([
      OTHER_TENANT_ID,
      'user-2',
      'space.permission_change',
      'space-3',
      '2026-04-02T00:00:00.000Z',
      '2026-04-03T00:00:00.000Z',
    ]);
  });

  it('returns an empty result set', async () => {
    const db = new ScriptedAuditDb();
    db.queueSelect([]);
    db.queueSelect([{ total: 0 }]);
    const controller = new AuditQueryController(db.asDrizzle());

    const result = await controller.listAuditLogs(createQuery(), createRequest());

    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      page: 1,
      per_page: 20,
      total: 0,
      has_next: false,
    });
  });
});

class ScriptedAuditDb {
  readonly whereCalls: SQL[] = [];
  readonly orderByCalls: SQL[] = [];
  readonly limitCalls: number[] = [];
  readonly offsetCalls: number[] = [];
  private readonly selectResults: unknown[][] = [];

  asDrizzle(): NodePgDatabase {
    return this as unknown as NodePgDatabase;
  }

  queueSelect(result: unknown[]): void {
    this.selectResults.push(result);
  }

  select(): ScriptedQueryBuilder {
    return new ScriptedQueryBuilder(this.selectResults.shift() ?? [], this);
  }
}

class ScriptedQueryBuilder implements PromiseLike<unknown[]> {
  constructor(
    private readonly result: unknown[],
    private readonly db: ScriptedAuditDb,
  ) {}

  from(): this {
    return this;
  }

  where(where: SQL): this {
    this.db.whereCalls.push(where);
    return this;
  }

  orderBy(order: SQL): this {
    this.db.orderByCalls.push(order);
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

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function createDbWithSingleResult(): ScriptedAuditDb {
  const db = new ScriptedAuditDb();
  db.queueSelect([createAuditLogRow()]);
  db.queueSelect([{ total: 1 }]);
  return db;
}

function createQuery(overrides: Partial<AuditLogQueryDto> = {}): AuditLogQueryDto {
  return Object.assign(new AuditLogQueryDto(), overrides);
}

function getWhereQuery(db: ScriptedAuditDb): { sql: string; params: unknown[] } {
  const where = db.whereCalls[0];
  if (where === undefined) {
    throw new Error('Expected where clause');
  }

  const query = dialect.sqlToQuery(where);
  return {
    sql: query.sql,
    params: query.params,
  };
}

function createRequest(overrides: Partial<{ user: AuthenticatedRequestUser }> = {}): {
  user: AuthenticatedRequestUser;
} {
  return {
    user: createUser(),
    ...overrides,
  };
}

function createUser(overrides: Partial<AuthenticatedRequestUser> = {}): AuthenticatedRequestUser {
  return {
    sub: 'admin-1',
    tenant_id: TEST_TENANT_ID,
    email: 'admin@example.com',
    role: 'admin',
    group_ids: [],
    token_use: 'access',
    ...overrides,
  };
}

function createAuditLogRow(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: 'audit-1',
    tenant_id: TEST_TENANT_ID,
    actor_user_id: TEST_ACTOR_ID,
    action: 'auth.login',
    resource_type: 'auth',
    resource_id: 'session-1',
    space_id: TEST_SPACE_ID,
    ip: '203.0.113.10',
    user_agent: 'Vitest',
    request_id: 'req-1',
    metadata_json: { safe: true },
    created_at: new Date('2026-04-29T00:00:00.000Z'),
    ...overrides,
  };
}
