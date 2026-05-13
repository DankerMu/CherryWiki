import type { Job } from 'bullmq';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  bridgeEvents,
  pageBlockMetadata,
  spaces,
  wikiPageVersions,
  wikiPages,
} from '@cherrygraph/shared';
import {
  extractH2Blocks,
  extractMarkedBlocks,
  generateFrontmatter,
  matchBlocksFallback,
  mergeBlocks,
  normalizeBlockContent,
  parseBlockMarkers,
  parseFrontmatter,
  type BlockMatchResult,
  type BlockMergeMetadataInfo,
  type WikiFrontmatter,
} from '@cherrygraph/wiki-core';

export type DrizzleDatabase = NodePgDatabase;
type DatabaseClient = Pick<DrizzleDatabase, 'select' | 'insert' | 'update'>;

export interface BridgeClient {
  exportPage(pageId: string): Promise<{
    markdown: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
  }>;
}

export interface PageSyncDeps {
  db: DrizzleDatabase;
  bridgeClient: BridgeClient;
  wikiRepoPath: string;
  reindexQueue?: { add: (name: string, data: Record<string, unknown>) => Promise<{ id?: string }> };
  permissionChecker?: (args: {
    userId?: string;
    spaceId: string;
    pageId: string;
  }) => Promise<boolean> | boolean;
}

export type PageSyncJobData = {
  bridgeEventId: string;
  eventId?: string;
  eventType: string;
  spaceId?: string;
  pageId?: string;
};

type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;
type PageBlockMetadataRow = typeof pageBlockMetadata.$inferSelect;
type BridgeEventRow = typeof bridgeEvents.$inferSelect;

type PageContext = {
  page: WikiPageRow;
  spaceSlug: string;
};

type WritebackUser = {
  userId?: string;
  userName?: string;
  userEmail?: string;
  editId: string;
};

type FrontmatterRepairResult = {
  frontmatter: WikiFrontmatter;
  content: string;
  repaired: boolean;
};

type MarkedBlockRange = {
  blockId: string;
  start: number;
  end: number;
  content: string;
};

type PositionedBlockMatchResult = BlockMatchResult & {
  start: number;
};

export function createPageSyncProcessor(deps: PageSyncDeps): (job: Job<PageSyncJobData>) => Promise<void> {
  return async (job) => {
    const data = job.data;

    try {
      const bridgeEventStatus = await loadBridgeEventStatus(deps.db, data.bridgeEventId);
      if (bridgeEventStatus === 'processed' || bridgeEventStatus === 'failed') {
        return;
      }

      if (await coalesceStalePageEvents(deps.db, data)) {
        return;
      }

      await markBridgeEventProcessing(deps.db, data.bridgeEventId);

      if (data.eventType === 'page.deleted') {
        await processPageDeleted(deps, data);
        return;
      }

      if (data.eventType === 'page.saved') {
        await processPageSaved(deps, data);
        return;
      }

      await markBridgeEventProcessed(deps.db, data.bridgeEventId);
    } catch (error) {
      await markBridgeEventFailed(deps.db, data.bridgeEventId, errorToJson(error));
      await markPageSyncPending(deps.db, data.pageId);
      throw error;
    }
  };
}

export function createHttpBridgeClient(baseUrl: string, token?: string): BridgeClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  return {
    async exportPage(pageId: string) {
      const requestInit = token !== undefined ? { headers: { Authorization: `Bearer ${token}` } } : {};
      const response = await fetch(
        `${normalizedBaseUrl}/api/internal/bridge/pages/${encodeURIComponent(pageId)}/export?format=markdown`,
        requestInit,
      );

      if (!response.ok) {
        throw new Error(`Bridge export failed for page ${pageId}: HTTP ${response.status}`);
      }

      const payload = readRecord(await response.json());
      const markdown = readString(payload.markdown) ?? readString(payload.content);
      if (markdown === undefined) {
        throw new Error(`Bridge export response for page ${pageId} did not include markdown content`);
      }

      const userId = readString(payload.userId) ?? readString(payload.user_id) ?? readString(payload.updated_by);
      const userName = readString(payload.userName) ?? readString(payload.user_name) ?? readString(payload.updated_by_name);
      const userEmail = readString(payload.userEmail) ?? readString(payload.user_email) ?? readString(payload.updated_by_email);
      const result: Awaited<ReturnType<BridgeClient['exportPage']>> = { markdown };

      if (userId !== undefined) {
        result.userId = userId;
      }
      if (userName !== undefined) {
        result.userName = userName;
      }
      if (userEmail !== undefined) {
        result.userEmail = userEmail;
      }

      return result;
    },
  };
}

export async function commitToWikiRepo(
  deps: Pick<PageSyncDeps, 'wikiRepoPath'>,
  page: PageContext,
  content: string,
  user: WritebackUser,
): Promise<{ commitHash: string; repoPath: string; branch: string; message: string }> {
  const relativePath = `${page.spaceSlug}/${page.page.slug}.md`;
  const fullPath = join(deps.wikiRepoPath, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
  const commitHash = createHash('sha256').update(content, 'utf8').digest('hex');
  const message = `[${page.spaceSlug}][human][${user.editId}] update ${page.page.slug}`;

  return { commitHash, repoPath: relativePath, branch: 'main', message };
}

async function processPageSaved(deps: PageSyncDeps, data: PageSyncJobData): Promise<void> {
  const docmostPageId = requirePageId(data);
  const page = await findPageByDocmostPageId(deps.db, docmostPageId);
  if (page === undefined) {
    console.warn('page-sync: docmost_page_id not found; skipping event', {
      docmostPageId,
      bridgeEventId: data.bridgeEventId,
    });
    await markBridgeEventProcessed(deps.db, data.bridgeEventId);
    return;
  }

  const exported = await deps.bridgeClient.exportPage(docmostPageId);
  const user: WritebackUser = {
    ...(exported.userId !== undefined ? { userId: exported.userId } : {}),
    ...(exported.userName !== undefined ? { userName: exported.userName } : {}),
    ...(exported.userEmail !== undefined ? { userEmail: exported.userEmail } : {}),
    editId: data.eventId ?? data.bridgeEventId,
  };

  const permissionAllowed = await checkSpaceEditPermission(deps, {
    ...(user.userId !== undefined ? { userId: user.userId } : {}),
    spaceId: page.page.space_id,
    pageId: page.page.page_id,
  });
  if (!permissionAllowed) {
    await markBridgeEventFailed(deps.db, data.bridgeEventId, { code: 'PERMISSION_DENIED' });
    await markPageSyncPendingByPagePk(deps.db, page.page.id);
    return;
  }

  const currentVersion = await loadCurrentVersion(deps.db, page.page);
  const rawSidecar = currentVersion === undefined ? [] : await loadPageBlockMetadata(deps.db, currentVersion.id);
  const sidecar = enrichSidecarWithNormalizedContent(rawSidecar, currentVersion);
  const repaired = repairFrontmatter(exported.markdown, page.page, currentVersion);
  if (repaired.repaired) {
    console.warn('page-sync: repaired missing frontmatter fields', {
      pageId: page.page.page_id,
      docmostPageId,
    });
  }

  const matchedBlocks = matchExportedBlocks(repaired.content, sidecar);
  const mergeResult = mergeBlocks(matchedBlocks, user.userId, currentVersion?.graphify_run_id ?? undefined);
  const contentMarkdown = generateFrontmatter(repaired.frontmatter, mergeResult.mergedMarkdown);
  const versionId = randomUUID();
  const versionNo = (currentVersion?.version_no ?? 0) + 1;
  const commit = await commitToWikiRepo(deps, page, contentMarkdown, user);

  await deps.db.transaction(async (tx) => {
    await tx.insert(wikiPageVersions).values({
      id: versionId,
      tenant_id: page.page.tenant_id,
      space_id: page.page.space_id,
      wiki_page_pk: page.page.id,
      page_id: page.page.page_id,
      version_no: versionNo,
      content_markdown: contentMarkdown,
      frontmatter_json: repaired.frontmatter as unknown as Record<string, unknown>,
      source: 'docmost',
      graphify_run_id: currentVersion?.graphify_run_id ?? null,
      commit_hash: commit.commitHash,
      status: page.page.status,
      created_by: user.userId ?? null,
    });

    await writePageBlockMetadata(tx, page.page, versionId, mergeResult.newMetadata);
    await tx
      .update(wikiPages)
      .set({
        current_version_id: versionId,
        sync_status: 'synced',
        updated_at: new Date(),
      })
      .where(eq(wikiPages.id, page.page.id));
    await markBridgeEventProcessed(tx, data.bridgeEventId);
  });

  if (deps.reindexQueue !== undefined) {
    try {
      const reindexJob = await deps.reindexQueue.add('reindex-page', {
        tenant_id: page.page.tenant_id,
        space_id: page.page.space_id,
        trigger: 'page_sync',
        scope: 'single_page',
        page_id: page.page.page_id,
      });
      console.log('reindex enqueued', { pageId: page.page.page_id, jobId: reindexJob.id });
    } catch (reindexError) {
      await deps.db
        .update(wikiPages)
        .set({ sync_status: 'sync_pending', updated_at: new Date() })
        .where(eq(wikiPages.id, page.page.id));
      console.error('reindex enqueue failed; page marked sync_pending', {
        pageId: page.page.page_id,
        error: reindexError,
      });
    }
  }
}

async function processPageDeleted(deps: PageSyncDeps, data: PageSyncJobData): Promise<void> {
  const docmostPageId = requirePageId(data);
  const page = await findPageByDocmostPageId(deps.db, docmostPageId);
  if (page === undefined) {
    console.warn('page-sync: docmost_page_id not found for delete; skipping event', {
      docmostPageId,
      bridgeEventId: data.bridgeEventId,
    });
    await markBridgeEventProcessed(deps.db, data.bridgeEventId);
    return;
  }

  await deps.db
    .update(wikiPages)
    .set({ status: 'archived', updated_at: new Date() })
    .where(eq(wikiPages.id, page.page.id));
  if (deps.reindexQueue !== undefined) {
    try {
      await deps.reindexQueue.add('invalidate-page', {
        tenant_id: page.page.tenant_id,
        space_id: page.page.space_id,
        trigger: 'page_deleted',
        scope: 'single_page',
        page_id: page.page.page_id,
      });
    } catch (reindexError) {
      console.error('reindex invalidation enqueue failed', {
        pageId: page.page.page_id,
        error: reindexError,
      });
    }
  }
  await markBridgeEventProcessed(deps.db, data.bridgeEventId);
}

function matchExportedBlocks(markdown: string, sidecar: BlockMergeMetadataInfo[]): BlockMatchResult[] {
  const markers = parseBlockMarkers(markdown);
  if (markers.length === 0 || markers.length < sidecar.length) {
    return matchBlocksFallback(markdown, sidecar);
  }

  const contentByBlockId = extractMarkedBlocks(markdown);
  const markedRanges = extractMarkedBlockRanges(markdown);
  const metadataByBlockId = new Map(sidecar.map((metadata) => [metadata.blockId, metadata]));
  const results: PositionedBlockMatchResult[] = [];
  const usedBlockIds = new Set<string>();

  for (const markedRange of markedRanges) {
    const content = contentByBlockId.get(markedRange.blockId) ?? markedRange.content.trim();

    const matchedMetadata = metadataByBlockId.get(markedRange.blockId);
    usedBlockIds.add(markedRange.blockId);
    if (matchedMetadata === undefined) {
      results.push({
        blockId: markedRange.blockId,
        content,
        matchType: 'new',
        start: markedRange.start,
      });
      continue;
    }

    results.push({
      blockId: markedRange.blockId,
      content,
      matchedMetadata,
      matchType: 'marker',
      start: markedRange.start,
    });
  }

  for (const block of extractUnmarkedH2Blocks(markdown, markedRanges)) {
    const blockId = reserveBlockId(block.blockId, usedBlockIds);
    results.push({
      blockId,
      content: block.content,
      matchType: 'new',
      start: block.start,
    });
  }

  return results
    .sort((left, right) => left.start - right.start)
    .map(({ start: _start, ...result }) => result);
}

function extractMarkedBlockRanges(markdown: string): MarkedBlockRange[] {
  const ranges: MarkedBlockRange[] = [];
  const pattern =
    /<!--\s*(?:(?:graphify):(?:managed|human)|(?:human):curated):start\s+id="([^"]+)"(?:\s+run="[^"]*")?\s*-->([\s\S]*?)<!--\s*(?:(?:graphify):(?:managed|human)|(?:human):curated):end\s*-->/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    const blockId = match[1];
    const content = match[2];
    if (blockId === undefined || content === undefined) {
      continue;
    }

    ranges.push({
      blockId,
      start: match.index,
      end: match.index + match[0].length,
      content,
    });
  }

  return ranges;
}

function extractUnmarkedH2Blocks(
  markdown: string,
  markedRanges: MarkedBlockRange[],
): Array<{ blockId: string; start: number; end: number; content: string }> {
  const sortedRanges = [...markedRanges].sort((left, right) => left.start - right.start);
  const blocks: Array<{ blockId: string; start: number; end: number; content: string }> = [];

  for (const block of extractH2Blocks(markdown)) {
    if (isOffsetInRanges(block.start, sortedRanges)) {
      continue;
    }

    const contentRanges = subtractMarkedRanges({ start: block.start, end: block.end }, sortedRanges);
    const content = contentRanges.map((range) => markdown.slice(range.start, range.end)).join('').trimEnd();
    if (content.length === 0) {
      continue;
    }

    blocks.push({
      blockId: block.blockId,
      start: block.start,
      end: contentRanges.at(-1)?.end ?? block.end,
      content,
    });
  }

  return blocks;
}

function isOffsetInRanges(offset: number, ranges: MarkedBlockRange[]): boolean {
  return ranges.some((range) => range.start <= offset && offset < range.end);
}

function subtractMarkedRanges(
  range: { start: number; end: number },
  markedRanges: MarkedBlockRange[],
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = range.start;

  for (const markedRange of markedRanges) {
    if (markedRange.end <= cursor) {
      continue;
    }
    if (markedRange.start >= range.end) {
      break;
    }

    if (markedRange.start > cursor) {
      ranges.push({ start: cursor, end: Math.min(markedRange.start, range.end) });
    }
    cursor = Math.max(cursor, markedRange.end);
    if (cursor >= range.end) {
      break;
    }
  }

  if (cursor < range.end) {
    ranges.push({ start: cursor, end: range.end });
  }

  return ranges;
}

function reserveBlockId(blockId: string, usedBlockIds: Set<string>): string {
  if (!usedBlockIds.has(blockId)) {
    usedBlockIds.add(blockId);
    return blockId;
  }

  let suffix = 2;
  let candidate = `${blockId}-${suffix}`;
  while (usedBlockIds.has(candidate)) {
    suffix += 1;
    candidate = `${blockId}-${suffix}`;
  }
  usedBlockIds.add(candidate);
  return candidate;
}

function repairFrontmatter(
  markdown: string,
  page: WikiPageRow,
  currentVersion: WikiPageVersionRow | undefined,
): FrontmatterRepairResult {
  const parsed = parseFrontmatter(markdown);
  const exportedFrontmatter = readRecord(parsed.frontmatter);
  const existingFrontmatter = readRecord(currentVersion?.frontmatter_json);
  const frontmatter: Record<string, unknown> = {
    ...existingFrontmatter,
    ...exportedFrontmatter,
  };
  let repaired = false;

  if (readString(exportedFrontmatter.page_id) === undefined) {
    frontmatter.page_id = readString(existingFrontmatter.page_id) ?? page.page_id;
    repaired = true;
  }
  if (readString(exportedFrontmatter.space_id) === undefined) {
    frontmatter.space_id = readString(existingFrontmatter.space_id) ?? page.space_id;
    repaired = true;
  }
  if (readString(frontmatter.title) === undefined) {
    frontmatter.title = page.title;
    repaired = true;
  }
  if (readString(frontmatter.status) === undefined) {
    frontmatter.status = page.status;
    repaired = true;
  }
  if (readString(frontmatter.source) === undefined) {
    frontmatter.source = 'docmost';
    repaired = true;
  }
  frontmatter.version = (currentVersion?.version_no ?? 0) + 1;

  return {
    frontmatter: frontmatter as unknown as WikiFrontmatter,
    content: parsed.content,
    repaired,
  };
}

async function loadBridgeEventStatus(
  db: DatabaseClient,
  bridgeEventId: string,
): Promise<BridgeEventRow['status'] | undefined> {
  const [event] = await db
    .select({ status: bridgeEvents.status })
    .from(bridgeEvents)
    .where(eq(bridgeEvents.id, bridgeEventId))
    .limit(1);

  return event?.status;
}

async function coalesceStalePageEvents(db: DatabaseClient, data: PageSyncJobData): Promise<boolean> {
  if (data.pageId === undefined) {
    return false;
  }

  const receivedEvents = await db
    .select()
    .from(bridgeEvents)
    .where(and(eq(bridgeEvents.page_id, data.pageId), eq(bridgeEvents.status, 'received')))
    .orderBy(desc(bridgeEvents.received_at), desc(bridgeEvents.id))
    .limit(50);

  if (receivedEvents.length <= 1) {
    return false;
  }

  const [latest, ...olderEvents] = receivedEvents;
  if (latest === undefined) {
    return false;
  }

  const olderIds = olderEvents.map((event) => event.id);
  await db
    .update(bridgeEvents)
    .set({
      status: 'processed',
      processed_at: new Date(),
      error_json: { code: 'COALESCED', latestBridgeEventId: latest.id },
    })
    .where(inArray(bridgeEvents.id, olderIds));

  return olderIds.includes(data.bridgeEventId);
}

async function findPageByDocmostPageId(
  db: DatabaseClient,
  docmostPageId: string,
): Promise<PageContext | undefined> {
  const [row] = await db
    .select({ page: wikiPages, spaceSlug: spaces.slug })
    .from(wikiPages)
    .leftJoin(spaces, eq(wikiPages.space_id, spaces.id))
    .where(eq(wikiPages.docmost_page_id, docmostPageId))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  return {
    page: row.page,
    spaceSlug: row.spaceSlug ?? row.page.space_id,
  };
}

async function loadCurrentVersion(
  db: DatabaseClient,
  page: WikiPageRow,
): Promise<WikiPageVersionRow | undefined> {
  if (page.current_version_id !== null) {
    const [version] = await db
      .select()
      .from(wikiPageVersions)
      .where(eq(wikiPageVersions.id, page.current_version_id))
      .limit(1);
    return version;
  }

  const [version] = await db
    .select()
    .from(wikiPageVersions)
    .where(eq(wikiPageVersions.wiki_page_pk, page.id))
    .orderBy(desc(wikiPageVersions.version_no))
    .limit(1);
  return version;
}

async function loadPageBlockMetadata(
  db: DatabaseClient,
  pageVersionId: string,
): Promise<BlockMergeMetadataInfo[]> {
  const rows = await db
    .select()
    .from(pageBlockMetadata)
    .where(eq(pageBlockMetadata.page_version_id, pageVersionId));

  return rows.map(toBlockMetadataInfo);
}

function enrichSidecarWithNormalizedContent(
  sidecar: BlockMergeMetadataInfo[],
  currentVersion: WikiPageVersionRow | undefined,
): BlockMergeMetadataInfo[] {
  if (currentVersion === undefined || sidecar.length === 0) {
    return sidecar;
  }

  const body = parseFrontmatter(currentVersion.content_markdown).content;
  const contentByBlockId = extractExistingBlockContent(body);

  return sidecar.map((metadata) => {
    const content = contentByBlockId.get(metadata.blockId);
    if (content === undefined) {
      return metadata;
    }

    return {
      ...metadata,
      normalizedContent: normalizeBlockContent(content),
    };
  });
}

function extractExistingBlockContent(markdown: string): Map<string, string> {
  const contentByBlockId = new Map(extractMarkedBlocks(markdown));
  for (const block of extractH2Blocks(markdown)) {
    if (!contentByBlockId.has(block.blockId)) {
      contentByBlockId.set(block.blockId, block.content);
    }
  }

  return contentByBlockId;
}

async function writePageBlockMetadata(
  db: DatabaseClient,
  page: WikiPageRow,
  versionId: string,
  metadata: BlockMergeMetadataInfo[],
): Promise<void> {
  if (metadata.length === 0) {
    return;
  }

  await db.insert(pageBlockMetadata).values(
    metadata.map((block) => ({
      id: randomUUID(),
      tenant_id: page.tenant_id,
      space_id: page.space_id,
      wiki_page_pk: page.id,
      page_version_id: versionId,
      block_id: block.blockId,
      owner: block.owner,
      content_hash: block.contentHash,
      graphify_run_id: block.graphifyRunId ?? null,
      last_editor: block.lastEditor ?? null,
      editable: block.editable,
    })),
  );
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

async function checkSpaceEditPermission(
  deps: PageSyncDeps,
  args: { userId?: string; spaceId: string; pageId: string },
): Promise<boolean> {
  return deps.permissionChecker?.(args) ?? true;
}

async function markBridgeEventProcessing(db: DatabaseClient, bridgeEventId: string): Promise<void> {
  await db.update(bridgeEvents).set({ status: 'processing' }).where(eq(bridgeEvents.id, bridgeEventId));
}

async function markBridgeEventProcessed(db: DatabaseClient, bridgeEventId: string): Promise<void> {
  await db
    .update(bridgeEvents)
    .set({ status: 'processed', processed_at: new Date() })
    .where(eq(bridgeEvents.id, bridgeEventId));
}

async function markBridgeEventFailed(
  db: DatabaseClient,
  bridgeEventId: string,
  errorJson: Record<string, unknown>,
): Promise<void> {
  await db
    .update(bridgeEvents)
    .set({ status: 'failed', error_json: errorJson, processed_at: new Date() })
    .where(eq(bridgeEvents.id, bridgeEventId));
}

async function markPageSyncPending(db: DatabaseClient, docmostPageId: string | undefined): Promise<void> {
  if (docmostPageId === undefined) {
    return;
  }

  await db
    .update(wikiPages)
    .set({ sync_status: 'sync_pending', updated_at: new Date() })
    .where(eq(wikiPages.docmost_page_id, docmostPageId));
}

async function markPageSyncPendingByPagePk(db: DatabaseClient, pagePk: string): Promise<void> {
  await db
    .update(wikiPages)
    .set({ sync_status: 'sync_pending', updated_at: new Date() })
    .where(eq(wikiPages.id, pagePk));
}

function requirePageId(data: PageSyncJobData): string {
  if (data.pageId === undefined || data.pageId.length === 0) {
    throw new Error(`page-sync job ${data.bridgeEventId} is missing pageId`);
  }

  return data.pageId;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function errorToJson(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      code: error.name || 'ERROR',
      message: error.message,
    };
  }

  return {
    code: 'ERROR',
    message: String(error),
  };
}
