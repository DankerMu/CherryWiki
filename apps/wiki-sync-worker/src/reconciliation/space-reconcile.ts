import { and, asc, eq, gt, isNull } from 'drizzle-orm';

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

const SPACE_RECONCILE_BATCH_SIZE = 50;

export async function reconcileSpaces(
  db: DrizzleDatabase,
  queue: SpaceProvisionQueue,
): Promise<number> {
  let enqueuedCount = 0;
  let cursor: string | undefined;

  for (;;) {
    const unmappedSpaces = await loadUnmappedSpaces(db, cursor);
    if (unmappedSpaces.length === 0) {
      return enqueuedCount;
    }

    const results = await Promise.allSettled(
      unmappedSpaces.map((space) => enqueueSpaceProvision(queue, space)),
    );
    enqueuedCount += results.filter((result) => result.status === 'fulfilled').length;

    cursor = unmappedSpaces[unmappedSpaces.length - 1]?.spaceId;
  }
}

async function loadUnmappedSpaces(
  db: DatabaseClient,
  afterSpaceId?: string,
): Promise<UnmappedSpaceRow[]> {
  const predicates = [
    eq(spaces.status, 'active'),
    isNull(spaces.docmost_space_id),
  ];

  if (afterSpaceId !== undefined) {
    predicates.push(gt(spaces.id, afterSpaceId));
  }

  return db
    .select({
      spaceId: spaces.id,
      tenantId: spaces.tenant_id,
      spaceName: spaces.name,
      spaceSlug: spaces.slug,
    })
    .from(spaces)
    .where(and(...predicates))
    .orderBy(asc(spaces.id))
    .limit(SPACE_RECONCILE_BATCH_SIZE);
}

async function enqueueSpaceProvision(
  queue: SpaceProvisionQueue,
  space: UnmappedSpaceRow,
): Promise<void> {
  await queue.add('space.provision', space, {
    jobId: `${space.tenantId}:${space.spaceId}`,
  });
}
