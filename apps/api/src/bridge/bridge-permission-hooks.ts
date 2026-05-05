import type { BridgeQueueService } from './bridge-queue.service.js';

/**
 * Integration point for space membership add/remove/role-change paths.
 * Call this after the Cherry DB transaction commits so Docmost receives the
 * latest collapsed space permission set.
 */
export async function enqueuePermissionSync(
  queueService: BridgeQueueService,
  spaceId: string,
  tenantId: string,
): Promise<void> {
  await queueService.enqueuePermissionSyncJob({ spaceId, tenantId });
}
