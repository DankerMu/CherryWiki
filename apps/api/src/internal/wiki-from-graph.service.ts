import { Inject, Injectable } from '@nestjs/common';
import {
  graphCommunities,
  graphEdges,
  graphNodes,
  wikiPages,
  wikiPageVersions,
} from '@cherrygraph/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import { getApiLogger } from '../common/logger/logger.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type WikiDatabase = NodePgDatabase;
type TransactionalDatabase = WikiDatabase & {
  transaction?: <T>(callback: (tx: WikiDatabase) => Promise<T>) => Promise<T>;
};

type CommunityRow = {
  id: string;
  community_key: string;
  label: string | null;
  summary: string | null;
};

type MemberNodeRow = {
  id: string;
  label: string;
  type: string | null;
  source_refs_json: unknown;
};

type EdgeRow = {
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  confidence_label: string;
};

// Deterministically turns graphify community output into published wiki pages so the indexer can
// surface generated content. Idempotent per (tenant, space, community_key): a re-run appends a new
// published version and repoints current_version_id instead of duplicating the page.
@Injectable()
export class WikiFromGraphService {
  constructor(@Inject(DRIZZLE) private readonly db: WikiDatabase) {}

  // Returns the number of communities whose pages were created/updated.
  async generateForRun(
    tenantId: string,
    spaceId: string,
    runId: string,
    createdBy: string | null,
    db: WikiDatabase = this.db,
  ): Promise<number> {
    const communities = (await db
      .select({
        id: graphCommunities.id,
        community_key: graphCommunities.community_key,
        label: graphCommunities.label,
        summary: graphCommunities.summary,
      })
      .from(graphCommunities)
      .where(
        and(
          eq(graphCommunities.tenant_id, tenantId),
          eq(graphCommunities.space_id, spaceId),
          eq(graphCommunities.graphify_run_id, runId),
        ),
      )) as CommunityRow[];

    let generated = 0;
    for (const community of communities) {
      try {
        await this.generateCommunityPage(tenantId, spaceId, runId, createdBy, community, db);
        generated += 1;
      } catch (err) {
        getApiLogger().error(
          { err, run_id: runId, community_key: community.community_key },
          'Failed to generate wiki page from graph community — skipping',
        );
      }
    }

    return generated;
  }

  private async generateCommunityPage(
    tenantId: string,
    spaceId: string,
    runId: string,
    createdBy: string | null,
    community: CommunityRow,
    db: WikiDatabase,
  ): Promise<void> {
    const members = (await db
      .select({
        id: graphNodes.id,
        label: graphNodes.label,
        type: graphNodes.type,
        source_refs_json: graphNodes.source_refs_json,
      })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.tenant_id, tenantId),
          eq(graphNodes.space_id, spaceId),
          eq(graphNodes.community_id, community.id),
        ),
      )) as MemberNodeRow[];

    const sortedMembers = [...members].sort((left, right) => left.label.localeCompare(right.label));
    const memberIds = new Set(sortedMembers.map((member) => member.id));
    const labelById = new Map(sortedMembers.map((member) => [member.id, member.label]));

    const edges = (await db
      .select({
        source_node_id: graphEdges.source_node_id,
        target_node_id: graphEdges.target_node_id,
        relation_type: graphEdges.relation_type,
        confidence_label: graphEdges.confidence_label,
      })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.tenant_id, tenantId),
          eq(graphEdges.space_id, spaceId),
          eq(graphEdges.graphify_run_id, runId),
        ),
      )) as EdgeRow[];

    const memberEdges = edges
      .filter((edge) => memberIds.has(edge.source_node_id) && memberIds.has(edge.target_node_id))
      .sort((left, right) => {
        const sourceCompare = (labelById.get(left.source_node_id) ?? '').localeCompare(
          labelById.get(right.source_node_id) ?? '',
        );
        if (sourceCompare !== 0) {
          return sourceCompare;
        }
        return (labelById.get(left.target_node_id) ?? '').localeCompare(labelById.get(right.target_node_id) ?? '');
      });

    const title = community.label ?? `Community ${community.community_key}`;
    const pageId = `graph-community-${community.community_key}`;
    const content = buildContentMarkdown(title, community.summary, sortedMembers, memberEdges, labelById);

    await this.withTransaction(db, async (tx) => {
      const wikiPagePk = await this.upsertPage(tx, tenantId, spaceId, pageId, title, content, runId, createdBy);

      if (memberIds.size > 0) {
        await tx
          .update(graphNodes)
          .set({ wiki_page_pk: wikiPagePk })
          .where(
            and(
              eq(graphNodes.tenant_id, tenantId),
              eq(graphNodes.space_id, spaceId),
              eq(graphNodes.community_id, community.id),
              inArray(graphNodes.id, [...memberIds]),
            ),
          );
      }
    });
  }

  // Inserts a new wiki_pages row + published version, or appends a new published version to an
  // existing page and repoints current_version_id. Returns the wiki_pages PK.
  private async upsertPage(
    db: WikiDatabase,
    tenantId: string,
    spaceId: string,
    pageId: string,
    title: string,
    content: string,
    runId: string,
    createdBy: string | null,
  ): Promise<string> {
    const now = new Date();
    const [existing] = await db
      .select({ id: wikiPages.id })
      .from(wikiPages)
      .where(
        and(
          eq(wikiPages.tenant_id, tenantId),
          eq(wikiPages.space_id, spaceId),
          eq(wikiPages.page_id, pageId),
        ),
      );

    let wikiPagePk: string;
    if (existing === undefined) {
      wikiPagePk = randomUUID();
      await db.insert(wikiPages).values({
        id: wikiPagePk,
        tenant_id: tenantId,
        space_id: spaceId,
        page_id: pageId,
        title,
        slug: pageId,
        status: 'published',
        created_by: createdBy,
        created_at: now,
        updated_at: now,
      });
    } else {
      wikiPagePk = existing.id;
    }

    const versionRows = (await db
      .select({ version_no: wikiPageVersions.version_no })
      .from(wikiPageVersions)
      .where(
        and(
          eq(wikiPageVersions.tenant_id, tenantId),
          eq(wikiPageVersions.space_id, spaceId),
          eq(wikiPageVersions.wiki_page_pk, wikiPagePk),
        ),
      )) as Array<{ version_no: number }>;
    const nextVersionNo = versionRows.reduce((max, row) => Math.max(max, row.version_no), 0) + 1;

    const versionId = randomUUID();
    await db.insert(wikiPageVersions).values({
      id: versionId,
      tenant_id: tenantId,
      space_id: spaceId,
      wiki_page_pk: wikiPagePk,
      page_id: pageId,
      version_no: nextVersionNo,
      content_markdown: content,
      source: 'graphify',
      graphify_run_id: runId,
      status: 'published',
      created_by: createdBy,
      created_at: now,
    });

    await db
      .update(wikiPages)
      .set({
        title,
        current_version_id: versionId,
        status: 'published',
        updated_at: now,
      })
      .where(eq(wikiPages.id, wikiPagePk));

    return wikiPagePk;
  }

  private async withTransaction<T>(db: WikiDatabase, callback: (tx: WikiDatabase) => Promise<T>): Promise<T> {
    const transactional = db as TransactionalDatabase;
    if (typeof transactional.transaction === 'function') {
      return transactional.transaction(callback);
    }
    return callback(db);
  }
}

function buildContentMarkdown(
  title: string,
  summary: string | null,
  members: MemberNodeRow[],
  edges: EdgeRow[],
  labelById: Map<string, string>,
): string {
  const lines: string[] = [`# ${escapeInline(title)}`];

  if (summary !== null && summary.trim().length > 0) {
    lines.push('', summary.trim());
  }

  lines.push('', '## Members');
  if (members.length === 0) {
    lines.push('', '_No members._');
  } else {
    for (const member of members) {
      const type = escapeInline(member.type ?? 'unknown');
      const sources = distinctSourceFiles(member.source_refs_json).map(escapeInline);
      const sourceText = sources.length > 0 ? sources.join(', ') : 'none';
      lines.push(`- **${escapeInline(member.label)}** (${type}) — sources: ${sourceText}`);
    }
  }

  lines.push('', '## Relationships');
  if (edges.length === 0) {
    lines.push('', '_No relationships._');
  } else {
    for (const edge of edges) {
      const sourceLabel = escapeInline(labelById.get(edge.source_node_id) ?? edge.source_node_id);
      const targetLabel = escapeInline(labelById.get(edge.target_node_id) ?? edge.target_node_id);
      lines.push(
        `- ${sourceLabel} —${escapeInline(edge.relation_type)}→ ${targetLabel} (${escapeInline(edge.confidence_label)})`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

// Neutralizes markdown control chars and collapses whitespace so untrusted graph labels cannot
// break list/heading structure. Generated content is rendered without rehype-raw, so this is for
// structural robustness, not XSS.
function escapeInline(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/([\\`*_[\]|])/g, '\\$1')
    .trim();
}

// source_refs_json is e.g. [{"file":"prompt-inject.md"}]; return distinct file names in stable order.
function distinctSourceFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const files = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const file = (entry as Record<string, unknown>).file;
      if (typeof file === 'string' && file.trim().length > 0) {
        files.add(file);
      }
    }
  }

  return [...files].sort((left, right) => left.localeCompare(right));
}
