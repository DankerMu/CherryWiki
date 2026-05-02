import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../frontmatter.js';
import {
  type BlockMetadataInfo,
  type ExistingPageInfo,
  importGraphifyWiki,
  type NormalizationParams,
  type WikiPageImport,
} from '../normalization/import-graphify-wiki.js';

const rootDir = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const fixtureDir = path.join(rootDir, 'tests/fixtures/test-graphify-output');
const wikiDir = path.join(fixtureDir, 'wiki');
const now = '2026-05-02T12:00:00.000Z';

describe('importGraphifyWiki', () => {
  it('imports fixture wiki files into canonical page manifests', () => {
    const result = importGraphifyWiki(baseParams());

    expect(result.pagesCreated).toHaveLength(5);
    expect(result.pagesUpdated).toHaveLength(0);
    expect(result.graphReport?.statsJson).toMatchObject({ node_count: 10, edge_count: 9 });

    const authPage = bySlug(result.pagesCreated, 'auth-system');
    const jwtPage = bySlug(result.pagesCreated, 'jwt-authentication');
    const indexPage = bySlug(result.pagesCreated, 'index');

    expect(indexPage.pageType).toBe('index');
    expect(indexPage.repoPath).toBe('spaces/rd-platform/index.md');
    expect(authPage.pageType).toBe('community');
    expect(authPage.repoPath).toBe('spaces/rd-platform/communities/auth-system.md');
    expect(jwtPage.pageType).toBe('god_node');
    expect(jwtPage.repoPath).toBe('spaces/rd-platform/god-nodes/jwt-authentication.md');
    expect(authPage.blockMetadata.map(block => block.blockId)).toEqual([
      'overview',
      'key-components',
      'relationships',
      'sources',
    ]);
    expect(authPage.sections.map(section => section.heading)).toContain('JWT Authentication');

    const parsed = parseFrontmatter(authPage.contentMarkdown);
    expect(parsed.frontmatter).toMatchObject({
      page_id: 'rd-platform.community.auth_system',
      title: 'Auth System',
      space_id: 'rd-platform',
      page_type: 'community',
      status: 'draft',
      curation_status: 'auto_generated',
      source: 'graphify',
      graphify_run_id: 'gf_001',
      graphify_schema_version: 'v1',
      managed_by: 'graphify',
      source_document_ids: ['doc-auth', 'doc-rbac'],
      version: 1,
      created_by: 'graphify',
      created_at: now,
      updated_at: now,
    });
    expect(result.indexUpdateManifest.pagesAdded).toContain('rd-platform.community.auth_system');
    expect(result.gitCommits[0]?.message).toBe(
      '[rd-platform][graphify][gf_001] add 5 pages: index, auth-system, permission-system, jwt-authentication, rbac-permission-model',
    );
  });

  it('updates existing pages with incremented versions on a second import', () => {
    const first = importGraphifyWiki(baseParams());
    const second = importGraphifyWiki({
      ...baseParams(),
      runId: 'gf_002',
      existingPages: existingPagesFrom(first.pagesCreated),
      existingBlockMetadata: blockMetadataFrom(first.pagesCreated),
    });

    expect(second.pagesCreated).toHaveLength(0);
    expect(second.pagesUpdated).toHaveLength(5);
    expect(bySlug(second.pagesUpdated, 'auth-system').versionNo).toBe(2);
    expect(parseFrontmatter(bySlug(second.pagesUpdated, 'auth-system').contentMarkdown).frontmatter.version).toBe(2);
  });

  it('preserves human-owned blocks and creates graphify suggestion proposals', () => {
    const first = importGraphifyWiki(baseParams());
    const authPage = bySlug(first.pagesCreated, 'auth-system');
    const humanContent = '## Key Components\n\nHuman-written component notes stay intact.';
    const humanHash = hash(humanContent);
    const existingPages = existingPagesFrom(first.pagesCreated);
    const existingBlockMetadata = blockMetadataFrom(first.pagesCreated);

    existingPages.set(authPage.pageId, {
      ...existingPages.get(authPage.pageId)!,
      contentMarkdown: authPage.contentMarkdown.replace(
        /<!-- graphify:managed:start id="key-components" run="gf_001" -->[\s\S]*?<!-- graphify:managed:end -->/,
        `<!-- graphify:human:start id="key-components" run="human-edit" -->\n${humanContent}\n<!-- graphify:human:end -->`,
      ),
    });
    existingBlockMetadata.set(
      authPage.pageId,
      existingBlockMetadata.get(authPage.pageId)!.map(block =>
        block.blockId === 'key-components' ? { ...block, owner: 'human', contentHash: humanHash, editable: true } : block,
      ),
    );

    const result = importGraphifyWiki({
      ...baseParams(),
      runId: 'gf_003',
      existingPages,
      existingBlockMetadata,
    });
    const updatedAuth = bySlug(result.pagesUpdated, 'auth-system');

    expect(updatedAuth.contentMarkdown).toContain('Human-written component notes stay intact.');
    expect(updatedAuth.contentMarkdown).not.toContain('JWT tokens serve as the primary authentication mechanism.');
    expect(updatedAuth.blockMetadata.find(block => block.blockId === 'key-components')).toMatchObject({
      owner: 'human',
      editable: true,
      contentHash: humanHash,
    });
    expect(result.proposalsCreated).toHaveLength(1);
    expect(result.proposalsCreated[0]).toMatchObject({
      pageId: authPage.pageId,
      blockId: 'key-components',
      proposalType: 'graphify_suggestion',
    });
    expect(result.proposalsCreated[0]?.diffJson.graphifyContent).toContain('JWT tokens serve');
  });

  it('archives existing community pages missing after re-clustering', () => {
    const existingPages = new Map<string, ExistingPageInfo>([
      [
        'rd-platform.community.legacy_cluster',
        {
          pageId: 'rd-platform.community.legacy_cluster',
          slug: 'legacy-cluster',
          currentVersionNo: 1,
          status: 'published',
          pageType: 'community',
        },
      ],
    ]);
    const result = importGraphifyWiki({
      ...baseParams(),
      existingPages,
    });

    expect(result.indexUpdateManifest.pagesArchived).toEqual(['rd-platform.community.legacy_cluster']);
  });

  it('keeps GRAPH_REPORT.md out of pages and stores it in graphReport', () => {
    const params = baseParams();
    params.wikiFiles.set('GRAPH_REPORT.md', readFileSync(path.join(fixtureDir, 'GRAPH_REPORT.md'), 'utf8'));

    const result = importGraphifyWiki(params);

    expect(result.pagesCreated.some(page => page.slug === 'GRAPH_REPORT')).toBe(false);
    expect(result.graphReport?.reportMarkdown).toContain('# Graph Report');
  });
});

function baseParams(): NormalizationParams {
  return {
    tenantId: 'tenant-1',
    spaceId: 'rd-platform',
    spaceSlug: 'rd-platform',
    runId: 'gf_001',
    communityLabels: ['Auth System', 'Permission System'],
    godNodeLabels: ['JWT Authentication', 'RBAC Permission Model'],
    stableKeys: new Map([
      ['JWT Authentication', 'jwtstablekeyabcdef'],
      ['RBAC Permission Model', 'rbacstablekeyabcdef'],
    ]),
    wikiFiles: new Map([
      ['index.md', readFileSync(path.join(wikiDir, 'index.md'), 'utf8')],
      ['auth-system.md', readFileSync(path.join(wikiDir, 'auth-system.md'), 'utf8')],
      ['permission-system.md', readFileSync(path.join(wikiDir, 'permission-system.md'), 'utf8')],
      ['jwt-authentication.md', readFileSync(path.join(wikiDir, 'jwt-authentication.md'), 'utf8')],
      ['rbac-permission-model.md', readFileSync(path.join(wikiDir, 'rbac-permission-model.md'), 'utf8')],
    ]),
    reportMarkdown: readFileSync(path.join(fixtureDir, 'GRAPH_REPORT.md'), 'utf8'),
    existingPages: new Map(),
    existingBlockMetadata: new Map(),
    sourceDocumentIds: ['doc-auth', 'doc-rbac'],
    now,
  };
}

function bySlug(pages: WikiPageImport[], slug: string): WikiPageImport {
  const page = pages.find(candidate => candidate.slug === slug);
  if (!page) {
    throw new Error(`Missing page for slug ${slug}`);
  }

  return page;
}

function existingPagesFrom(pages: WikiPageImport[]): Map<string, ExistingPageInfo> {
  return new Map(
    pages.map(page => [
      page.pageId,
      {
        pageId: page.pageId,
        slug: page.slug,
        currentVersionNo: page.versionNo,
        status: readString(page.frontmatter.status, 'draft'),
        pageType: page.pageType,
        contentMarkdown: page.contentMarkdown,
        createdAt: readString(page.frontmatter.created_at, now),
      },
    ]),
  );
}

function blockMetadataFrom(pages: WikiPageImport[]): Map<string, BlockMetadataInfo[]> {
  return new Map(pages.map(page => [page.pageId, page.blockMetadata]));
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
