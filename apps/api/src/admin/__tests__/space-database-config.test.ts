import 'reflect-metadata';

import { spaces } from '@cherrygraph/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ScriptedDb,
  TEST_ACTOR_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  createSpaceRow,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { decryptSpaceDatabaseConfig } from '../../spaces/database-config.js';
import { SpaceService, type SpaceContext } from '../../spaces/space.service.js';

describe('space database config', () => {
  afterEach(() => {
    delete process.env.DB_ENCRYPTION_KEY;
  });

  it('updates database_config using encrypted DSN storage and returns a masked response', async () => {
    process.env.DB_ENCRYPTION_KEY = 'test-key';
    const { service, db } = createContext();
    db.queueSelect([createSpaceRow()]);
    db.queueUpdate([
      createSpaceRow({
        database_config: {
          enabled: true,
          dsn: 'pgp:encrypted-value',
          allowed_tables: ['orders'],
          masked_columns: ['users.email'],
        },
      }),
    ]);

    const result = await service.updateSpace(
      TEST_SPACE_ID,
      {
        database_config: {
          enabled: true,
          dsn: 'postgres://user:pass@localhost/app',
          allowed_tables: ['orders'],
          masked_columns: ['users.email'],
        },
      },
      createAdminContext(),
    );

    const updateValue = requireRecord(db.updates[0]?.value);
    expect(db.updates[0]?.table).toBe(spaces);
    expect(updateValue.database_config).not.toEqual({
      enabled: true,
      dsn: 'postgres://user:pass@localhost/app',
      allowed_tables: ['orders'],
      masked_columns: ['users.email'],
    });
    expect(result.database_config).toEqual({
      enabled: true,
      dsn: '***',
      allowed_tables: ['orders'],
      masked_columns: ['users.email'],
    });
  });

  it('rejects enabling database_config without an existing or submitted DSN', async () => {
    const { service, db } = createContext();
    db.queueSelect([createSpaceRow({ database_config: { enabled: false } })]);

    const err = await getRejectedHttpException(
      service.updateSpace(
        TEST_SPACE_ID,
        {
          database_config: {
            enabled: true,
            allowed_tables: ['orders'],
          },
        },
        createAdminContext(),
      ),
    );

    expect(err.getStatus()).toBe(422);
    expect(getHttpExceptionCode(err)).toBe('VALIDATION_ERROR');
    expect(db.updates).toHaveLength(0);
  });

  it('encrypts user-submitted DSNs even when they start with the encrypted prefix', async () => {
    process.env.DB_ENCRYPTION_KEY = 'test-key';
    const { service, db } = createContext();
    db.queueSelect([createSpaceRow()]);
    db.queueUpdate([createSpaceRow({ database_config: { enabled: true, dsn: 'pgp:encrypted-value' } })]);

    await service.updateSpace(
      TEST_SPACE_ID,
      {
        database_config: {
          enabled: true,
          dsn: 'pgp:not-actually-encrypted',
        },
      },
      createAdminContext(),
    );

    const updateValue = requireRecord(db.updates[0]?.value);
    expect(collectSqlText(updateValue.database_config)).toContain('pgp_sym_encrypt');
  });

  it('preserves an existing encrypted DSN without requiring a new encryption key', async () => {
    const { service, db } = createContext();
    db.queueSelect([
      createSpaceRow({
        database_config: {
          enabled: true,
          dsn: 'pgp:encrypted-value',
          allowed_tables: ['orders'],
        },
      }),
    ]);
    db.queueUpdate([
      createSpaceRow({
        database_config: {
          enabled: true,
          dsn: 'pgp:encrypted-value',
          allowed_tables: ['orders', 'invoices'],
        },
      }),
    ]);

    await service.updateSpace(
      TEST_SPACE_ID,
      {
        database_config: {
          enabled: true,
          allowed_tables: ['orders', 'invoices'],
        },
      },
      createAdminContext(),
    );

    const updateValue = requireRecord(db.updates[0]?.value);
    expect(collectSqlText(updateValue.database_config)).not.toContain('pgp_sym_encrypt');
  });

  it('masks database_config.dsn in space GET responses while preserving enabled visibility', async () => {
    const { service, db } = createContext();
    db.queueSelect([
      createSpaceRow({
        database_config: {
          enabled: true,
          dsn: 'pgp:encrypted-value',
          allowed_tables: ['orders'],
        },
      }),
    ]);

    const result = await service.getSpace(TEST_SPACE_ID, createAdminContext());

    expect(result.database_config).toEqual({
      enabled: true,
      dsn: '***',
      allowed_tables: ['orders'],
    });
  });

  it('decrypts encrypted DSNs for Agent environment injection', async () => {
    process.env.DB_ENCRYPTION_KEY = 'test-key';
    const db = new ScriptedDb();
    db.queueExecute({ rows: [{ dsn: 'postgres://readonly@localhost/app' }] });

    const result = await decryptSpaceDatabaseConfig(db.asDrizzle(), {
      enabled: true,
      dsn: 'pgp:encrypted-value',
      allowed_tables: ['orders'],
      masked_columns: ['users.email'],
    });

    expect(result).toEqual({
      enabled: true,
      dsn: 'postgres://readonly@localhost/app',
      allowed_tables: ['orders'],
      masked_columns: ['users.email'],
    });
  });

  it('rejects invalid database_config input', async () => {
    const { service, db } = createContext();
    db.queueSelect([createSpaceRow()]);

    const err = await getRejectedHttpException(
      service.updateSpace(TEST_SPACE_ID, { database_config: { enabled: 'yes' } }, createAdminContext()),
    );

    expect(err.getStatus()).toBe(422);
    expect(getHttpExceptionCode(err)).toBe('VALIDATION_ERROR');
  });
});

function createContext(): {
  service: SpaceService;
  db: ScriptedDb;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  return {
    service: new SpaceService(db.asDrizzle(), audit.service),
    db,
  };
}

function createAdminContext(): SpaceContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
    userId: TEST_USER_ID,
    actorRole: 'admin',
  };
}

function collectSqlText(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return '';
  }

  const record = value as { queryChunks?: unknown[]; value?: unknown[] };
  const ownText = Array.isArray(record.value)
    ? record.value.filter((item): item is string => typeof item === 'string').join('')
    : '';
  const nestedText = Array.isArray(record.queryChunks)
    ? record.queryChunks.map((chunk) => collectSqlText(chunk)).join('')
    : '';

  return `${ownText}${nestedText}`;
}
