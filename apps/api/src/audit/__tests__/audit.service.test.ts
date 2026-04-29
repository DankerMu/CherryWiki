import { audit_logs, type RequestContext } from '@cherrygraph/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getApiLogger } from '../../common/logger/logger.module.js';
import { requestContextStorage } from '../../common/middleware/request-context.middleware.js';
import { AuditService, type AuditEntry } from '../audit.service.js';

type AuditLogInsert = typeof audit_logs.$inferInsert;
type ValuesMock = ReturnType<typeof vi.fn<(values: AuditLogInsert[]) => Promise<unknown>>>;
type InsertMock = ReturnType<typeof vi.fn<(table: typeof audit_logs) => { values: ValuesMock }>>;

type DbMock = {
  db: {
    insert: InsertMock;
  };
  insert: InsertMock;
  values: ValuesMock;
};

let service: AuditService | undefined;

describe('AuditService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    service = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flushes queued entries on the 1 second timer', async () => {
    const { db, insert, values } = createDbMock();
    service = new AuditService(db);

    service.push(createEntry({ resource_id: 'session-1' }));

    await vi.advanceTimersByTimeAsync(999);
    expect(insert).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(insert).toHaveBeenCalledWith(audit_logs);
    const batch = getOnlyBatch(values);
    expect(batch).toHaveLength(1);
    const row = requireValue(batch[0]);
    expect(typeof row.id).toBe('string');
    expect(row).toMatchObject({
      tenant_id: 'tenant-1',
      action: 'auth.login',
      resource_type: 'session',
      resource_id: 'session-1',
      metadata_json: {},
    });
  });

  it('flushes immediately when the queue reaches 50 entries', async () => {
    const { db, values } = createDbMock();
    service = new AuditService(db);

    for (let index = 0; index < 50; index += 1) {
      service.push(createEntry({ resource_id: `session-${index}` }));
    }

    await Promise.resolve();

    const batch = getOnlyBatch(values);
    expect(batch).toHaveLength(50);
    expect(batch[49]?.resource_id).toBe('session-49');
  });

  it('flushes queued entries in chunks and caps overflow by dropping the oldest queued entry', async () => {
    let firstInsertResolve: (() => void) | undefined;
    let valuesCallCount = 0;
    const { db, values } = createDbMock(() => {
      valuesCallCount += 1;

      if (valuesCallCount === 1) {
        return new Promise<unknown>((resolve) => {
          firstInsertResolve = () => {
            resolve(undefined);
          };
        });
      }

      return Promise.resolve();
    });
    const warn = vi.spyOn(getApiLogger(), 'warn').mockImplementation(() => undefined);
    service = new AuditService(db);

    for (let index = 0; index < 10_051; index += 1) {
      service.push(createEntry({ resource_id: `session-${index}` }));
    }

    expect(values).toHaveBeenCalledTimes(1);

    requireValue(firstInsertResolve)();
    await service.onModuleDestroy();
    service = undefined;

    const persistedResourceIds = values.mock.calls.flatMap(([batch]) => batch.map((row) => row.resource_id));
    expect(persistedResourceIds).toHaveLength(10_050);
    expect(persistedResourceIds).toContain('session-0');
    expect(persistedResourceIds).not.toContain('session-50');
    expect(persistedResourceIds).toContain('session-10050');
    expect(values.mock.calls.every(([batch]) => batch.length <= 50)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ audit_max_queue_size: 10_000 }),
      'Audit queue full; dropped oldest entry',
    );
  });

  it('does not write when the timer fires with an empty queue', async () => {
    const { db, insert } = createDbMock();
    service = new AuditService(db);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(insert).not.toHaveBeenCalled();
  });

  it('drains remaining entries on module destroy', async () => {
    const { db, values } = createDbMock();
    service = new AuditService(db);
    service.push(createEntry({ resource_id: 'session-1' }));

    await service.onModuleDestroy();
    service = undefined;

    const batch = getOnlyBatch(values);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.resource_id).toBe('session-1');
  });

  it('captures request_id from AsyncLocalStorage when entries are pushed', async () => {
    const { db, values } = createDbMock();
    service = new AuditService(db);

    requestContextStorage.run(createRequestContext({ request_id: 'req-audit-123' }), () => {
      service?.push(createEntry());
    });

    await vi.advanceTimersByTimeAsync(1_000);

    const batch = getOnlyBatch(values);
    expect(batch[0]?.request_id).toBe('req-audit-123');
  });

  it('requeues failed flush batches and retries them', async () => {
    let valuesCallCount = 0;
    const { db, values } = createDbMock(() => {
      valuesCallCount += 1;
      return valuesCallCount === 1 ? Promise.reject(new Error('database unavailable')) : Promise.resolve();
    });
    const warn = vi.spyOn(getApiLogger(), 'warn').mockImplementation(() => undefined);
    service = new AuditService(db);

    for (let index = 0; index < 50; index += 1) {
      service.push(createEntry({ resource_id: `session-${index}` }));
    }

    await service.onModuleDestroy();
    service = undefined;

    expect(values).toHaveBeenCalledTimes(2);
    const failedBatch = requireValue(values.mock.calls[0])[0];
    const retriedBatch = requireValue(values.mock.calls[1])[0];
    expect(retriedBatch.map((row) => row.resource_id)).toEqual(failedBatch.map((row) => row.resource_id));
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: { message: 'database unavailable' },
        audit_log_count: 50,
        retry_count: 1,
      }),
      'Audit log flush failed',
    );
  });

  it('drops a failed flush batch after two retries', async () => {
    const { db, values } = createDbMock(() => Promise.reject(new Error('database unavailable')));
    const warn = vi.spyOn(getApiLogger(), 'warn').mockImplementation(() => undefined);
    service = new AuditService(db);

    for (let index = 0; index < 50; index += 1) {
      service.push(createEntry({ resource_id: `session-${index}` }));
    }

    await service.onModuleDestroy();
    service = undefined;

    expect(values).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        err: { message: 'database unavailable' },
        audit_log_count: 50,
      }),
      'Audit log batch dropped after retry limit',
    );
  });

  it('strips sensitive metadata keys before persisting', async () => {
    const { db, values } = createDbMock();
    service = new AuditService(db);

    service.push(
      createEntry({
        metadata_json: {
          email: 'user@example.com',
          password: 'p@ssw0rd',
          password_hash: 'hash',
          access_token: 'access-token',
          authorization: 'Bearer token',
          encrypted_api_key_ref: 'safe-reference',
          nested: {
            api_secret: 'api-secret',
            encrypted_api_key_ref: 'nested-safe-reference',
            visible: true,
          },
          array: [
            {
              secret_value: 'secret-value',
              safe: 'value',
            },
          ],
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(1_000);

    const batch = getOnlyBatch(values);
    expect(batch[0]?.metadata_json).toEqual({
      email: 'user@example.com',
      encrypted_api_key_ref: 'safe-reference',
      nested: {
        encrypted_api_key_ref: 'nested-safe-reference',
        visible: true,
      },
      array: [
        {
          safe: 'value',
        },
      ],
    });
  });

  it('truncates metadata beyond the sanitization depth limit', async () => {
    const { db, values } = createDbMock();
    service = new AuditService(db);

    service.push(
      createEntry({
        metadata_json: {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    level6: 'too deep',
                  },
                },
              },
            },
          },
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(1_000);

    const batch = getOnlyBatch(values);
    expect(batch[0]?.metadata_json).toEqual({
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: '[truncated]',
              },
            },
          },
        },
      },
    });
  });
});

function createDbMock(valuesImplementation: (values: AuditLogInsert[]) => Promise<unknown> = () => Promise.resolve()): DbMock {
  const values: ValuesMock = vi.fn(valuesImplementation);
  const insert: InsertMock = vi.fn(() => ({ values }));

  return {
    db: { insert },
    insert,
    values,
  };
}

function createEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    tenant_id: 'tenant-1',
    actor_user_id: 'user-1',
    action: 'auth.login',
    resource_type: 'session',
    ip: '203.0.113.10',
    user_agent: 'Vitest',
    ...overrides,
  };
}

function createRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    request_id: 'req-default',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    space_id: null,
    ...overrides,
  };
}

function getOnlyBatch(values: ValuesMock): AuditLogInsert[] {
  expect(values).toHaveBeenCalledTimes(1);
  const call = values.mock.calls[0];
  if (call === undefined) {
    throw new Error('Expected values() to be called');
  }

  return call[0];
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected value');
  }

  return value;
}
