import type { Job } from 'bullmq';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import {
  bridgeEvents,
  pageBlockMetadata,
  spaces,
  wikiPageVersions,
  wikiPages,
} from '@cherrygraph/shared';
import {
  extractMarkedBlocks,
  generateFrontmatter,
  matchBlocksFallback,
  mergeBlocks,
  parseBlockMarkers,
  parseFrontmatter,
  type BlockMatchResult,
  type BlockMergeMetadataInfo,
  type WikiFrontmatter,
} from '@cherrygraph/wiki-core';

export type DrizzleDatabase = NodePgDatabase;

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

export function createPageSyncProcessor(deps: PageSyncDeps): (job: Job<PageSyncJobData>) => Promise<void> {
  return async (job) => {
    const data = job.data;

    try {
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
): Promise<{ commitHash: string | null; message: string }> {
  const message = `[${page.spaceSlug}][human][${user.editId}] update ${page.page.slug}`;
  console.log('wiki repo commit placeholder', {
    wikiRepoPath: deps.wikiRepoPath,
    pageId: page.page.page_id,
    userId: user.userId,
    contentBytes: Buffer.byteLength(content, 'utf8'),
    message,
  });

  return { commitHash: null, message };
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
  const sidecar = currentVersion === undefined ? [] : await loadPageBlockMetadata(deps.db, currentVersion.id);
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

  await deps.db.insert(wikiPageVersions).values({
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

  await writePageBlockMetadata(deps.db, page.page, versionId, mergeResult.newMetadata);
  await deps.db
    .update(wikiPages)
    .set({
      current_version_id: versionId,
      sync_status: 'synced',
      updated_at: new Date(),
    })
    .where(eq(wikiPages.id, page.page.id));

  console.log(`reindex triggered for page ${page.page.page_id}`);
  await markBridgeEventProcessed(deps.db, data.bridgeEventId);
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
  console.log(`reindex triggered for page ${page.page.page_id}`);
  await markBridgeEventProcessed(deps.db, data.bridgeEventId);
}

function matchExportedBlocks(markdown: string, sidecar: BlockMergeMetadataInfo[]): BlockMatchResult[] {
  const markers = parseBlockMarkers(markdown);
  if (markers.length === 0 || markers.length < sidecar.length) {
    return matchBlocksFallback(markdown, sidecar);
  }

  const contentByBlockId = extractMarkedBlocks(markdown);
  const metadataByBlockId = new Map(sidecar.map((metadata) => [metadata.blockId, metadata]));
  const results: BlockMatchResult[] = [];

  for (const marker of markers) {
    const content = contentByBlockId.get(marker.blockId);
    if (content === undefined) {
      continue;
    }

    const matchedMetadata = metadataByBlockId.get(marker.blockId);
    results.push(
      matchedMetadata === undefined
        ? {
            blockId: marker.blockId,
            content,
            matchType: 'new',
          }
        : {
            blockId: marker.blockId,
            content,
            matchedMetadata,
            matchType: 'marker',
          },
    );
  }

  return results;
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

async function coalesceStalePageEvents(db: DrizzleDatabase, data: PageSyncJobData): Promise<boolean> {
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
  db: DrizzleDatabase,
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
  db: DrizzleDatabase,
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
  db: DrizzleDatabase,
  pageVersionId: string,
): Promise<BlockMergeMetadataInfo[]> {
  const rows = await db
    .select()
    .from(pageBlockMetadata)
    .where(eq(pageBlockMetadata.page_version_id, pageVersionId));

  return rows.map(toBlockMetadataInfo);
}

async function writePageBlockMetadata(
  db: DrizzleDatabase,
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

async function markBridgeEventProcessing(db: DrizzleDatabase, bridgeEventId: string): Promise<void> {
  await db.update(bridgeEvents).set({ status: 'processing' }).where(eq(bridgeEvents.id, bridgeEventId));
}

async function markBridgeEventProcessed(db: DrizzleDatabase, bridgeEventId: string): Promise<void> {
  await db
    .update(bridgeEvents)
    .set({ status: 'processed', processed_at: new Date() })
    .where(eq(bridgeEvents.id, bridgeEventId));
}

async function markBridgeEventFailed(
  db: DrizzleDatabase,
  bridgeEventId: string,
  errorJson: Record<string, unknown>,
): Promise<void> {
  await db
    .update(bridgeEvents)
    .set({ status: 'failed', error_json: errorJson })
    .where(eq(bridgeEvents.id, bridgeEventId));
}

async function markPageSyncPending(db: DrizzleDatabase, docmostPageId: string | undefined): Promise<void> {
  if (docmostPageId === undefined) {
    return;
  }

  await db
    .update(wikiPages)
    .set({ sync_status: 'sync_pending', updated_at: new Date() })
    .where(eq(wikiPages.docmost_page_id, docmostPageId));
}

async function markPageSyncPendingByPagePk(db: DrizzleDatabase, pagePk: string): Promise<void> {
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
