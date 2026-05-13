import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bridgeEvents,
  pageBlockMetadata,
  wikiPageVersions,
  wikiPages,
} from '@cherrygraph/shared';
import { normalizeBlockHash } from '@cherrygraph/wiki-core';

import {
  commitToWikiRepo,
  createPageSyncProcessor,
  type BridgeClient,
  type DrizzleDatabase,
  type PageSyncDeps,
  type PageSyncJobData,
} from '../processors/page-sync.processor.js';

describe('page-sync processor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates durable wiki file and commit hash', async () => {
    const wikiRepoPath = await fsPromises.mkdtemp(join(tmpdir(), 'page-sync-'));
    const content = frontmatter('## Durable\nPersisted content');

    try {
      const commit = await commitToWikiRepo(
        { wikiRepoPath },
        { page: createPage(), spaceSlug: 'rd-platform' },
        content,
        { userId: 'user-1', editId: 'edit-1' },
      );

      expect(commit).toMatchObject({
        commitHash: createHash('sha256').update(content, 'utf8').digest('hex'),
        repoPath: 'rd-platform/test-page.md',
        branch: 'main',
      });
      await expect(fsPromises.readFile(join(wikiRepoPath, 'rd-platform/test-page.md'), 'utf8')).resolves.toBe(content);
    } finally {
      await fsPromises.rm(wikiRepoPath, { recursive: true, force: true });
    }
  });

  it('sanitizes wiki repo path segments before writing files', async () => {
    const wikiRepoPath = await fsPromises.mkdtemp(join(tmpdir(), 'page-sync-'));
    const content = frontmatter('## Durable\nPersisted content');

    try {
      const commit = await commitToWikiRepo(
        { wikiRepoPath },
        {
          page: createPage({ slug: '../test/page' }),
          spaceSlug: 'rd/../platform',
        },
        content,
        { userId: 'user-1', editId: 'edit-1' },
      );

      expect(commit.repoPath).toBe('rd___platform/__test_page.md');
      await expect(fsPromises.readFile(join(wikiRepoPath, 'rd___platform/__test_page.md'), 'utf8')).resolves.toBe(content);
      await expect(fsPromises.access(join(wikiRepoPath, '..', 'test', 'page.md'))).rejects.toThrow();
    } finally {
      await fsPromises.rm(wikiRepoPath, { recursive: true, force: true });
    }
  });

  it('processes page.saved through export, merge, version creation, metadata write, and synced status', async () => {
    const db = new PageSyncTestDb();
    db.metadataRows = [
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nOriginal', editable: false }),
      createMetadataRow({ block_id: 'details', owner: 'human', content: '## Details\nHuman notes' }),
    ];
    const bridgeClient = bridgeClientWithMarkdown(markedMarkdown());
    const reindexQueue = {
      add: vi.fn(() => Promise.resolve({ id: 'reindex-job-1' })),
    };

    await runProcessor(db, bridgeClient, {}, true, { reindexQueue });

    expect(bridgeClient.exportPage).toHaveBeenCalledWith('docmost-page-1');
    expect(db.insertedVersions).toHaveLength(1);
    expect(db.insertedVersions[0]).toMatchObject({
      wiki_page_pk: 'wiki-pk-1',
      source: 'docmost',
      version_no: 2,
      created_by: 'user-1',
    });
    expect(db.insertedVersions[0]?.commit_hash).toBe(
      createHash('sha256').update(db.insertedVersions[0]?.content_markdown ?? '', 'utf8').digest('hex'),
    );
    expect(db.insertedBlockMetadata).toHaveLength(2);
    expect(db.pageUpdates[0]).toMatchObject({
      current_version_id: db.insertedVersions[0]?.id,
      sync_status: 'reindex_pending',
    });
    expect(reindexQueue.add).toHaveBeenCalledWith('reindex-page', {
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      trigger: 'page_sync',
      scope: 'single_page',
      page_id: 'wiki.page.1',
    });
    expect(db.pageUpdates.at(-1)).toMatchObject({
      sync_status: 'synced',
    });
    expect(db.bridgeEventUpdates.at(-1)).toMatchObject({ status: 'processed' });
  });

  it('leaves sync_status reindex_pending when reindex enqueue fails', async () => {
    const db = new PageSyncTestDb();
    const reindexQueue = {
      add: vi.fn(() => Promise.reject(new Error('queue unavailable'))),
    };

    await runProcessor(db, bridgeClientWithMarkdown(frontmatter('## Overview\nUpdated')), {}, true, { reindexQueue });

    expect(reindexQueue.add).toHaveBeenCalledWith('reindex-page', {
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      trigger: 'page_sync',
      scope: 'single_page',
      page_id: 'wiki.page.1',
    });
    expect(db.page?.sync_status).toBe('reindex_pending');
    expect(db.pageUpdates.at(-1)).toMatchObject({ sync_status: 'reindex_pending' });
  });

  it('keeps sync_status as synced when reindex enqueue succeeds', async () => {
    const db = new PageSyncTestDb();
    const reindexQueue = {
      add: vi.fn(() => Promise.resolve({ id: 'reindex-job-1' })),
    };

    await runProcessor(db, bridgeClientWithMarkdown(frontmatter('## Overview\nUpdated')), {}, true, { reindexQueue });

    expect(reindexQueue.add).toHaveBeenCalledWith('reindex-page', {
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      trigger: 'page_sync',
      scope: 'single_page',
      page_id: 'wiki.page.1',
    });
    expect(db.pageUpdates[0]).toMatchObject({ sync_status: 'reindex_pending' });
    expect(db.page?.sync_status).toBe('synced');
    expect(db.pageUpdates.at(-1)).toMatchObject({ sync_status: 'synced' });
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

  it('preserves new unmarked H2 section when markers are present', async () => {
    const db = new PageSyncTestDb();
    db.metadataRows = [
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nOriginal', editable: false }),
      createMetadataRow({ block_id: 'details', owner: 'human', content: '## Details\nHuman notes' }),
    ];
    const markdown = frontmatter(
      [
        '<!-- graphify:managed:start id="overview" run="gf-1" -->',
        '## Overview',
        'Original',
        '<!-- graphify:managed:end -->',
        '',
        '## New Unmarked Section',
        'This content was added outside markers.',
        '',
        '<!-- graphify:human:start id="details" run="gf-1" -->',
        '## Details',
        'Human notes',
        '<!-- graphify:human:end -->',
      ].join('\n'),
    );

    await runProcessor(db, bridgeClientWithMarkdown(markdown));

    expect(db.insertedBlockMetadata).toHaveLength(3);
    expect(blockById(db, 'new-unmarked-section')).toMatchObject({
      owner: 'human',
      last_editor: 'user-1',
      editable: true,
      content_hash: normalizeBlockHash('## New Unmarked Section\nThis content was added outside markers.'),
    });
    expect(db.insertedVersions[0]?.content_markdown).toContain('## New Unmarked Section');
  });

  it('handles graphify-to-human, human-to-human, and new block ownership transitions', async () => {
    const db = new PageSyncTestDb();
    db.metadataRows = [
      createMetadataRow({ block_id: 'graphify-block', owner: 'graphify', content: '## Graphify Block\nOriginal', editable: false }),
      createMetadataRow({ block_id: 'human-block', owner: 'human', content: '## Human Block\nOriginal', last_editor: 'old-user' }),
      createMetadataRow({ block_id: 'deleted-block', owner: 'human', content: '## Deleted Block\nRemoved' }),
    ];
    db.currentVersion = createVersion({
      content_markdown: frontmatter(
        [
          '## Graphify Block',
          'Original',
          '',
          '## Human Block',
          'Original',
          '',
          '## Deleted Block',
          'Removed',
        ].join('\n'),
      ),
    });
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

    expect(db.insertedBlockMetadata).toHaveLength(4);
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
    expect(blockById(db, 'deleted-block')).toMatchObject({
      owner: 'human',
      editable: true,
      content_hash: normalizeBlockHash('## Deleted Block\nRemoved'),
    });
    expect(db.insertedVersions[0]?.content_markdown).toContain(
      '<!-- graphify:human:retained id="deleted-block" reason="unmatched after Graphify regeneration" -->',
    );
    expect(db.insertedVersions[0]?.content_markdown).toContain('## Deleted Block\nRemoved');
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

  it('skips already-processed bridge event', async () => {
    const db = new PageSyncTestDb();
    db.bridgeEventRows = [createBridgeEvent({ status: 'processed', processed_at: new Date('2026-05-05T12:01:00.000Z') })];
    const bridgeClient = bridgeClientWithMarkdown(frontmatter('## Overview\nSkipped'));

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.exportPage).not.toHaveBeenCalled();
    expect(db.insertedVersions).toHaveLength(0);
    expect(db.bridgeEventUpdates).toHaveLength(0);
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

  it('enqueues reindex invalidation on page.deleted', async () => {
    const db = new PageSyncTestDb();
    const reindexQueue = {
      add: vi.fn(() => Promise.resolve({ id: 'invalidate-job-1' })),
    };

    await runProcessor(
      db,
      bridgeClientWithMarkdown(''),
      {
        eventType: 'page.deleted',
        bridgeEventId: 'delete-event',
        eventId: 'delete',
      },
      true,
      { reindexQueue },
    );

    expect(reindexQueue.add).toHaveBeenCalledWith('invalidate-page', {
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      trigger: 'page_deleted',
      scope: 'single_page',
      page_id: 'wiki.page.1',
    });
  });

  it('marks delete bridge event failed when reindex invalidation enqueue fails', async () => {
    const db = new PageSyncTestDb();
    const reindexQueue = {
      add: vi.fn(() => Promise.reject(new Error('queue unavailable'))),
    };

    await runProcessor(
      db,
      bridgeClientWithMarkdown(''),
      {
        eventType: 'page.deleted',
        bridgeEventId: 'delete-event',
        eventId: 'delete',
      },
      true,
      { reindexQueue },
    );

    expect(db.pageUpdates.at(-1)).toMatchObject({ status: 'archived' });
    expect(db.bridgeEventUpdates.at(-1)).toMatchObject({
      status: 'failed',
      error_json: {
        code: 'INVALIDATION_ENQUEUE_FAILED',
        message: 'Error: queue unavailable',
      },
    });
    expect(db.bridgeEventUpdates).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'processed' })]));
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

  it('marks event failed and page sync_pending when wiki repo persistence fails', async () => {
    const db = new PageSyncTestDb();
    const tempDir = await fsPromises.mkdtemp(join(tmpdir(), 'page-sync-'));
    const blockedRepoPath = join(tempDir, 'repo-file');
    await fsPromises.writeFile(blockedRepoPath, 'not a directory', 'utf8');

    try {
      await expect(
        runProcessor(db, bridgeClientWithMarkdown(frontmatter('## Overview\nUpdated')), {}, true, {
          wikiRepoPath: blockedRepoPath,
        }),
      ).rejects.toThrow();
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }

    expect(db.insertedVersions).toHaveLength(0);
    expect(db.bridgeEventUpdates.at(-1)).toMatchObject({ status: 'failed' });
    expect(db.pageUpdates.at(-1)).toMatchObject({ sync_status: 'sync_pending' });
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

  transaction<T>(callback: (tx: PageSyncTestDb) => Promise<T>): Promise<T> {
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
      event.id === this.activeBridgeEventId ? { ...event, ...values } : event,
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
  options: {
    wikiRepoPath?: string;
    reindexQueue?: PageSyncDeps['reindexQueue'];
  } = {},
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
    wikiRepoPath: options.wikiRepoPath ?? '/tmp/wiki',
    ...(options.reindexQueue !== undefined ? { reindexQueue: options.reindexQueue } : {}),
    permissionChecker: () => permissionAllowed,
  });

  await processor({
    data,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
