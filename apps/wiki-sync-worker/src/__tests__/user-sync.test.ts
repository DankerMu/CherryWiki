import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { runStartupPermissionReconciliation } from '../main.js';
import {
  createUserSyncProcessor,
  type UserSyncBridgeClient,
  type UserSyncJobData,
} from '../processors/user-sync.processor.js';

describe('user-sync processor', () => {
  it('calls bridge to create or find a Docmost user', async () => {
    const bridgeClient = {
      syncUser: vi.fn<UserSyncBridgeClient['syncUser']>(() =>
        Promise.resolve({ docmost_user_id: 'docmost-user-1' }),
      ),
    };
    const db = createDb();
    const processor = createUserSyncProcessor({ db: db as never, bridgeClient });

    await processor({
      data: {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        name: 'Test User',
      },
    } as Job<UserSyncJobData>);

    expect(bridgeClient.syncUser).toHaveBeenCalledWith({
      email: 'user@example.com',
      name: 'Test User',
      cherry_user_id: 'user-1',
    });
    expect(db.update).toHaveBeenCalled();
  });

  it('user-sync completion enqueues permission-sync for affected spaces', async () => {
    const bridgeClient = {
      syncUser: vi.fn<UserSyncBridgeClient['syncUser']>(() =>
        Promise.resolve({ docmost_user_id: 'docmost-user-1' }),
      ),
    };
    const db = createDb([
      { spaceId: 'space-1', tenantId: 'tenant-1' },
      { spaceId: 'space-2', tenantId: 'tenant-1' },
    ]);
    const permissionSyncQueue = {
      add: vi.fn(() => Promise.resolve()),
    };
    const processor = createUserSyncProcessor({
      db: db as never,
      bridgeClient,
      permissionSyncQueue,
    });

    await processor({
      data: {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        name: 'Test User',
      },
    } as Job<UserSyncJobData>);

    expect(permissionSyncQueue.add).toHaveBeenCalledTimes(2);
    expect(permissionSyncQueue.add).toHaveBeenCalledWith('permission.sync', {
      spaceId: 'space-1',
      tenantId: 'tenant-1',
    });
    expect(permissionSyncQueue.add).toHaveBeenCalledWith('permission.sync', {
      spaceId: 'space-2',
      tenantId: 'tenant-1',
    });
  });
});

function createDb(
  affectedSpaces: Array<{ spaceId: string; tenantId: string }> = [],
): { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const selectBuilder = {
    innerJoin: vi.fn(() => selectBuilder),
    where: vi.fn(() => Promise.resolve(affectedSpaces)),
  };

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => selectBuilder),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: 'user-1' }])),
        })),
      })),
    })),
  };
}

describe('worker startup reconciliation', () => {
  it('runs permission reconciliation immediately at startup', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      })),
    };
    const bridgeClient = {
      pushPermissions: vi.fn(() => Promise.resolve()),
      getPermissions: vi.fn(() => Promise.resolve([])),
    };

    await runStartupPermissionReconciliation(db as never, bridgeClient);

    expect(db.select).toHaveBeenCalled();
  });
});
