import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import {
  graphifyRuns,
  pageBlockMetadata,
  wikiPageVersions,
  wikiPages,
  wikiUpdateProposals,
} from '@cherrygraph/shared';
import { normalizeBlockHash } from '@cherrygraph/wiki-core';

import {
  createDocmostPushProcessor,
  type DocmostPushBridgeClient,
  type DocmostPushJobData,
  type DrizzleDatabase,
} from '../processors/docmost-push.processor.js';

describe('docmost-push processor', () => {
  it('pushes a new page and writes back docmost_page_id', async () => {
    const db = new DocmostPushTestDb({
      pages: [createPage({ docmost_page_id: null })],
      runVersions: [createVersion({ version_no: 1, content_markdown: frontmatter('## Overview\nNew content') })],
      metadataRows: [createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nNew content' })],
    });
    const bridgeClient = createBridgeClient();

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.importPage).toHaveBeenCalledWith(
      'wiki.page.1',
      expect.stringContaining('<!-- graphify:managed:start id="overview" run="run-1" -->'),
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

  it('updates an existing page with optimistic expected hash', async () => {
    const db = new DocmostPushTestDb({
      previousVersions: [createVersion({ id: 'previous-version', version_no: 1, content_markdown: frontmatter('## Overview\nOld') })],
      runVersions: [createVersion({ version_no: 2, content_markdown: frontmatter('## Overview\nNew') })],
      metadataRows: [createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nNew' })],
    });
    const bridgeClient = createBridgeClient();

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.importPage).toHaveBeenCalledWith(
      'docmost-page-1',
      expect.stringContaining('## Overview\nNew'),
      expect.objectContaining({ overwritePolicy: 'update', expectedHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
  });

  it('retries once after optimistic lock conflict', async () => {
    const db = new DocmostPushTestDb({
      previousVersions: [createVersion({ id: 'previous-version', version_no: 1, content_markdown: frontmatter('## Overview\nOld') })],
      runVersions: [createVersion({ version_no: 2, content_markdown: frontmatter('## Overview\nNew') })],
      metadataRows: [createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nNew' })],
    });
    const conflict = Object.assign(new Error('conflict'), { status: 409 });
    const importPage = vi
      .fn<DocmostPushBridgeClient['importPage']>()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ docmostPageId: 'docmost-page-1', contentHash: 'hash-after' });
    const bridgeClient: DocmostPushBridgeClient = {
      importPage,
      exportPage: vi.fn<DocmostPushBridgeClient['exportPage']>(() =>
        Promise.resolve({ markdown: frontmatter('## Overview\nHuman edit during race') }),
      ),
    };

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.exportPage).toHaveBeenCalledWith('docmost-page-1');
    expect(bridgeClient.importPage).toHaveBeenCalledTimes(2);
    expect(bridgeClient.importPage).toHaveBeenNthCalledWith(
      2,
      'docmost-page-1',
      expect.stringContaining('## Overview\nHuman edit during race'),
      expect.objectContaining({ overwritePolicy: 'update', expectedHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
  });

  it('preserves human blocks while updating graphify blocks', async () => {
    const db = new DocmostPushTestDb({
      previousVersions: [
        createVersion({
          id: 'previous-version',
          version_no: 1,
          content_markdown: frontmatter(['## Overview', 'Old', '', '## Details', 'Human notes'].join('\n')),
        }),
      ],
      runVersions: [
        createVersion({
          version_no: 2,
          content_markdown: frontmatter(['## Overview', 'New graphify', '', '## Details', 'Graphify rewrite'].join('\n')),
        }),
      ],
      metadataRows: [
        createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nNew graphify' }),
        createMetadataRow({ block_id: 'details', owner: 'human', content: '## Details\nHuman notes' }),
      ],
    });
    const bridgeClient = createBridgeClient();

    await runProcessor(db, bridgeClient);

    const pushedMarkdown = vi.mocked(bridgeClient.importPage).mock.calls[0]?.[1] ?? '';
    expect(pushedMarkdown).toContain('<!-- graphify:human:start id="details" run="run-1" -->');
    expect(pushedMarkdown).toContain('## Details\nHuman notes');
    expect(pushedMarkdown).not.toContain('## Details\nGraphify rewrite');
    expect(db.insertedProposals).toHaveLength(1);
    expect(db.pageUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ sync_status: 'conflict_required' })]));
  });

  it('creates a conflict proposal for a human-owned block', async () => {
    const db = new DocmostPushTestDb({
      previousVersions: [createVersion({ id: 'previous-version', version_no: 1, content_markdown: frontmatter('## Details\nHuman notes') })],
      runVersions: [createVersion({ version_no: 2, content_markdown: frontmatter('## Details\nGraphify rewrite') })],
      metadataRows: [createMetadataRow({ block_id: 'details', owner: 'human', content: '## Details\nHuman notes' })],
    });

    await runProcessor(db, createBridgeClient());

    expect(db.insertedProposals).toHaveLength(1);
    expect(db.insertedProposals[0]).toMatchObject({
      proposal_type: 'conflict',
      status: 'pending',
      diff_json: {
        blockId: 'details',
        humanContent: '## Details\nHuman notes',
        graphifyContent: '## Details\nGraphify rewrite',
      },
    });
  });

  it('creates one proposal per conflicting human block', async () => {
    const db = new DocmostPushTestDb({
      previousVersions: [
        createVersion({
          id: 'previous-version',
          version_no: 1,
          content_markdown: frontmatter(['## One', 'Human one', '', '## Two', 'Human two'].join('\n')),
        }),
      ],
      runVersions: [
        createVersion({
          version_no: 2,
          content_markdown: frontmatter(['## One', 'Graphify one', '', '## Two', 'Graphify two'].join('\n')),
        }),
      ],
      metadataRows: [
        createMetadataRow({ block_id: 'one', owner: 'human', content: '## One\nHuman one' }),
        createMetadataRow({ block_id: 'two', owner: 'human', content: '## Two\nHuman two' }),
      ],
    });

    await runProcessor(db, createBridgeClient());

    expect(db.insertedProposals).toHaveLength(2);
    expect(db.insertedProposals.map((proposal) => readBlockId(proposal.diff_json))).toEqual(['one', 'two']);
  });

  it('skips unchanged existing pages', async () => {
    const unchanged = frontmatter('## Overview\nSame content');
    const db = new DocmostPushTestDb({
      previousVersions: [createVersion({ id: 'previous-version', version_no: 1, content_markdown: unchanged })],
      runVersions: [createVersion({ version_no: 2, content_markdown: unchanged })],
      metadataRows: [createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nSame content' })],
    });
    const bridgeClient = createBridgeClient();

    await runProcessor(db, bridgeClient);

    expect(bridgeClient.importPage).not.toHaveBeenCalled();
    expect(db.graphifyRunUpdates.at(-1)).toMatchObject({ status: 'docmost_synced' });
  });

  it('marks run failed and page sync pending when a page push fails', async () => {
    const db = new DocmostPushTestDb({
      previousVersions: [createVersion({ id: 'previous-version', version_no: 1, content_markdown: frontmatter('## Overview\nOld') })],
      runVersions: [createVersion({ version_no: 2, content_markdown: frontmatter('## Overview\nNew') })],
      metadataRows: [createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nNew' })],
    });
    const bridgeClient: DocmostPushBridgeClient = {
      importPage: vi.fn<DocmostPushBridgeClient['importPage']>(() => Promise.reject(Object.assign(new Error('down'), { status: 500 }))),
      exportPage: vi.fn<DocmostPushBridgeClient['exportPage']>(),
    };

    await runProcessor(db, bridgeClient);

    expect(db.pageUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ sync_status: 'sync_pending' })]));
    expect(db.graphifyRunUpdates.at(-1)).toMatchObject({ status: 'docmost_sync_failed' });
  });
});

type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;
type PageBlockMetadataRow = typeof pageBlockMetadata.$inferSelect;

class DocmostPushTestDb {
  pages: WikiPageRow[];
  runVersions: WikiPageVersionRow[];
  previousVersions: WikiPageVersionRow[];
  metadataRows: PageBlockMetadataRow[];
  insertedProposals: Array<typeof wikiUpdateProposals.$inferInsert> = [];
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
      createMetadataRow({ block_id: 'overview', owner: 'graphify', content: '## Overview\nNew content' }),
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
          this.insertedProposals.push(...(Array.isArray(values) ? values : [values]) as Array<typeof wikiUpdateProposals.$inferInsert>);
        }
        return Promise.resolve();
      },
    };
  }

  asDb(): DrizzleDatabase {
    return this as unknown as DrizzleDatabase;
  }
}

class SelectBuilder {
  constructor(private readonly resolveRows: () => unknown[]) {}

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
  db: DocmostPushTestDb,
  bridgeClient: DocmostPushBridgeClient,
): Promise<void> {
  const processor = createDocmostPushProcessor({
    db: db.asDb(),
    bridgeClient,
  });

  await processor({
    data: {
      runId: 'run-1',
      spaceId: 'space-1',
      tenantId: 'tenant-1',
    },
  } as Job<DocmostPushJobData>);
}

function createBridgeClient(): DocmostPushBridgeClient {
  return {
    importPage: vi.fn<DocmostPushBridgeClient['importPage']>(() =>
      Promise.resolve({ docmostPageId: 'docmost-created-1', contentHash: 'hash-after' }),
    ),
    exportPage: vi.fn<DocmostPushBridgeClient['exportPage']>(),
  };
}

function frontmatter(content: string): string {
  return ['---', 'page_id: wiki.page.1', 'space_id: space-1', 'title: Test Page', 'status: draft', '---', '', content].join('\n');
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
    current_version_id: 'version-2',
    indexed_version_id: null,
    sync_status: 'synced',
    docmost_page_id: 'docmost-page-1',
    created_by: 'graphify',
    created_at: new Date('2026-05-05T10:00:00.000Z'),
    updated_at: new Date('2026-05-05T10:00:00.000Z'),
    ...overrides,
  };
}

function createVersion(overrides: Partial<WikiPageVersionRow> = {}): WikiPageVersionRow {
  return {
    id: 'version-2',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    wiki_page_pk: 'wiki-pk-1',
    page_id: 'wiki.page.1',
    version_no: 2,
    content_markdown: frontmatter('## Overview\nNew content'),
    frontmatter_json: {
      page_id: 'wiki.page.1',
      space_id: 'space-1',
      title: 'Test Page',
      status: 'draft',
    },
    source: 'graphify',
    graphify_run_id: 'run-1',
    commit_hash: 'commit-2',
    status: 'draft',
    created_by: 'graphify',
    created_at: new Date('2026-05-05T11:00:00.000Z'),
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
  const { content: _content, block_id: blockId, owner, ...rest } = overrides;

  return {
    id: `metadata-${blockId}`,
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    wiki_page_pk: 'wiki-pk-1',
    page_version_id: 'version-2',
    block_id: blockId,
    owner,
    content_hash: normalizeBlockHash(_content),
    graphify_run_id: 'run-1',
    last_editor: null,
    editable: owner === 'human',
    created_at: new Date('2026-05-05T11:00:00.000Z'),
    updated_at: new Date('2026-05-05T11:00:00.000Z'),
    ...rest,
  };
}

function readBlockId(value: unknown): string | undefined {
  return value !== null && typeof value === 'object' && 'blockId' in value
    ? String((value as { blockId: unknown }).blockId)
    : undefined;
}
