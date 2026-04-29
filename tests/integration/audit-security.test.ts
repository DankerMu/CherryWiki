import { audit_logs } from '@cherrygraph/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService, type AuditEntry } from '../../apps/api/src/audit/audit.service.js';

type AuditLogInsert = typeof audit_logs.$inferInsert;
type ValuesMock = ReturnType<typeof vi.fn<(values: AuditLogInsert[]) => Promise<unknown>>>;
type InsertMock = ReturnType<typeof vi.fn<(table: typeof audit_logs) => { values: ValuesMock }>>;

let service: AuditService | undefined;

describe('audit metadata security', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    service = undefined;
    vi.useRealTimers();
  });

  it('strips sensitive top-level and nested metadata before persistence', async () => {
    const { db, values } = createDbMock();
    service = new AuditService(db);

    service.push(
      createEntry({
        metadata_json: {
          email: 'user@example.com',
          password: 'plain-password',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          api_key: 'api-key',
          password_hash: 'password-hash',
          visible: 'kept',
          nested: {
            password: 'nested-password',
            access_token: 'nested-access-token',
            refresh_token: 'nested-refresh-token',
            api_key: 'nested-api-key',
            password_hash: 'nested-password-hash',
            visible: true,
          },
          array: [
            {
              password_hash: 'array-password-hash',
              api_key: 'array-api-key',
              visible: 'array-kept',
            },
          ],
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(1_000);

    const metadata = getOnlyBatch(values)[0]?.metadata_json;
    expect(metadata).toEqual({
      email: 'user@example.com',
      visible: 'kept',
      nested: {
        visible: true,
      },
      array: [
        {
          visible: 'array-kept',
        },
      ],
    });
    expect(JSON.stringify(metadata)).not.toContain('password_hash');
  });
});

function createDbMock(): {
  db: {
    insert: InsertMock;
  };
  values: ValuesMock;
} {
  const values: ValuesMock = vi.fn(() => Promise.resolve());
  const insert: InsertMock = vi.fn(() => ({ values }));

  return {
    db: { insert },
    values,
  };
}

function createEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    tenant_id: 'tenant-1',
    actor_user_id: 'user-1',
    action: 'auth.login',
    resource_type: 'session',
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
