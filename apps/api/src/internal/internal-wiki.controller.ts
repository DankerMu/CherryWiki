import { Controller, Get, HttpException, HttpStatus, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '@cherrygraph/auth-core';
import { ErrorCode, wikiPages, wikiPageVersions, wikiSections } from '@cherrygraph/shared';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';

import { DRIZZLE } from '../database/drizzle.constants.js';
import type { DrizzleDatabase } from '../database/drizzle.module.js';
import { AgentTokenGuard } from './agent-token.guard.js';

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;

type QueryValue = string | string[] | number | undefined;

type InternalSearchQuery = {
  query?: QueryValue;
  q?: QueryValue;
  space_ids?: QueryValue;
  top_k?: QueryValue;
};

type InternalPageQuery = {
  space_id?: QueryValue;
  section?: QueryValue;
};

type InternalSearchRow = {
  page_id: string | null;
  space_id: string;
  title: string | null;
  section_id: string | null;
  section_title: string | null;
  content: string;
  score: string | number | null;
};

type SqlQueryResult<TRow> = {
  rows: TRow[];
};

type InternalSearchResult = {
  page_id: string;
  space_id: string;
  title: string;
  section_id: string | null;
  section_title: string | null;
  content: string;
  score: number;
};

type InternalSearchResponse = {
  results: InternalSearchResult[];
};

type WikiPageRow = {
  id: string;
  pageId: string;
  spaceId: string;
  title: string;
  currentVersionId: string | null;
};

type WikiPageVersionRow = {
  id: string;
  contentMarkdown: string;
};

type WikiSectionRow = {
  id: string;
  sectionId: string;
  heading: string;
  startOffset: number | null;
  endOffset: number | null;
};

type InternalPageSection = {
  id: string;
  section_id: string;
  title: string;
  content: string;
};

type InternalPageResponse = {
  page_id: string;
  space_id: string;
  title: string;
  content: string;
  sections: InternalPageSection[];
};

@Public()
@UseGuards(AgentTokenGuard)
@Controller('internal')
export class InternalWikiController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDatabase) {}

  @Get('search')
  async search(@Query() query: InternalSearchQuery): Promise<InternalSearchResponse> {
    const searchQuery = normalizeSearchQuery(query.query, query.q);
    const tsQuery = toSimpleTsQuery(searchQuery);
    if (tsQuery.length === 0) {
      throwValidationError('query must contain searchable terms');
    }

    const tenantId = getTenantId();
    const spaceIds = parseSpaceIds(query.space_ids);
    const topK = normalizePositiveInt(query.top_k, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const spaceFilter = spaceIds.length > 0 ? sql`AND wc.space_id = ANY(${toPgTextArray(spaceIds)})` : sql``;
    const result = await this.db.execute<InternalSearchRow>(sql`
      SELECT wp.page_id,
             wc.space_id,
             wp.title,
             ws.section_id,
             ws.heading AS section_title,
             wc.content,
             ts_rank_cd(to_tsvector('simple', wc.content), to_tsquery('simple', ${tsQuery})) AS score
      FROM wiki_chunks wc
      JOIN wiki_pages wp ON wp.id = wc.wiki_page_pk
      LEFT JOIN wiki_sections ws ON ws.id = wc.section_id
      WHERE wc.tenant_id = ${tenantId}
        AND wp.tenant_id = ${tenantId}
        AND wp.status = 'published'
        ${spaceFilter}
        AND to_tsvector('simple', wc.content) @@ to_tsquery('simple', ${tsQuery})
      ORDER BY score DESC
      LIMIT ${topK}
    `);

    return {
      results: normalizeSearchRows(result),
    };
  }

  @Get('pages/:page_id')
  async getPage(
    @Param('page_id') pageId: string,
    @Query() query: InternalPageQuery,
  ): Promise<InternalPageResponse> {
    const tenantId = getTenantId();
    const spaceId = getOptionalQueryString(query.space_id);
    const pages = await this.findPages(tenantId, pageId, spaceId);

    if (pages.length === 0) {
      throw new HttpException(
        {
          code: ErrorCode.WIKI_PAGE_NOT_FOUND,
          message: 'Wiki page not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (pages.length > 1 && spaceId === undefined) {
      throwValidationError('space_id required for disambiguation');
    }

    const page = pages[0];
    if (page === undefined || page.currentVersionId === null) {
      throw new HttpException(
        {
          code: ErrorCode.VERSION_NOT_FOUND,
          message: 'Current page version not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const version = await this.findCurrentVersion(tenantId, page);
    const sections = await this.findSections(tenantId, page, version.id);
    const responseSections = sections.map((section) => toPageSection(section, version.contentMarkdown));
    const sectionSelector = getOptionalQueryString(query.section);
    const selectedSection =
      sectionSelector === undefined ? undefined : findMatchingSection(responseSections, sectionSelector);

    return {
      page_id: page.pageId,
      space_id: page.spaceId,
      title: page.title,
      content: selectedSection?.content ?? version.contentMarkdown,
      sections: selectedSection === undefined ? responseSections : [selectedSection],
    };
  }

  private findPages(tenantId: string, pageId: string, spaceId: string | undefined): Promise<WikiPageRow[]> {
    const conditions: SQL[] = [
      eq(wikiPages.tenant_id, tenantId),
      eq(wikiPages.page_id, pageId),
      eq(wikiPages.status, 'published'),
    ];
    if (spaceId !== undefined) {
      conditions.push(eq(wikiPages.space_id, spaceId));
    }

    return this.db
      .select({
        id: wikiPages.id,
        pageId: wikiPages.page_id,
        spaceId: wikiPages.space_id,
        title: wikiPages.title,
        currentVersionId: wikiPages.current_version_id,
      })
      .from(wikiPages)
      .where(and(...conditions))
      .limit(2);
  }

  private async findCurrentVersion(tenantId: string, page: WikiPageRow): Promise<WikiPageVersionRow> {
    const versions = await this.db
      .select({
        id: wikiPageVersions.id,
        contentMarkdown: wikiPageVersions.content_markdown,
      })
      .from(wikiPageVersions)
      .where(
        and(
          eq(wikiPageVersions.id, page.currentVersionId ?? ''),
          eq(wikiPageVersions.tenant_id, tenantId),
          eq(wikiPageVersions.space_id, page.spaceId),
          eq(wikiPageVersions.wiki_page_pk, page.id),
        ),
      )
      .limit(1);
    const version = versions[0];

    if (version === undefined) {
      throw new HttpException(
        {
          code: ErrorCode.VERSION_NOT_FOUND,
          message: 'Current page version not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return version;
  }

  private findSections(tenantId: string, page: WikiPageRow, versionId: string): Promise<WikiSectionRow[]> {
    return this.db
      .select({
        id: wikiSections.id,
        sectionId: wikiSections.section_id,
        heading: wikiSections.heading,
        startOffset: wikiSections.start_offset,
        endOffset: wikiSections.end_offset,
      })
      .from(wikiSections)
      .where(
        and(
          eq(wikiSections.tenant_id, tenantId),
          eq(wikiSections.space_id, page.spaceId),
          eq(wikiSections.wiki_page_pk, page.id),
          eq(wikiSections.page_version_id, versionId),
        ),
      )
      .orderBy(asc(wikiSections.section_index));
  }
}

function normalizeSearchQuery(queryValue: QueryValue, qValue: QueryValue): string {
  const query = getOptionalQueryString(queryValue) ?? getOptionalQueryString(qValue);
  if (query === undefined) {
    throwValidationError('query is required');
  }

  return query;
}

function getOptionalQueryString(value: QueryValue): string | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (rawValue === undefined) {
    return undefined;
  }

  const normalized = String(rawValue).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseSpaceIds(value: QueryValue): string[] {
  const rawValue = getOptionalQueryString(value);
  if (rawValue === undefined) {
    return [];
  }

  return Array.from(
    new Set(
      rawValue
        .split(',')
        .map((spaceId) => spaceId.trim())
        .filter((spaceId) => spaceId.length > 0),
    ),
  );
}

function normalizePositiveInt(value: QueryValue, fallback: number, max: number): number {
  const rawValue = getOptionalQueryString(value);
  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeSearchRows(result: SqlQueryResult<InternalSearchRow>): InternalSearchResult[] {
  return result.rows.map((row) => ({
    page_id: row.page_id ?? '',
    space_id: row.space_id,
    title: row.title ?? 'Untitled',
    section_id: row.section_id,
    section_title: row.section_title,
    content: row.content,
    score: normalizeScore(row.score),
  }));
}

function normalizeScore(value: string | number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toPageSection(section: WikiSectionRow, contentMarkdown: string): InternalPageSection {
  return {
    id: section.id,
    section_id: section.sectionId,
    title: section.heading,
    content: sliceSectionContent(contentMarkdown, section.startOffset, section.endOffset),
  };
}

function sliceSectionContent(content: string, startOffset: number | null, endOffset: number | null): string {
  if (
    typeof startOffset !== 'number' ||
    typeof endOffset !== 'number' ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    startOffset >= content.length
  ) {
    return '';
  }

  return content.slice(startOffset, Math.min(endOffset, content.length));
}

function findMatchingSection(
  sections: InternalPageSection[],
  selector: string,
): InternalPageSection | undefined {
  const normalizedSelector = selector.toLowerCase();
  return sections.find(
    (section) =>
      section.id === selector ||
      section.section_id === selector ||
      section.title === selector ||
      section.id.toLowerCase() === normalizedSelector ||
      section.section_id.toLowerCase() === normalizedSelector ||
      section.title.toLowerCase() === normalizedSelector,
  );
}

function toSimpleTsQuery(query: string): string {
  return query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[':*!&|()]/g, ''))
    .filter((term) => term.length > 0)
    .join(' & ');
}

function toPgTextArray(values: string[]): SQL {
  if (values.length === 0) {
    return sql`ARRAY[]::text[]`;
  }

  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

function getTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  return tenantId !== undefined && tenantId.length > 0 ? tenantId : 'default';
}

function throwValidationError(message: string): never {
  throw new HttpException(
    {
      code: ErrorCode.VALIDATION_ERROR,
      message,
    },
    HttpStatus.BAD_REQUEST,
  );
}
