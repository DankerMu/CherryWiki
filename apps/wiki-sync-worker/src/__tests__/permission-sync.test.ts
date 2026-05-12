import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import {
  audit_logs,
  space_permissions,
  spaces,
} from '@cherrygraph/shared';

import { reconcilePermissions } from '../reconciliation/permission-reconcile.js';
import {
  createPermissionSyncProcessor,
  mapCherryRoleToDocmost,
  type DrizzleDatabase,
  type PermissionMember,
  type PermissionSyncBridgeClient,
  type PermissionSyncJobData,
} from '../processors/permission-sync.processor.js';

describe('permission-sync processor', () => {
  it('maps Cherry roles to Docmost roles', () => {
    expect(mapCherryRoleToDocmost('admin')).toBe('admin');
    expect(mapCherryRoleToDocmost('owner')).toBe('admin');
    expect(mapCherryRoleToDocmost('editor')).toBe('writer');
    expect(mapCherryRoleToDocmost('viewer')).toBe('reader');
    expect(mapCherryRoleToDocmost('custom')).toBe('reader');
  });

  it('pushes collapsed space permissions to Docmost', async () => {
    const db = new PermissionSyncTestDb();
    db.permissionRows = [
      { userId: 'user-admin', email: 'admin@example.com', cherryRole: 'space:admin' },
      { userId: 'user-writer', email: 'writer@example.com', cherryRole: 'space:edit' },
      { userId: 'user-reader', email: 'reader@example.com', cherryRole: 'space:view' },
      { userId: 'user-writer', email: 'writer@example.com', cherryRole: 'space:view' },
    ];
    const bridgeClient = createBridgeClient();

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.pushPermissions).toHaveBeenCalledWith('docmost-space-1', [
      { userId: 'user-admin', email: 'admin@example.com', role: 'admin' },
      { userId: 'user-reader', email: 'reader@example.com', role: 'reader' },
      { userId: 'user-writer', email: 'writer@example.com', role: 'writer' },
    ], { version: 1, source: 'cherry_api' });
  });

  it('skips spaces that have not been synced to Docmost', async () => {
    const db = new PermissionSyncTestDb({
      spaces: [createSpace({ docmost_space_id: null })],
    });
    const bridgeClient = createBridgeClient();

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.pushPermissions).not.toHaveBeenCalled();
  });

  it('treats Docmost 404 as non-retryable and writes an audit event', async () => {
    const db = new PermissionSyncTestDb();
    const bridgeClient = createBridgeClient(
      Object.assign(new Error('not found'), { status: 404 }),
    );

    await expect(runProcessor(db, bridgeClient)).rejects.toHaveProperty('name', 'UnrecoverableError');

    expect(db.auditRows).toEqual([
      expect.objectContaining({
        action: 'bridge.permission_sync_failed',
        space_id: 'space-1',
        metadata_json: expect.objectContaining({ nonRetryable: true }),
      }),
    ]);
  });

  it('retries transient push failures and audits only on the final attempt', async () => {
    const db = new PermissionSyncTestDb();
    const bridgeClient = createBridgeClient(
      Object.assign(new Error('upstream down'), { status: 500 }),
    );

    await expect(runProcessor(db, bridgeClient, { attemptsMade: 0 })).rejects.toThrow('upstream down');
    expect(db.auditRows).toHaveLength(0);

    await expect(runProcessor(db, bridgeClient, { attemptsMade: 2 })).rejects.toThrow('upstream down');
    expect(db.auditRows).toEqual([
      expect.objectContaining({
        action: 'bridge.permission_sync_failed',
        metadata_json: expect.objectContaining({ nonRetryable: false }),
      }),
    ]);
  });

  it('reconcile fixes permission drift by pushing Cherry state', async () => {
    const db = new PermissionSyncTestDb();
    const bridgeClient = {
      pushPermissions: vi.fn<PermissionSyncBridgeClient['pushPermissions']>(() => Promise.resolve()),
      getPermissions: vi.fn(() => Promise.resolve([])),
    };

    await expect(reconcilePermissions(db.asDb(), bridgeClient)).resolves.toEqual({ fixed: 1, errors: 0 });

    expect(bridgeClient.pushPermissions).toHaveBeenCalledWith('docmost-space-1', [
      { userId: 'user-admin', email: 'admin@example.com', role: 'admin' },
    ], { version: 1, source: 'cherry_api' });
    expect(db.auditRows.at(-1)).toMatchObject({ action: 'permission_consistency_fixed' });
  });

  it('reconcile is a no-op when permissions are already consistent', async () => {
    const db = new PermissionSyncTestDb();
    const bridgeClient = {
      pushPermissions: vi.fn<PermissionSyncBridgeClient['pushPermissions']>(() => Promise.resolve()),
      getPermissions: vi.fn(() =>
        Promise.resolve<PermissionMember[]>([
          { userId: 'user-admin', email: 'admin@example.com', role: 'admin' },
        ]),
      ),
    };

    await expect(reconcilePermissions(db.asDb(), bridgeClient)).resolves.toEqual({ fixed: 0, errors: 0 });

    expect(bridgeClient.pushPermissions).not.toHaveBeenCalled();
    expect(db.auditRows).toHaveLength(0);
  });
});

type SpaceRow = typeof spaces.$inferSelect;
type AuditLogInsert = typeof audit_logs.$inferInsert;

class PermissionSyncTestDb {
  spaces: SpaceRow[];
  permissionRows: Array<{ userId: string; email: string; cherryRole: string }> = [
    { userId: 'user-admin', email: 'admin@example.com', cherryRole: 'space:admin' },
  ];
  auditRows: AuditLogInsert[] = [];

  constructor(options: Partial<{ spaces: SpaceRow[] }> = {}) {
    this.spaces = options.spaces ?? [createSpace()];
  }

  select(selection?: unknown): unknown {
    return {
      from: (table: unknown) => {
        const resolveRows = (): unknown[] => {
          if (table === spaces) {
            if (isRecord(selection) && 'spaceId' in selection) {
              return this.spaces
                .filter((space) => space.docmost_space_id !== null)
                .map((space) => ({
                  spaceId: space.id,
                  tenantId: space.tenant_id,
                  docmostSpaceId: space.docmost_space_id,
                  permissionVersion: space.permission_version,
                }));
            }

            const space = this.spaces.find((row) => row.id === 'space-1');
            return space === undefined
              ? []
              : [{
                  tenantId: space.tenant_id,
                  docmostSpaceId: space.docmost_space_id,
                  permissionVersion: space.permission_version,
                }];
          }

          if (table === space_permissions) {
            return this.permissionRows;
          }

          return [];
        };

        return new SelectBuilder(resolveRows);
      },
    };
  }

  insert(table: unknown): unknown {
    return {
      values: (values: unknown): Promise<void> => {
        if (table === audit_logs) {
          this.auditRows.push(values as AuditLogInsert);
        }
        return Promise.resolve();
      },
    };
  }

  asDb(): DrizzleDatabase {
    return this as unknown as DrizzleDatabase;
  }
}

class SelectBuilder {
  constructor(private readonly resolveRows: () => unknown[]) {}

  innerJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  limit(limit: number): Promise<unknown[]> {
    return Promise.resolve(this.resolveRows().slice(0, limit));
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolveRows()).then(onfulfilled, onrejected);
  }
}

async function runProcessor(
  db: PermissionSyncTestDb,
  bridgeClient: PermissionSyncBridgeClient,
  options: { attemptsMade?: number } = {},
): Promise<void> {
  const processor = createPermissionSyncProcessor({
    db: db.asDb(),
    bridgeClient,
  });

  await processor({
    data: { spaceId: 'space-1', tenantId: 'tenant-1' },
    attemptsMade: options.attemptsMade ?? 0,
    opts: { attempts: 3 },
  } as Job<PermissionSyncJobData>);
}

function createBridgeClient(error?: Error): PermissionSyncBridgeClient {
  return {
    pushPermissions: vi.fn<PermissionSyncBridgeClient['pushPermissions']>(() =>
      error === undefined ? Promise.resolve() : Promise.reject(error),
    ),
  };
}

function createSpace(overrides: Partial<SpaceRow> = {}): SpaceRow {
  return {
    id: 'space-1',
    tenant_id: 'tenant-1',
    name: 'Research',
    slug: 'research',
    description: null,
    status: 'active',
    docmost_space_id: 'docmost-space-1',
    wiki_repo_path: '/tmp/wiki',
    active_graphify_run_id: null,
    active_index_snapshot_id: null,
    index_consistency_status: 'healthy',
    permission_version: 1,
    strict_knowledge_only: true,
    graphify_config: {},
    database_config: { enabled: false },
    default_publish_policy: 'editor_publish',
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    updated_at: new Date('2026-05-05T10:00:00.000Z'),
    ...overrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
