import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { spaces } from '@cherrygraph/shared';

import { reconcileSpaces } from '../../reconciliation/space-reconcile.js';
import {
  createSpaceProvisionProcessor,
  type DrizzleDatabase,
  type SpaceProvisionBridgeClient,
  type SpaceProvisionJobData,
} from '../space-provision.processor.js';

describe('space-provision processor', () => {
  it('calls bridge and updates docmost_space_id', async () => {
    const db = new SpaceProvisionTestDb();
    const bridgeClient = createBridgeClient();

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.provisionSpace).toHaveBeenCalledWith({
      name: 'Research',
      slug: 'research',
      cherry_space_id: 'space-1',
    });
    expect(db.spaceUpdates).toEqual([
      expect.objectContaining({ docmost_space_id: 'docmost-space-1' }),
    ]);
  });

  it('treats an already-mapped space as successful writeback', async () => {
    const db = new SpaceProvisionTestDb({
      spaces: [createSpace({ docmost_space_id: 'docmost-space-existing' })],
    });
    const bridgeClient = createBridgeClient();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await runProcessor(db, bridgeClient);

    expect(db.spaceUpdates).toHaveLength(0);
    expect(info).toHaveBeenCalledWith(
      'space-provision: skipped docmost_space_id writeback; mapping already exists',
      expect.objectContaining({
        spaceId: 'space-1',
        tenantId: 'tenant-1',
        docmostSpaceId: 'docmost-space-1',
      }),
    );

    info.mockRestore();
  });

  it('throws on bridge failure', async () => {
    const db = new SpaceProvisionTestDb();
    const bridgeClient = createBridgeClient(new Error('upstream down'));

    await expect(runProcessor(db, bridgeClient)).rejects.toThrow('upstream down');

    expect(db.spaceUpdates).toHaveLength(0);
  });

  it('reconcileSpaces enqueues jobs for unmapped active spaces', async () => {
    const db = new SpaceProvisionTestDb({
      spaces: [
        createSpace({ id: 'space-1', docmost_space_id: null, status: 'active' }),
        createSpace({ id: 'space-2', docmost_space_id: 'docmost-space-2', status: 'active' }),
        createSpace({ id: 'space-3', docmost_space_id: null, status: 'archived' }),
      ],
    });
    const queue = { add: vi.fn(() => Promise.resolve()) };

    await expect(reconcileSpaces(db.asDb(), queue)).resolves.toBe(1);

    expect(queue.add).toHaveBeenCalledWith(
      'space.provision',
      {
        spaceId: 'space-1',
        tenantId: 'tenant-1',
        spaceName: 'Research',
        spaceSlug: 'research',
      },
      { jobId: 'tenant-1:space-1' },
    );
  });

  it('reconcileSpaces enqueues unmapped spaces in batches', async () => {
    const unmappedSpaces = Array.from({ length: 51 }, (_, index) =>
      createSpace({
        id: `space-${String(index + 1).padStart(2, '0')}`,
        docmost_space_id: null,
        status: 'active',
      }),
    );
    const db = new SpaceProvisionTestDb({ spaces: unmappedSpaces });
    const queue = { add: vi.fn(() => Promise.resolve()) };

    await expect(reconcileSpaces(db.asDb(), queue)).resolves.toBe(51);

    expect(queue.add).toHaveBeenCalledTimes(51);
    expect(db.selectPageCount).toBe(3);
  });
});

type SpaceRow = typeof spaces.$inferSelect;

class SpaceProvisionTestDb {
  spaces: SpaceRow[];
  spaceUpdates: Array<Partial<typeof spaces.$inferInsert>> = [];
  selectPageCount = 0;

  constructor(options: Partial<{ spaces: SpaceRow[] }> = {}) {
    this.spaces = options.spaces ?? [createSpace()];
  }

  select(): unknown {
    return {
      from: (table: unknown) => {
        const resolveRows = (limit?: number): unknown[] => {
          if (table === spaces) {
            const rows = this.spaces
              .filter((space) => space.status === 'active' && space.docmost_space_id === null)
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((space) => ({
                spaceId: space.id,
                tenantId: space.tenant_id,
                spaceName: space.name,
                spaceSlug: space.slug,
              }));

            const offset = this.selectPageCount * (limit ?? rows.length);
            this.selectPageCount += 1;
            return rows.slice(offset, limit === undefined ? undefined : offset + limit);
          }

          return [];
        };

        return new SelectBuilder(resolveRows);
      },
    };
  }

  update(table: unknown): unknown {
    return {
      set: (values: Partial<typeof spaces.$inferInsert>) => ({
        where: () => ({
          returning: (): Promise<Array<{ id: string }>> => {
            const space = this.spaces.find(
              (candidate) =>
                candidate.id === 'space-1' &&
                candidate.tenant_id === 'tenant-1' &&
                candidate.docmost_space_id === null,
            );

            if (table === spaces && space !== undefined) {
              this.spaceUpdates.push(values);
              space.docmost_space_id = values.docmost_space_id ?? null;
              space.updated_at = values.updated_at ?? space.updated_at;
              return Promise.resolve([{ id: space.id }]);
            }

            return Promise.resolve([]);
          },
        }),
      }),
    };
  }

  asDb(): DrizzleDatabase {
    return this as unknown as DrizzleDatabase;
  }
}

class SelectBuilder {
  private limitValue: number | undefined;

  constructor(private readonly resolveRows: (limit?: number) => unknown[]) {}

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolveRows(this.limitValue)).then(onfulfilled, onrejected);
  }
}

async function runProcessor(
  db: SpaceProvisionTestDb,
  bridgeClient: SpaceProvisionBridgeClient,
): Promise<void> {
  const processor = createSpaceProvisionProcessor({
    db: db.asDb(),
    bridgeClient,
  });

  await processor({
    data: {
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      spaceName: 'Research',
      spaceSlug: 'research',
    },
  } as Job<SpaceProvisionJobData>);
}

function createBridgeClient(error?: Error): SpaceProvisionBridgeClient {
  return {
    provisionSpace: vi.fn<SpaceProvisionBridgeClient['provisionSpace']>(() =>
      error === undefined
        ? Promise.resolve({ docmost_space_id: 'docmost-space-1' })
        : Promise.reject(error),
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
    docmost_space_id: null,
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
