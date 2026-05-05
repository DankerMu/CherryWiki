import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bridgeEvents,
  pageBlockMetadata,
  wikiPageVersions,
  wikiPages,
} from '@cherrygraph/shared';
import { normalizeBlockHash } from '@cherrygraph/wiki-core';

import {
  createPageSyncProcessor,
  type BridgeClient,
  type DrizzleDatabase,
  type PageSyncJobData,
} from '../processors/page-sync.processor.js';

describe('page-sync processor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processes page.saved through export, merge, version creation, metadata write, and synced status', async () => {
    const db = new PageSyncTestDb();
    db.metadataRows = [
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nOriginal', editable: false }),
      createMetadataRow({ block_id: 'details', owner: 'human', content: '## Details\nHuman notes' }),
    ];
    const bridgeClient = bridgeClientWithMarkdown(markedMarkdown());

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.exportPage).toHaveBeenCalledWith('docmost-page-1');
    expect(db.insertedVersions).toHaveLength(1);
    expect(db.insertedVersions[0]).toMatchObject({
      wiki_page_pk: 'wiki-pk-1',
      source: 'docmost',
      version_no: 2,
      created_by: 'user-1',
    });
    expect(db.insertedBlockMetadata).toHaveLength(2);
    expect(db.pageUpdates.at(-1)).toMatchObject({
      current_version_id: db.insertedVersions[0]?.id,
      sync_status: 'synced',
    });
    expect(db.bridgeEventUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('recovers ownership via heading fallback when markers are missing', async () => {
    const db = new PageSyncTestDb();
    db.metadataRows = [
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nOriginal', editable: false }),
    ];

    await runProcessor(db, bridgeClientWithMarkdown(frontmatter('## Overview\nHuman edit')));

    expect(db.insertedBlockMetadata[0]).toMatchObject({
      block_id: 'overview',
      owner: 'human',
      content_hash: normalizeBlockHash('## Overview\nHuman edit'),
      last_editor: 'user-1',
      editable: true,
    });
  });

  it('handles graphify-to-human, human-to-human, and new block ownership transitions', async () => {
    const db = new PageSyncTestDb();
    db.metadataRows = [
      createMetadataRow({ block_id: 'graphify-block', owner: 'graphify', content: '## Graphify Block\nOriginal', editable: false }),
      createMetadataRow({ block_id: 'human-block', owner: 'human', content: '## Human Block\nOriginal', last_editor: 'old-user' }),
      createMetadataRow({ block_id: 'deleted-block', owner: 'human', content: '## Deleted Block\nRemoved' }),
    ];
    const markdown = frontmatter(
      [
        '## Graphify Block',
        'Edited by human',
        '',
        '## Human Block',
        'Updated by human',
        '',
        '## New Block',
        'New content',
      ].join('\n'),
    );

    await runProcessor(db, bridgeClientWithMarkdown(markdown));

    expect(db.insertedBlockMetadata).toHaveLength(3);
    expect(blockById(db, 'graphify-block')).toMatchObject({
      owner: 'human',
      last_editor: 'user-1',
      editable: true,
    });
    expect(blockById(db, 'human-block')).toMatchObject({
      owner: 'human',
      last_editor: 'user-1',
      editable: true,
      content_hash: normalizeBlockHash('## Human Block\nUpdated by human'),
    });
    expect(blockById(db, 'new-block')).toMatchObject({
      owner: 'human',
      last_editor: 'user-1',
      editable: true,
    });
    expect(db.insertedBlockMetadata.some((row) => row.block_id === 'deleted-block')).toBe(false);
  });

  it('coalesces stale same-page events so only the latest creates a version', async () => {
    const db = new PageSyncTestDb();
    db.bridgeEventRows = [
      createBridgeEvent({ id: 'older-event', event_id: 'older', received_at: new Date('2026-05-05T11:00:00.000Z') }),
      createBridgeEvent({ id: 'latest-event', event_id: 'latest', received_at: new Date('2026-05-05T11:01:00.000Z') }),
    ];
    const bridgeClient = bridgeClientWithMarkdown(frontmatter('## Overview\nLatest'));

    await runProcessor(db, bridgeClient, { bridgeEventId: 'older-event', eventId: 'older' });
    await runProcessor(db, bridgeClient, { bridgeEventId: 'latest-event', eventId: 'latest' });

    expect(db.insertedVersions).toHaveLength(1);
    expect(bridgeClient.exportPage).toHaveBeenCalledTimes(1);
    expect(db.bridgeEventRows.find((event) => event.id === 'older-event')?.status).toBe('processed');
  });

  it('marks permission denied events failed without creating a version', async () => {
    const db = new PageSyncTestDb();

    await runProcessor(db, bridgeClientWithMarkdown(frontmatter('## Overview\nDenied')), {}, false);

    expect(db.insertedVersions).toHaveLength(0);
    expect(db.bridgeEventUpdates.at(-1)).toMatchObject({
      status: 'failed',
      error_json: { code: 'PERMISSION_DENIED' },
    });
    expect(db.pageUpdates.at(-1)).toMatchObject({ sync_status: 'sync_pending' });
  });

  it('archives mapped pages on page.deleted', async () => {
    const db = new PageSyncTestDb();

    await runProcessor(db, bridgeClientWithMarkdown(''), {
      eventType: 'page.deleted',
      bridgeEventId: 'delete-event',
      eventId: 'delete',
    });

    expect(db.pageUpdates.at(-1)).toMatchObject({ status: 'archived' });
    expect(db.bridgeEventUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('marks unknown docmost_page_id events processed and skips export', async () => {
    const db = new PageSyncTestDb();
    db.page = undefined;
    const bridgeClient = bridgeClientWithMarkdown(frontmatter('## Overview\nSkipped'));

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.exportPage).not.toHaveBeenCalled();
    expect(db.insertedVersions).toHaveLength(0);
    expect(db.bridgeEventUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('repairs missing frontmatter from the DB page record', async () => {
    const db = new PageSyncTestDb();

    await runProcessor(db, bridgeClientWithMarkdown('## Overview\nNo frontmatter'));

    expect(db.insertedVersions[0]?.content_markdown).toContain('page_id: wiki.page.1');
    expect(db.insertedVersions[0]?.content_markdown).toContain('space_id: space-1');
    expect(db.insertedVersions[0]?.frontmatter_json).toMatchObject({
      page_id: 'wiki.page.1',
      space_id: 'space-1',
    });
  });
});

type BridgeEventRow = typeof bridgeEvents.$inferSelect;
type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;
type PageBlockMetadataRow = typeof pageBlockMetadata.$inferSelect;

class PageSyncTestDb {
  page: WikiPageRow | undefined = createPage();
  currentVersion: WikiPageVersionRow | undefined = createVersion();
  metadataRows: PageBlockMetadataRow[] = [];
  bridgeEventRows: BridgeEventRow[] = [createBridgeEvent()];
  insertedVersions: Array<typeof wikiPageVersions.$inferInsert> = [];
  insertedBlockMetadata: Array<typeof pageBlockMetadata.$inferInsert> = [];
  bridgeEventUpdates: Array<Partial<typeof bridgeEvents.$inferInsert>> = [];
  pageUpdates: Array<Partial<typeof wikiPages.$inferInsert>> = [];

  select(): unknown {
    return {
      from: (table: unknown) => {
        const resolveRows = (): unknown[] => {
          if (table === bridgeEvents) {
            return this.bridgeEventRows
              .filter((event) => event.status === 'received')
              .sort((left, right) => right.received_at.getTime() - left.received_at.getTime());
          }
          if (table === wikiPages) {
            return this.page === undefined ? [] : [{ page: this.page, spaceSlug: 'rd-platform' }];
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

  asDb(): DrizzleDatabase {
    return this as unknown as DrizzleDatabase;
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
      event.id === 'bridge-event-1' || event.id === 'older-event' || event.id === 'latest-event'
        ? { ...event, ...values }
        : event,
    ) as BridgeEventRow[];
  }
}

class SelectBuilder {
  constructor(private readonly resolveRows: () => unknown[]) {}

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

async function runProcessor(
  db: PageSyncTestDb,
  bridgeClient: BridgeClient,
  overrides: Partial<PageSyncJobData> = {},
  permissionAllowed = true,
): Promise<void> {
  const processor = createPageSyncProcessor({
    db: db.asDb(),
    bridgeClient,
    wikiRepoPath: '/tmp/wiki',
    permissionChecker: () => permissionAllowed,
  });

  await processor({
    data: {
      bridgeEventId: 'bridge-event-1',
      eventId: 'docmost-event-1',
      eventType: 'page.saved',
      pageId: 'docmost-page-1',
      ...overrides,
    },
  } as Job<PageSyncJobData>);
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

function markedMarkdown(): string {
  return frontmatter(
    [
      '<!-- graphify:managed:start id="overview" run="gf-1" -->',
      '## Overview',
      'Original',
      '<!-- graphify:managed:end -->',
      '',
      '<!-- graphify:human:start id="details" run="gf-1" -->',
      '## Details',
      'Human notes',
      '<!-- graphify:human:end -->',
    ].join('\n'),
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

function blockById(db: PageSyncTestDb, blockId: string): typeof pageBlockMetadata.$inferInsert | undefined {
  return db.insertedBlockMetadata.find((row) => row.block_id === blockId);
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
    version_no: 1,
    content_markdown: frontmatter('## Overview\nOriginal'),
    frontmatter_json: {
      page_id: 'wiki.page.1',
      space_id: 'space-1',
      title: 'Test Page',
      status: 'draft',
      source: 'graphify',
    },
    source: 'graphify',
    graphify_run_id: 'gf-1',
    commit_hash: 'commit-1',
    status: 'draft',
    created_by: 'graphify',
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    ...overrides,
  };
}

function createMetadataRow(
  overrides: Partial<PageBlockMetadataRow> & { block_id: string; content: string },
): PageBlockMetadataRow {
  return {
    id: `metadata-${overrides.block_id}`,
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    wiki_page_pk: 'wiki-pk-1',
    page_version_id: 'version-1',
    block_id: overrides.block_id,
    owner: overrides.owner ?? 'human',
    content_hash: normalizeBlockHash(overrides.content),
    graphify_run_id: overrides.graphify_run_id ?? 'gf-1',
    last_editor: overrides.last_editor ?? null,
    editable: overrides.editable ?? true,
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    updated_at: new Date('2026-05-05T10:00:00.000Z'),
  };
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
