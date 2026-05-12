import { describe, expect, it, vi } from 'vitest';

import {
  TEST_ACTOR_ID,
  TEST_TENANT_ID,
  ScriptedDb,
  createAuditMock,
  createRedisMock,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { SpaceService } from '../space.service.js';

describe('SpaceService Docmost space provision', () => {
  it('calls enqueueSpaceProvisionJob after insert', async () => {
    const db = new ScriptedDb();
    const audit = createAuditMock();
    const bridgeQueue = {
      enqueueSpaceProvisionJob: vi.fn(() => Promise.resolve()),
    };
    const service = new SpaceService(
      db.asDrizzle(),
      audit.service,
      createRedisMock(),
      bridgeQueue as never,
    );
    db.queueSelect([]);

    const created = await service.createSpace(
      { name: 'Research', slug: 'research' },
      {
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_ACTOR_ID,
        userId: TEST_ACTOR_ID,
        actorRole: 'admin',
      },
    );

    expect(bridgeQueue.enqueueSpaceProvisionJob).toHaveBeenCalledWith({
      tenantId: TEST_TENANT_ID,
      spaceId: created.id,
      spaceName: 'Research',
      spaceSlug: 'research',
    });
  });
});
