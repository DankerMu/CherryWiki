import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import {
  bridgeEvents,
  graphifyRuns,
  pageBlockMetadata,
  space_permissions,
  spaces,
  wikiPageVersions,
  wikiPages,
  wikiUpdateProposals,
} from '@cherrygraph/shared';
import { normalizeBlockHash } from '@cherrygraph/wiki-core';

import {
  createDocmostPushProcessor,
  type DocmostPushBridgeClient,
  type DocmostPushJobData,
  type DrizzleDatabase as DocmostPushDb,
} from '../../apps/wiki-sync-worker/src/processors/docmost-push.processor.js';
import {
  createPageSyncProcessor,
  type BridgeClient,
  type DrizzleDatabase as PageSyncDb,
  type PageSyncJobData,
} from '../../apps/wiki-sync-worker/src/processors/page-sync.processor.js';
import {
  createPermissionSyncProcessor,
  type DrizzleDatabase as PermissionSyncDb,
  type PermissionSyncBridgeClient,
  type PermissionSyncJobData,
} from '../../apps/wiki-sync-worker/src/processors/permission-sync.processor.js';

describe('wiki sync integration flows with mocked infrastructure', () => {
  it('processes page.saved into a new version, metadata, and synced status', async () => {
    const db = new PageFlowDb();
    db.metadataRows = [
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nOriginal' }),
    ];

    await runPageSync(db, bridgeClientWithMarkdown(frontmatter('## Overview\nHuman edit')));

    expect(db.insertedVersions).toHaveLength(1);
    expect(db.insertedBlockMetadata).toHaveLength(1);
    expect(db.insertedVersions[0]).toMatchObject({ source: 'docmost', version_no: 2 });
    expect(db.pageUpdates.at(-1)).toMatchObject({ sync_status: 'synced' });
    expect(db.bridgeEventUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('pushes Graphify pages to Docmost and marks the run synced', async () => {
    const db = new PushFlowDb({
      pages: [createPage({ docmost_page_id: null })],
      runVersions: [createVersion({ version_no: 1, content_markdown: frontmatter('## Overview\nNew') })],
      metadataRows: [createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nNew' })],
    });
    const bridgeClient = createDocmostBridgeClient();

    await runDocmostPush(db, bridgeClient);

    expect(bridgeClient.importPage).toHaveBeenCalledWith(
      'wiki.page.1',
      expect.stringContaining('## Overview\nNew'),
      { overwritePolicy: 'create_only' },
    );
    expect(db.pageUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ docmost_page_id: 'docmost-created-1' }),
        expect.objectContaining({ sync_status: 'synced' }),
      ]),
    );
    expect(db.graphifyRunUpdates.at(-1)).toMatchObject({ status: 'docmost_synced' });
  });

  it('transfers ownership after a human edit and keeps human content on the next push', async () => {
    const pageDb = new PageFlowDb();
    pageDb.metadataRows = [
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nOriginal' }),
    ];

    await runPageSync(pageDb, bridgeClientWithMarkdown(frontmatter('## Overview\nHuman edit')));

    const pushedHumanMetadata = toSelectedMetadataRows(pageDb.insertedBlockMetadata);
    expect(pushedHumanMetadata[0]).toMatchObject({ block_id: 'overview', owner: 'human' });

    const pushDb = new PushFlowDb({
      previousVersions: [
        createVersion({
          id: 'version-human',
          version_no: 2,
          content_markdown: frontmatter(['## Overview', 'Human edit', '', '## Details', 'Old graphify'].join('\n')),
        }),
      ],
      runVersions: [
        createVersion({
          id: 'version-graphify-next',
          version_no: 3,
          content_markdown: frontmatter(['## Overview', 'Graphify rewrite', '', '## Details', 'New graphify'].join('\n')),
          graphify_run_id: 'run-1',
        }),
      ],
      metadataRows: [
        ...pushedHumanMetadata.map((row) => ({
          ...row,
          page_version_id: 'version-graphify-next',
        })),
        createMetadataRow({
          block_id: 'details',
          owner: 'graphify',
          content: '## Details\nNew graphify',
          page_version_id: 'version-graphify-next',
        }),
      ],
    });
    const bridgeClient = createDocmostBridgeClient();

    await runDocmostPush(pushDb, bridgeClient);

    const pushedMarkdown = vi.mocked(bridgeClient.importPage).mock.calls[0]?.[1] ?? '';
    expect(pushedMarkdown).toContain('## Overview\nHuman edit');
    expect(pushedMarkdown).not.toContain('## Overview\nGraphify rewrite');
  });

  it('recovers ownership from sidecar metadata when exported markdown has no markers', async () => {
    const db = new PageFlowDb();
    db.metadataRows = [
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nOriginal' }),
    ];

    await runPageSync(db, bridgeClientWithMarkdown(frontmatter('## Overview\nHuman markerless edit')));

    expect(db.insertedBlockMetadata[0]).toMatchObject({
      block_id: 'overview',
      owner: 'human',
      content_hash: normalizeBlockHash('## Overview\nHuman markerless edit'),
    });
  });

  it('creates and resolves a simplified update proposal after conflict detection', async () => {
    const db = new PushFlowDb({
      previousVersions: [
        createVersion({
          id: 'previous-version',
          version_no: 1,
          content_markdown: frontmatter('## Details\nHuman notes'),
        }),
      ],
      runVersions: [
        createVersion({
          version_no: 2,
          content_markdown: frontmatter('## Details\nGraphify proposal'),
        }),
      ],
      metadataRows: [
        createMetadataRow({ block_id: 'details', owner: 'human', content: '## Details\nHuman notes' }),
      ],
    });

    await runDocmostPush(db, createDocmostBridgeClient());
    const proposal = db.insertedProposals[0];
    expect(proposal).toMatchObject({ proposal_type: 'conflict', status: 'pending' });

    resolveProposal(db, String(proposal?.id), 'accepted');

    expect(db.insertedProposals[0]).toMatchObject({ status: 'accepted' });
  });

  it('pushes permission changes with Docmost role mapping', async () => {
    const db = new PermissionFlowDb();
    db.permissionRows = [
      { userId: 'admin-user', email: 'admin@example.com', cherryRole: 'space:admin' },
      { userId: 'editor-user', email: 'editor@example.com', cherryRole: 'space:edit' },
      { userId: 'reader-user', email: 'reader@example.com', cherryRole: 'space:view' },
    ];
    const bridgeClient = {
      pushPermissions: vi.fn<PermissionSyncBridgeClient['pushPermissions']>(() => Promise.resolve()),
    };

    const processor = createPermissionSyncProcessor({
      db: db.asDb(),
      bridgeClient,
    });
    await processor({
      data: { spaceId: 'space-1', tenantId: 'tenant-1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as Job<PermissionSyncJobData>);

    expect(bridgeClient.pushPermissions).toHaveBeenCalledWith('docmost-space-1', [
      { userId: 'admin-user', email: 'admin@example.com', role: 'admin' },
      { userId: 'editor-user', email: 'editor@example.com', role: 'writer' },
      { userId: 'reader-user', email: 'reader@example.com', role: 'reader' },
    ]);
  });

  it('coalesces stale page events so only one version is created', async () => {
    const db = new PageFlowDb();
    db.bridgeEventRows = [
      createBridgeEvent({ id: 'older-event', event_id: 'older', received_at: new Date('2026-05-05T10:00:00.000Z') }),
      createBridgeEvent({ id: 'latest-event', event_id: 'latest', received_at: new Date('2026-05-05T10:01:00.000Z') }),
    ];
    const bridgeClient = bridgeClientWithMarkdown(frontmatter('## Overview\nLatest'));

    await runPageSync(db, bridgeClient, { bridgeEventId: 'older-event', eventId: 'older' });
    await runPageSync(db, bridgeClient, { bridgeEventId: 'latest-event', eventId: 'latest' });

    expect(db.insertedVersions).toHaveLength(1);
    expect(bridgeClient.exportPage).toHaveBeenCalledTimes(1);
  });
});

type BridgeEventRow = typeof bridgeEvents.$inferSelect;
type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;
type PageBlockMetadataRow = typeof pageBlockMetadata.$inferSelect;
type WikiUpdateProposalInsert = typeof wikiUpdateProposals.$inferInsert;
type SpaceRow = typeof spaces.$inferSelect;

class PageFlowDb {
  page: WikiPageRow | undefined = createPage();
  currentVersion: WikiPageVersionRow | undefined = createVersion({ version_no: 1 });
  metadataRows: PageBlockMetadataRow[] = [];
  bridgeEventRows: BridgeEventRow[] = [createBridgeEvent()];
  insertedVersions: Array<typeof wikiPageVersions.$inferInsert> = [];
  insertedBlockMetadata: Array<typeof pageBlockMetadata.$inferInsert> = [];
  bridgeEventUpdates: Array<Partial<typeof bridgeEvents.$inferInsert>> = [];
  pageUpdates: Array<Partial<typeof wikiPages.$inferInsert>> = [];
  activeBridgeEventId = 'bridge-event-1';

  select(selection?: unknown): unknown {
    return {
      from: (table: unknown) => {
        const resolveRows = (): unknown[] => {
          if (table === bridgeEvents) {
            if (isRecord(selection) && 'status' in selection) {
              const event = this.bridgeEventRows.find((row) => row.id === this.activeBridgeEventId);
              return event === undefined ? [] : [{ status: event.status }];
            }

            return this.bridgeEventRows
              .filter((event) => event.status === 'received')
              .sort((left, right) => right.received_at.getTime() - left.received_at.getTime());
          }
          if (table === wikiPages) {
            return this.page === undefined ? [] : [{ page: this.page, spaceSlug: 'research' }];
          }
          if (table === wikiPageVersions) {
            return this.currentVersion === undefined ? [] : [this.currentVersion];
          }
          if (table === pageBlockMetadata) {
            return this.metadataRows;
          }

          return [];
        };

        return new SelectBuilder(resolveRows);
      },
    };
  }

  transaction<T>(callback: (tx: PageFlowDb) => Promise<T>): Promise<T> {
    return callback(this);
  }

  update(table: unknown): unknown {
    return {
      set: (values: Record<string, unknown>) => ({
        where: (): Promise<void> => {
          if (table === bridgeEvents) {
            this.bridgeEventUpdates.push(values);
            this.applyBridgeEventUpdate(values);
          }
          if (table === wikiPages) {
            this.pageUpdates.push(values);
            if (this.page !== undefined) {
              this.page = { ...this.page, ...values } as WikiPageRow;
            }
          }
          return Promise.resolve();
        },
      }),
    };
  }

  insert(table: unknown): unknown {
    return {
      values: (values: unknown): Promise<void> => {
        if (table === wikiPageVersions) {
          this.insertedVersions.push(values as typeof wikiPageVersions.$inferInsert);
        }
        if (table === pageBlockMetadata) {
          this.insertedBlockMetadata.push(...(values as Array<typeof pageBlockMetadata.$inferInsert>));
        }
        return Promise.resolve();
      },
    };
  }

  asDb(): PageSyncDb {
    return this as unknown as PageSyncDb;
  }

  private applyBridgeEventUpdate(values: Record<string, unknown>): void {
    if (readErrorCode(values.error_json) === 'COALESCED') {
      const latestBridgeEventId = readLatestBridgeEventId(values.error_json);
      this.bridgeEventRows = this.bridgeEventRows.map((event) =>
        event.id === latestBridgeEventId ? event : { ...event, status: 'processed' },
      );
      return;
    }

    this.bridgeEventRows = this.bridgeEventRows.map((event) =>
      event.id === this.activeBridgeEventId ? { ...event, ...values } : event,
    ) as BridgeEventRow[];
  }
}

class PushFlowDb {
  pages: WikiPageRow[];
  runVersions: WikiPageVersionRow[];
  previousVersions: WikiPageVersionRow[];
  metadataRows: PageBlockMetadataRow[];
  insertedProposals: WikiUpdateProposalInsert[] = [];
  pageUpdates: Array<Partial<typeof wikiPages.$inferInsert>> = [];
  graphifyRunUpdates: Array<Partial<typeof graphifyRuns.$inferInsert>> = [];
  private wikiPageVersionSelectCount = 0;

  constructor(options: Partial<{
    pages: WikiPageRow[];
    runVersions: WikiPageVersionRow[];
    previousVersions: WikiPageVersionRow[];
    metadataRows: PageBlockMetadataRow[];
  }> = {}) {
    this.pages = options.pages ?? [createPage()];
    this.runVersions = options.runVersions ?? [createVersion()];
    this.previousVersions = options.previousVersions ?? [];
    this.metadataRows = options.metadataRows ?? [
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nNew' }),
    ];
  }

  select(): unknown {
    return {
      from: (table: unknown) => {
        const resolveRows = (): unknown[] => {
          if (table === wikiPageVersions) {
            if (this.wikiPageVersionSelectCount === 0) {
              this.wikiPageVersionSelectCount += 1;
              return this.runVersions;
            }

            this.wikiPageVersionSelectCount += 1;
            const previous = this.previousVersions.shift();
            return previous === undefined ? [] : [previous];
          }

          if (table === wikiPages) {
            return this.pages;
          }

          if (table === pageBlockMetadata) {
            return this.metadataRows;
          }

          return [];
        };

        return new SelectBuilder(resolveRows);
      },
    };
  }

  update(table: unknown): unknown {
    return {
      set: (values: Record<string, unknown>) => ({
        where: (): Promise<void> => {
          if (table === wikiPages) {
            this.pageUpdates.push(values);
            this.pages = this.pages.map((page) => ({ ...page, ...values }) as WikiPageRow);
          }
          if (table === graphifyRuns) {
            this.graphifyRunUpdates.push(values);
          }
          return Promise.resolve();
        },
      }),
    };
  }

  insert(table: unknown): unknown {
    return {
      values: (values: unknown): Promise<void> => {
        if (table === wikiUpdateProposals) {
          this.insertedProposals.push(...(Array.isArray(values) ? values : [values]) as WikiUpdateProposalInsert[]);
        }
        return Promise.resolve();
      },
    };
  }

  asDb(): DocmostPushDb {
    return this as unknown as DocmostPushDb;
  }
}

class PermissionFlowDb {
  spaces: SpaceRow[] = [createSpace()];
  permissionRows: Array<{ userId: string; email: string; cherryRole: string }> = [];

  select(selection?: unknown): unknown {
    return {
      from: (table: unknown) => {
        const resolveRows = (): unknown[] => {
          if (table === spaces) {
            if (isRecord(selection) && 'spaceId' in selection) {
              return this.spaces.map((space) => ({
                spaceId: space.id,
                tenantId: space.tenant_id,
                docmostSpaceId: space.docmost_space_id,
              }));
            }

            const space = this.spaces[0];
            return space === undefined
              ? []
              : [{ tenantId: space.tenant_id, docmostSpaceId: space.docmost_space_id }];
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

  insert(): unknown {
    return {
      values: (): Promise<void> => Promise.resolve(),
    };
  }

  asDb(): PermissionSyncDb {
    return this as unknown as PermissionSyncDb;
  }
}

class SelectBuilder {
  constructor(private readonly resolveRows: () => unknown[]) {}

  innerJoin(): this {
    return this;
  }

  leftJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
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

async function runPageSync(
  db: PageFlowDb,
  bridgeClient: BridgeClient,
  overrides: Partial<PageSyncJobData> = {},
): Promise<void> {
  const data = {
    bridgeEventId: 'bridge-event-1',
    eventId: 'docmost-event-1',
    eventType: 'page.saved',
    pageId: 'docmost-page-1',
    ...overrides,
  };
  db.activeBridgeEventId = data.bridgeEventId;

  const processor = createPageSyncProcessor({
    db: db.asDb(),
    bridgeClient,
    wikiRepoPath: '/tmp/wiki',
    permissionChecker: () => true,
  });

  await processor({ data } as Job<PageSyncJobData>);
}

async function runDocmostPush(
  db: PushFlowDb,
  bridgeClient: DocmostPushBridgeClient,
): Promise<void> {
  const processor = createDocmostPushProcessor({
    db: db.asDb(),
    bridgeClient,
  });

  await processor({
    data: { runId: 'run-1', spaceId: 'space-1', tenantId: 'tenant-1' },
  } as Job<DocmostPushJobData>);
}

function bridgeClientWithMarkdown(markdown: string): BridgeClient {
  return {
    exportPage: vi.fn(() =>
      Promise.resolve({
        markdown,
        userId: 'user-1',
        userName: 'Ada Editor',
        userEmail: 'ada@example.com',
      }),
    ),
  };
}

function createDocmostBridgeClient(): DocmostPushBridgeClient {
  return {
    importPage: vi.fn<DocmostPushBridgeClient['importPage']>(() =>
      Promise.resolve({ docmostPageId: 'docmost-created-1', contentHash: 'hash-after' }),
    ),
    exportPage: vi.fn<DocmostPushBridgeClient['exportPage']>(),
  };
}

function resolveProposal(db: PushFlowDb, proposalId: string, status: 'accepted' | 'rejected'): void {
  db.insertedProposals = db.insertedProposals.map((proposal) =>
    proposal.id === proposalId ? { ...proposal, status, resolved_at: new Date() } : proposal,
  );
}

function frontmatter(content: string): string {
  return [
    '---',
    'page_id: wiki.page.1',
    'space_id: space-1',
    'title: Test Page',
    'status: draft',
    'source: graphify',
    '---',
    '',
    content,
  ].join('\n');
}

function createBridgeEvent(overrides: Partial<BridgeEventRow> = {}): BridgeEventRow {
  return {
    id: 'bridge-event-1',
    event_id: 'docmost-event-1',
    event_type: 'page.saved',
    source: 'docmost',
    space_id: 'space-1',
    page_id: 'docmost-page-1',
    payload: {},
    status: 'received',
    error_json: null,
    nonce: null,
    received_at: new Date('2026-05-05T12:00:00.000Z'),
    processed_at: null,
    created_at: new Date('2026-05-05T12:00:00.000Z'),
    ...overrides,
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
    default_publish_policy: 'editor_publish',
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    updated_at: new Date('2026-05-05T10:00:00.000Z'),
    ...overrides,
  };
}

function createPage(overrides: Partial<WikiPageRow> = {}): WikiPageRow {
  return {
    id: 'wiki-pk-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    page_id: 'wiki.page.1',
    title: 'Test Page',
    slug: 'test-page',
    status: 'draft',
    current_version_id: 'version-1',
    indexed_version_id: null,
    sync_status: 'synced',
    docmost_page_id: 'docmost-page-1',
    created_by: 'user-1',
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    updated_at: new Date('2026-05-05T10:00:00.000Z'),
    ...overrides,
  };
}

function createVersion(overrides: Partial<WikiPageVersionRow> = {}): WikiPageVersionRow {
  return {
    id: 'version-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    wiki_page_pk: 'wiki-pk-1',
    page_id: 'wiki.page.1',
    version_no: 2,
    content_markdown: frontmatter('## Overview\nNew'),
    frontmatter_json: {
      page_id: 'wiki.page.1',
      space_id: 'space-1',
      title: 'Test Page',
      status: 'draft',
      source: 'graphify',
    },
    source: 'graphify',
    graphify_run_id: 'run-1',
    commit_hash: 'commit-1',
    status: 'draft',
    created_by: 'graphify',
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    ...overrides,
  };
}

function createMetadataRow(
  overrides: Partial<PageBlockMetadataRow> & {
    block_id: string;
    owner: 'graphify' | 'human';
    content: string;
  },
): PageBlockMetadataRow {
  const { content, block_id: blockId, owner, ...rest } = overrides;

  return {
    id: `metadata-${blockId}`,
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    wiki_page_pk: 'wiki-pk-1',
    page_version_id: 'version-1',
    block_id: blockId,
    owner,
    content_hash: normalizeBlockHash(content),
    graphify_run_id: 'run-1',
    last_editor: null,
    editable: owner === 'human',
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    updated_at: new Date('2026-05-05T10:00:00.000Z'),
    ...rest,
  };
}

function toSelectedMetadataRows(
  rows: Array<typeof pageBlockMetadata.$inferInsert>,
): PageBlockMetadataRow[] {
  return rows.map((row) => ({
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    space_id: String(row.space_id),
    wiki_page_pk: String(row.wiki_page_pk),
    page_version_id: String(row.page_version_id),
    block_id: String(row.block_id),
    owner: String(row.owner),
    content_hash: String(row.content_hash),
    graphify_run_id: row.graphify_run_id ?? null,
    last_editor: row.last_editor ?? null,
    editable: Boolean(row.editable),
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    updated_at: new Date('2026-05-05T10:00:00.000Z'),
  }));
}

function readErrorCode(value: unknown): string | undefined {
  return value !== null && typeof value === 'object' && 'code' in value
    ? String((value as { code: unknown }).code)
    : undefined;
}

function readLatestBridgeEventId(value: unknown): string | undefined {
  return value !== null && typeof value === 'object' && 'latestBridgeEventId' in value
    ? String((value as { latestBridgeEventId: unknown }).latestBridgeEventId)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
