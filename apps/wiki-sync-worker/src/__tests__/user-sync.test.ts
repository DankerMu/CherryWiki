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
    const processor = createUserSyncProcessor({ bridgeClient });

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
  });
});

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
