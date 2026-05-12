import { and, eq, isNull } from 'drizzle-orm';

import { spaces } from '@cherrygraph/shared';

import type {
  DrizzleDatabase,
  SpaceProvisionJobData,
} from '../processors/space-provision.processor.js';

type DatabaseClient = Pick<DrizzleDatabase, 'select'>;

export type SpaceProvisionQueue = {
  add: (
    name: string,
    data: SpaceProvisionJobData,
    opts: { jobId: string },
  ) => Promise<unknown>;
};

type UnmappedSpaceRow = {
  spaceId: string;
  tenantId: string;
  spaceName: string;
  spaceSlug: string;
};

export async function reconcileSpaces(
  db: DrizzleDatabase,
  queue: SpaceProvisionQueue,
): Promise<number> {
  const unmappedSpaces = await loadUnmappedSpaces(db);
  const results = await Promise.allSettled(
    unmappedSpaces.map((space) => enqueueSpaceProvision(queue, space)),
  );

  return results.filter((result) => result.status === 'fulfilled').length;
}

async function loadUnmappedSpaces(db: DatabaseClient): Promise<UnmappedSpaceRow[]> {
  return db
    .select({
      spaceId: spaces.id,
      tenantId: spaces.tenant_id,
      spaceName: spaces.name,
      spaceSlug: spaces.slug,
    })
    .from(spaces)
    .where(and(eq(spaces.status, 'active'), isNull(spaces.docmost_space_id)));
}

async function enqueueSpaceProvision(
  queue: SpaceProvisionQueue,
  space: UnmappedSpaceRow,
): Promise<void> {
  await queue.add('space.provision', space, {
    jobId: `${space.tenantId}:${space.spaceId}`,
  });
}
