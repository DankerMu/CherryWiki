import type { Job } from 'bullmq';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';

import {
  graphifyRuns,
  pageBlockMetadata,
  wikiPageVersions,
  wikiPages,
  wikiUpdateProposals,
} from '@cherrygraph/shared';
import {
  extractH2Blocks,
  extractMarkedBlocks,
  generateFrontmatter,
  matchBlocksFallback,
  mergeBlocks,
  normalizeBlockContent,
  normalizeBlockHash,
  parseFrontmatter,
  wrapGraphifyBlock,
  wrapHumanBlock,
  type BlockMergeMetadataInfo,
  type WikiFrontmatter,
} from '@cherrygraph/wiki-core';

export type DrizzleDatabase = NodePgDatabase;
type DatabaseClient = Pick<DrizzleDatabase, 'select' | 'insert' | 'update'>;

export interface DocmostPushDeps {
  db: DrizzleDatabase;
  bridgeClient: DocmostPushBridgeClient;
}

export interface DocmostPushBridgeClient {
  importPage(
    pageId: string,
    markdown: string,
    opts: { overwritePolicy: 'create_only' | 'update'; expectedHash?: string },
  ): Promise<{ docmostPageId: string; contentHash: string }>;
  exportPage(pageId: string): Promise<{ markdown: string }>;
}

export type DocmostPushJobData = {
  runId: string;
  spaceId: string;
  tenantId: string;
};

type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;
type PageBlockMetadataRow = typeof pageBlockMetadata.$inferSelect;

type PagePushInput = {
  page: WikiPageRow;
  version: WikiPageVersionRow;
  metadata: BlockMergeMetadataInfo[];
  previousVersion?: WikiPageVersionRow;
};

type ConflictProposal = {
  blockId: string;
  humanContent: string;
  graphifyContent: string;
};

type BuildPushMarkdownResult = {
  markdown: string;
  proposals: ConflictProposal[];
};

export function createDocmostPushProcessor(
  deps: DocmostPushDeps,
): (job: Job) => Promise<void> {
  return async (job) => {
    const data = readJobData(job.data);
    const pages = await loadGraphifyRunPages(deps.db, data);
    let failed = false;

    for (const pageInput of pages) {
      try {
        await pushPage(deps, data.runId, pageInput);
      } catch (error) {
        failed = true;
        await markPageSyncPending(deps.db, pageInput.page.id);
        console.error('docmost-push: page push failed', {
          runId: data.runId,
          pageId: pageInput.page.page_id,
          error,
        });
      }
    }

    await updateRunStatus(deps.db, data.runId, failed ? 'docmost_sync_failed' : 'docmost_synced');
  };
}

async function loadGraphifyRunPages(
  db: DatabaseClient,
  data: DocmostPushJobData,
): Promise<PagePushInput[]> {
  const versions = await db
    .select()
    .from(wikiPageVersions)
    .where(
      and(
        eq(wikiPageVersions.graphify_run_id, data.runId),
        eq(wikiPageVersions.space_id, data.spaceId),
        eq(wikiPageVersions.tenant_id, data.tenantId),
      ),
    )
    .orderBy(desc(wikiPageVersions.version_no));

  if (versions.length === 0) {
    return [];
  }

  const versionIds = versions.map((version) => version.id);
  const metadataRows = await db
    .select()
    .from(pageBlockMetadata)
    .where(inArray(pageBlockMetadata.page_version_id, versionIds));
  const pageIds = Array.from(new Set(versions.map((version) => version.wiki_page_pk)));
  const pages = await db
    .select()
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.tenant_id, data.tenantId),
        eq(wikiPages.space_id, data.spaceId),
        inArray(wikiPages.id, pageIds),
      ),
    );

  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const metadataByVersionId = groupMetadataByVersionId(metadataRows);
  const inputs: PagePushInput[] = [];

  for (const version of versions) {
    const page = pagesById.get(version.wiki_page_pk);
    if (page === undefined) {
      continue;
    }

    const previousVersion = await loadPreviousVersion(db, page.id, version.version_no);
    inputs.push({
      page,
      version,
      metadata: (metadataByVersionId.get(version.id) ?? []).map(toBlockMetadataInfo),
      ...(previousVersion !== undefined ? { previousVersion } : {}),
    });
  }

  return inputs;
}

async function pushPage(deps: DocmostPushDeps, runId: string, input: PagePushInput): Promise<void> {
  const firstBuild = buildPushMarkdown(input.version.content_markdown, input.metadata, {
    runId,
    humanContentByBlock: extractExistingBlockContent(input.previousVersion?.content_markdown),
  });
  let proposalCount = firstBuild.proposals.length;

  await persistConflictProposals(deps.db, input.page, runId, firstBuild.proposals);
  if (firstBuild.proposals.length > 0) {
    await markPageConflictRequired(deps.db, input.page.id);
  }

  if (
    input.page.docmost_page_id !== null &&
    input.previousVersion !== undefined &&
    contentSemanticHash(input.previousVersion.content_markdown) === contentSemanticHash(firstBuild.markdown)
  ) {
    return;
  }

  const targetPageId = input.page.docmost_page_id ?? input.page.page_id;
  const expectedHash = input.page.docmost_page_id === null
    ? undefined
    : contentHash(input.previousVersion?.content_markdown ?? input.version.content_markdown);

  try {
    await importPageAndWriteback(deps, input.page, targetPageId, firstBuild.markdown, expectedHash);
  } catch (error) {
    if (!isHttpStatus(error, 409)) {
      throw error;
    }

    if (input.page.docmost_page_id === null) {
      throw error;
    }

    proposalCount += await retryAfterOptimisticConflict(deps, runId, input, input.page.docmost_page_id);
  }

  if (proposalCount === 0) {
    await markPageSynced(deps.db, input.page.id);
  }
}

async function importPageAndWriteback(
  deps: DocmostPushDeps,
  page: WikiPageRow,
  targetPageId: string,
  markdown: string,
  expectedHash: string | undefined,
): Promise<void> {
  const overwritePolicy = page.docmost_page_id === null ? 'create_only' : 'update';
  const result = await deps.bridgeClient.importPage(
    targetPageId,
    markdown,
    expectedHash === undefined ? { overwritePolicy } : { overwritePolicy, expectedHash },
  );

  if (page.docmost_page_id === null) {
    await deps.db
      .update(wikiPages)
      .set({ docmost_page_id: result.docmostPageId, updated_at: new Date() })
      .where(eq(wikiPages.id, page.id));
    page.docmost_page_id = result.docmostPageId;
  }
}

async function retryAfterOptimisticConflict(
  deps: DocmostPushDeps,
  runId: string,
  input: PagePushInput,
  docmostPageId: string,
): Promise<number> {
  const exported = await deps.bridgeClient.exportPage(docmostPageId);
  const exportedBody = parseFrontmatter(exported.markdown).content;
  const merged = mergeBlocks(matchBlocksFallback(exportedBody, input.metadata), undefined, runId);
  const retryMetadata = merged.newMetadata.length > 0 ? merged.newMetadata : input.metadata;
  const retryBuild = buildPushMarkdown(input.version.content_markdown, retryMetadata, {
    runId,
    humanContentByBlock: extractExistingBlockContent(merged.mergedMarkdown),
  });

  await persistConflictProposals(deps.db, input.page, runId, retryBuild.proposals);
  if (retryBuild.proposals.length > 0) {
    await markPageConflictRequired(deps.db, input.page.id);
  }

  await deps.bridgeClient.importPage(docmostPageId, retryBuild.markdown, {
    overwritePolicy: 'update',
    expectedHash: contentHash(exported.markdown),
  });
  return retryBuild.proposals.length;
}

function buildPushMarkdown(
  contentMarkdown: string,
  metadata: BlockMergeMetadataInfo[],
  options: { runId: string; humanContentByBlock: Map<string, string> },
): BuildPushMarkdownResult {
  const parsed = parseFrontmatter(contentMarkdown);
  const body = parsed.content;
  const blocks = extractH2Blocks(body);
  if (blocks.length === 0) {
    return { markdown: contentMarkdown, proposals: [] };
  }

  const metadataByBlockId = new Map(metadata.map((block) => [block.blockId, block]));
  const incomingContentByBlock = extractExistingBlockContent(body);
  const proposals: ConflictProposal[] = [];
  let mergedBody = body.slice(0, blocks[0]?.start ?? 0);

  for (const block of blocks) {
    const blockId = block.blockId;
    const blockMetadata = metadataByBlockId.get(blockId);
    const graphifyContent = incomingContentByBlock.get(blockId) ?? block.content;

    if (blockMetadata?.owner === 'human') {
      const humanContent = options.humanContentByBlock.get(blockId) ?? graphifyContent;
      if (
        normalizeBlockContent(graphifyContent) !== normalizeBlockContent(humanContent) ||
        normalizeBlockHash(graphifyContent) !== blockMetadata.contentHash
      ) {
        proposals.push({ blockId, humanContent, graphifyContent });
      }
      mergedBody += wrapHumanBlock(humanContent, blockId, options.runId);
      continue;
    }

    mergedBody += wrapGraphifyBlock(graphifyContent, blockId, options.runId);
  }

  const frontmatter = readRecord(parsed.frontmatter);
  if (Object.keys(frontmatter).length === 0) {
    return { markdown: mergedBody.trimEnd(), proposals };
  }

  return {
    markdown: generateFrontmatter(frontmatter as unknown as WikiFrontmatter, mergedBody.trimEnd()),
    proposals,
  };
}

async function persistConflictProposals(
  db: DatabaseClient,
  page: WikiPageRow,
  runId: string,
  proposals: ConflictProposal[],
): Promise<void> {
  if (proposals.length === 0) {
    return;
  }

  await db.insert(wikiUpdateProposals).values(
    proposals.map((proposal) => ({
      id: randomUUID(),
      tenant_id: page.tenant_id,
      space_id: page.space_id,
      wiki_page_pk: page.id,
      graphify_run_id: runId,
      proposal_type: 'conflict',
      status: 'pending',
      diff_json: {
        blockId: proposal.blockId,
        humanContent: proposal.humanContent,
        graphifyContent: proposal.graphifyContent,
      },
    })),
  );
}

async function loadPreviousVersion(
  db: DatabaseClient,
  pagePk: string,
  versionNo: number,
): Promise<WikiPageVersionRow | undefined> {
  const [version] = await db
    .select()
    .from(wikiPageVersions)
    .where(and(eq(wikiPageVersions.wiki_page_pk, pagePk), lt(wikiPageVersions.version_no, versionNo)))
    .orderBy(desc(wikiPageVersions.version_no))
    .limit(1);

  return version;
}

function groupMetadataByVersionId(
  rows: PageBlockMetadataRow[],
): Map<string, PageBlockMetadataRow[]> {
  const grouped = new Map<string, PageBlockMetadataRow[]>();

  for (const row of rows) {
    const existing = grouped.get(row.page_version_id) ?? [];
    existing.push(row);
    grouped.set(row.page_version_id, existing);
  }

  return grouped;
}

function toBlockMetadataInfo(row: PageBlockMetadataRow): BlockMergeMetadataInfo {
  return {
    blockId: row.block_id,
    owner: row.owner === 'human' ? 'human' : 'graphify',
    contentHash: row.content_hash,
    ...(row.graphify_run_id !== null ? { graphifyRunId: row.graphify_run_id } : {}),
    ...(row.last_editor !== null ? { lastEditor: row.last_editor } : {}),
    editable: row.editable,
  };
}

function extractExistingBlockContent(contentMarkdown: string | undefined): Map<string, string> {
  if (contentMarkdown === undefined) {
    return new Map();
  }

  const body = parseFrontmatter(contentMarkdown).content;
  const contentByBlockId = new Map(extractMarkedBlocks(body));
  for (const block of extractH2Blocks(body)) {
    if (!contentByBlockId.has(block.blockId)) {
      contentByBlockId.set(block.blockId, block.content);
    }
  }

  return contentByBlockId;
}

async function markPageConflictRequired(db: DatabaseClient, pagePk: string): Promise<void> {
  await db
    .update(wikiPages)
    .set({ sync_status: 'conflict_required', updated_at: new Date() })
    .where(eq(wikiPages.id, pagePk));
}

async function markPageSynced(db: DatabaseClient, pagePk: string): Promise<void> {
  await db
    .update(wikiPages)
    .set({ sync_status: 'synced', updated_at: new Date() })
    .where(eq(wikiPages.id, pagePk));
}

async function markPageSyncPending(db: DatabaseClient, pagePk: string): Promise<void> {
  await db
    .update(wikiPages)
    .set({ sync_status: 'sync_pending', updated_at: new Date() })
    .where(eq(wikiPages.id, pagePk));
}

async function updateRunStatus(
  db: DatabaseClient,
  runId: string,
  status: 'docmost_synced' | 'docmost_sync_failed',
): Promise<void> {
  await db.update(graphifyRuns).set({ status }).where(eq(graphifyRuns.id, runId));
}

function contentHash(markdown: string): string {
  return `sha256:${createHash('sha256').update(markdown).digest('hex')}`;
}

function contentSemanticHash(markdown: string): string {
  return createHash('sha256')
    .update(normalizeBlockContent(parseFrontmatter(markdown).content))
    .digest('hex');
}

function isHttpStatus(error: unknown, status: number): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error.status === status || error.statusCode === status;
}

function readJobData(data: unknown): DocmostPushJobData {
  const record = readRecord(data);
  const runId = readString(record.runId);
  const spaceId = readString(record.spaceId);
  const tenantId = readString(record.tenantId);

  if (runId === undefined || spaceId === undefined || tenantId === undefined) {
    throw new Error('docmost-push job is missing runId, spaceId, or tenantId');
  }

  return { runId, spaceId, tenantId };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
