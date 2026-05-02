import { createHash } from 'node:crypto';

import { generateFrontmatter } from '../frontmatter.js';
import { generatePageId, type WikiPageType } from '../page-id.js';
import { extractSections } from '../sections.js';
import type { WikiFrontmatter, WikiSection } from '../types.js';
import {
  extractH2Blocks,
  extractMarkedBlocks,
  wrapGraphifyBlock,
  wrapHumanBlock,
} from './block-markers.js';
import { identifyPageType } from './identify-page-type.js';
import { safeFilename } from './safe-filename.js';
import { sanitizeMarkdown } from './sanitize-markdown.js';

export interface NormalizationParams {
  tenantId: string;
  spaceId: string;
  spaceSlug: string;
  runId: string;
  communityLabels: string[];
  godNodeLabels: string[];
  stableKeys: Map<string, string>;
  wikiFiles: Map<string, string>;
  reportMarkdown: string;
  existingPages: Map<string, ExistingPageInfo>;
  existingBlockMetadata: Map<string, BlockMetadataInfo[]>;
  sourceDocumentIds: string[];
  now?: Date | string;
}

export interface ExistingPageInfo {
  pageId: string;
  slug: string;
  currentVersionNo: number;
  status: string;
  pageType?: WikiPageType;
  title?: string;
  repoPath?: string;
  contentMarkdown?: string;
  createdAt?: string;
}

export interface BlockMetadataInfo {
  blockId: string;
  owner: 'graphify' | 'human';
  contentHash: string;
  editable?: boolean;
  contentMarkdown?: string;
}

export interface WikiPageImport {
  pageId: string;
  title: string;
  slug: string;
  pageType: WikiPageType;
  repoPath: string;
  contentMarkdown: string;
  frontmatter: Record<string, unknown>;
  versionNo: number;
  source: 'graphify';
  sections: WikiSection[];
  blockMetadata: Array<{ blockId: string; owner: 'graphify' | 'human'; contentHash: string; editable: boolean }>;
}

export interface ProposalInfo {
  pageId: string;
  blockId: string;
  proposalType: 'graphify_suggestion';
  diffJson: { humanContent: string; graphifyContent: string };
}

export interface IndexUpdateManifest {
  pagesAdded: string[];
  pagesUpdated: string[];
  pagesArchived: string[];
  graphNodesChanged: number;
  graphEdgesChanged: number;
}

export interface GitCommitInfo {
  author: string;
  email: string;
  message: string;
}

export interface NormalizationResult {
  pagesCreated: WikiPageImport[];
  pagesUpdated: WikiPageImport[];
  pagesUnchanged: string[];
  proposalsCreated: ProposalInfo[];
  graphReport: { reportMarkdown: string; statsJson: Record<string, unknown> } | null;
  indexUpdateManifest: IndexUpdateManifest;
  gitCommits: GitCommitInfo[];
}

interface ContentOwnershipResult {
  finalContent: string;
  blockMetadata: WikiPageImport['blockMetadata'];
  proposalsCreated: ProposalInfo[];
}

export function importGraphifyWiki(params: NormalizationParams): NormalizationResult {
  const {
    spaceId,
    spaceSlug,
    runId,
    communityLabels,
    godNodeLabels,
    stableKeys,
    wikiFiles,
    reportMarkdown,
    existingPages,
    existingBlockMetadata,
    sourceDocumentIds,
  } = params;

  const pagesCreated: WikiPageImport[] = [];
  const pagesUpdated: WikiPageImport[] = [];
  const pagesUnchanged: string[] = [];
  const proposalsCreated: ProposalInfo[] = [];
  const usedSlugs = new Set<string>(Array.from(existingPages.values()).map(page => page.slug));
  const existingPageBySlug = new Map(Array.from(existingPages.values()).map(page => [page.slug, page]));
  const incomingCommunityPageIds = new Set<string>();
  const now = params.now instanceof Date ? params.now.toISOString() : (params.now ?? new Date().toISOString());

  for (const [inputFilename, rawContent] of wikiFiles) {
    const filename = basename(inputFilename);
    if (filename === 'GRAPH_REPORT.md') {
      continue;
    }

    const fileStem = filename.replace(/\.md$/i, '');
    const pageType = identifyPageType(filename, communityLabels, godNodeLabels);
    const title = resolveTitle(fileStem, pageType, communityLabels, godNodeLabels);
    const baseSlug = safeFilename(fileStem);
    const pageId = buildPageId(spaceId, pageType, fileStem, title, baseSlug, stableKeys);
    const existingPage = existingPages.get(pageId);
    const slug = existingPage ? existingPage.slug : resolveSlug(baseSlug, runId, usedSlugs, existingPageBySlug);
    usedSlugs.add(slug);

    if (pageType === 'community') {
      incomingCommunityPageIds.add(pageId);
    }

    const repoPath = repoPathForPage(spaceId, pageType, slug);
    const sanitized = sanitizeMarkdown(rawContent);
    const ownership = buildContentWithBlockOwnership({
      pageId,
      sanitizedContent: sanitized,
      runId,
      existingPage,
      existingBlocks: existingBlockMetadata.get(pageId) ?? [],
    });

    proposalsCreated.push(...ownership.proposalsCreated);

    const versionNo = existingPage ? existingPage.currentVersionNo + 1 : 1;
    const frontmatter: WikiFrontmatter = {
      page_id: pageId,
      title,
      space_id: spaceId,
      page_type: pageType,
      status: normalizeStatus(existingPage?.status),
      curation_status: ownership.blockMetadata.some(block => block.owner === 'human') ? 'mixed' : 'auto_generated',
      source: 'graphify',
      graphify_run_id: runId,
      graphify_schema_version: 'v1',
      managed_by: 'graphify',
      source_document_ids: sourceDocumentIds,
      graph_node_ids: [],
      version: versionNo,
      acl_hash: '',
      created_by: 'graphify',
      created_at: existingPage?.createdAt ?? now,
      updated_at: now,
    };

    const fullContent = generateFrontmatter(frontmatter, ownership.finalContent);
    const pageImport: WikiPageImport = {
      pageId,
      title,
      slug,
      pageType,
      repoPath,
      contentMarkdown: fullContent,
      frontmatter: frontmatter as unknown as Record<string, unknown>,
      versionNo,
      source: 'graphify',
      sections: extractSections(ownership.finalContent, pageId),
      blockMetadata: ownership.blockMetadata,
    };

    if (existingPage) {
      pagesUpdated.push(pageImport);
    } else {
      pagesCreated.push(pageImport);
    }
  }

  const pagesArchived = computeArchivedCommunityPages(existingPages, incomingCommunityPageIds);
  const graphReport = reportMarkdown
    ? {
        reportMarkdown,
        statsJson: parseReportStats(reportMarkdown),
      }
    : null;

  const gitCommits: GitCommitInfo[] = [
    {
      author: 'graphify',
      email: 'graphify@cherrygraph.local',
      message: buildCommitMessage(spaceSlug, runId, pagesCreated, pagesUpdated),
    },
  ];

  return {
    pagesCreated,
    pagesUpdated,
    pagesUnchanged,
    proposalsCreated,
    graphReport,
    indexUpdateManifest: {
      pagesAdded: pagesCreated.map(page => page.pageId),
      pagesUpdated: pagesUpdated.map(page => page.pageId),
      pagesArchived,
      graphNodesChanged: readNumericStat(graphReport?.statsJson, 'node_count'),
      graphEdgesChanged: readNumericStat(graphReport?.statsJson, 'edge_count'),
    },
    gitCommits,
  };
}

function buildContentWithBlockOwnership(args: {
  pageId: string;
  sanitizedContent: string;
  runId: string;
  existingPage: ExistingPageInfo | undefined;
  existingBlocks: BlockMetadataInfo[];
}): ContentOwnershipResult {
  const h2Blocks = extractH2Blocks(args.sanitizedContent);
  if (h2Blocks.length === 0) {
    return {
      finalContent: args.sanitizedContent,
      blockMetadata: [],
      proposalsCreated: [],
    };
  }

  const humanBlocks = new Map(args.existingBlocks.filter(block => block.owner === 'human').map(block => [block.blockId, block]));
  const existingContentByBlock = getExistingContentByBlock(args.existingPage);
  const blockMetadata: ContentOwnershipResult['blockMetadata'] = [];
  const proposalsCreated: ProposalInfo[] = [];
  let finalContent = args.sanitizedContent.slice(0, h2Blocks[0]?.start ?? 0);

  for (const block of h2Blocks) {
    const humanBlock = humanBlocks.get(block.blockId);

    if (humanBlock) {
      const preservedContent =
        humanBlock.contentMarkdown ?? existingContentByBlock.get(block.blockId) ?? block.content;
      const graphifyHash = hashContent(block.content);

      if (graphifyHash !== humanBlock.contentHash) {
        proposalsCreated.push({
          pageId: args.pageId,
          blockId: block.blockId,
          proposalType: 'graphify_suggestion',
          diffJson: {
            humanContent: preservedContent,
            graphifyContent: block.content,
          },
        });
      }

      finalContent += wrapHumanBlock(preservedContent, block.blockId, args.runId);
      blockMetadata.push({
        blockId: block.blockId,
        owner: 'human',
        contentHash: humanBlock.contentHash || hashContent(preservedContent),
        editable: true,
      });
    } else {
      finalContent += wrapGraphifyBlock(block.content, block.blockId, args.runId);
      blockMetadata.push({
        blockId: block.blockId,
        owner: 'graphify',
        contentHash: hashContent(block.content),
        editable: false,
      });
    }
  }

  return {
    finalContent: finalContent.trimEnd(),
    blockMetadata,
    proposalsCreated,
  };
}

function getExistingContentByBlock(existingPage: ExistingPageInfo | undefined): Map<string, string> {
  if (!existingPage?.contentMarkdown) {
    return new Map();
  }

  const body = stripFrontmatter(existingPage.contentMarkdown);
  const markedBlocks = extractMarkedBlocks(body);
  if (markedBlocks.size > 0) {
    return markedBlocks;
  }

  return new Map(extractH2Blocks(body).map(block => [block.blockId, block.content]));
}

function buildPageId(
  spaceId: string,
  pageType: WikiPageType,
  fileStem: string,
  title: string,
  baseSlug: string,
  stableKeys: Map<string, string>,
): string {
  if (pageType === 'index') {
    return generatePageId(spaceId, 'index', 'root');
  }

  if (pageType === 'community') {
    return generatePageId(spaceId, 'community', communityKey(fileStem));
  }

  if (pageType === 'god_node') {
    const stableKey = lookupStableKey(stableKeys, title, fileStem) ?? hashContent(title).slice(0, 16);
    return generatePageId(spaceId, 'god_node', stableKey.slice(0, 12));
  }

  return generatePageId(spaceId, 'generated_article', hashContent(baseSlug).slice(0, 12));
}

function resolveTitle(fileStem: string, pageType: WikiPageType, communityLabels: string[], godNodeLabels: string[]): string {
  const labels = pageType === 'community' ? communityLabels : pageType === 'god_node' ? godNodeLabels : [];
  const matchedLabel = labels.find(label => labelMatchesStem(label, fileStem));

  if (matchedLabel) {
    return matchedLabel;
  }

  if (fileStem === 'index') {
    return 'Wiki Index';
  }

  return fileStem.replace(/[_-]+/g, ' ').trim() || fileStem;
}

function labelMatchesStem(label: string, fileStem: string): boolean {
  const variants = new Set([safeFilename(label), normalizeForComparison(safeFilename(label))]);
  return variants.has(fileStem) || variants.has(normalizeForComparison(fileStem));
}

function lookupStableKey(stableKeys: Map<string, string>, title: string, fileStem: string): string | undefined {
  const candidates = [
    title,
    fileStem,
    safeFilename(title),
    normalizeForComparison(title),
    normalizeForComparison(fileStem),
    title.toLowerCase(),
    fileStem.toLowerCase(),
  ];

  for (const candidate of candidates) {
    const stableKey = stableKeys.get(candidate);
    if (stableKey) {
      return stableKey;
    }
  }

  return undefined;
}

function resolveSlug(
  baseSlug: string,
  runId: string,
  usedSlugs: Set<string>,
  existingPageBySlug: Map<string, ExistingPageInfo>,
): string {
  if (!usedSlugs.has(baseSlug)) {
    return baseSlug;
  }

  if (existingPageBySlug.has(baseSlug)) {
    return makeGraphifyCollisionSlug(baseSlug, runId, usedSlugs);
  }

  return makeDedupedSlug(baseSlug, usedSlugs);
}

function makeGraphifyCollisionSlug(baseSlug: string, runId: string, usedSlugs: Set<string>): string {
  const suffix = `_gf_${runId.slice(0, 8)}`;
  let candidate = `${baseSlug}${suffix}`;
  let index = 2;

  while (usedSlugs.has(candidate)) {
    candidate = `${baseSlug}${suffix}_${index}`;
    index += 1;
  }

  return candidate;
}

function makeDedupedSlug(baseSlug: string, usedSlugs: Set<string>): string {
  let index = 2;
  let candidate = `${baseSlug}_${index}`;

  while (usedSlugs.has(candidate)) {
    index += 1;
    candidate = `${baseSlug}_${index}`;
  }

  return candidate;
}

function repoPathForPage(spaceId: string, pageType: WikiPageType, slug: string): string {
  if (pageType === 'index') {
    return `spaces/${spaceId}/index.md`;
  }

  const typeDir: Record<Exclude<WikiPageType, 'index'>, string> = {
    community: 'communities',
    god_node: 'god-nodes',
    generated_article: 'pages',
  };

  return `spaces/${spaceId}/${typeDir[pageType]}/${slug}.md`;
}

function parseReportStats(markdown: string): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  const nodeCount = findCount(markdown, ['nodes?', '实体']);
  const edgeCount = findCount(markdown, ['edges?', '关系']);
  const pageCount = findCount(markdown, ['pages?', '页面']);

  if (nodeCount !== null) {
    stats.node_count = nodeCount;
  }
  if (edgeCount !== null) {
    stats.edge_count = edgeCount;
  }
  if (pageCount !== null) {
    stats.wiki_page_count = pageCount;
  }

  return stats;
}

function findCount(markdown: string, labels: string[]): number | null {
  for (const label of labels) {
    const labelThenNumber = new RegExp(`${label}[^0-9]*(\\d+)`, 'i');
    const numberThenLabel = new RegExp(`(\\d+)\\s*${label}`, 'i');
    const labelMatch = markdown.match(labelThenNumber);
    const numberMatch = markdown.match(numberThenLabel);
    const rawValue = labelMatch?.[1] ?? numberMatch?.[1];

    if (rawValue) {
      return Number.parseInt(rawValue, 10);
    }
  }

  return null;
}

function buildCommitMessage(
  spaceSlug: string,
  runId: string,
  pagesCreated: WikiPageImport[],
  pagesUpdated: WikiPageImport[],
): string {
  const parts: string[] = [];

  if (pagesCreated.length > 0) {
    parts.push(`add ${pagesCreated.length} page${pagesCreated.length === 1 ? '' : 's'}`);
  }
  if (pagesUpdated.length > 0) {
    parts.push(`update ${pagesUpdated.length} page${pagesUpdated.length === 1 ? '' : 's'}`);
  }

  const slugs = [...pagesCreated, ...pagesUpdated].map(page => page.slug).join(', ');
  const summary = parts.length > 0 ? `${parts.join(', ')}: ${slugs}` : 'no changes';

  return `[${spaceSlug}][graphify][${runId}] ${summary}`;
}

function computeArchivedCommunityPages(
  existingPages: Map<string, ExistingPageInfo>,
  incomingCommunityPageIds: Set<string>,
): string[] {
  return Array.from(existingPages.values())
    .filter(page => isCommunityPage(page))
    .filter(page => !incomingCommunityPageIds.has(page.pageId))
    .map(page => page.pageId);
}

function isCommunityPage(page: ExistingPageInfo): boolean {
  return page.pageType === 'community' || page.pageId.includes('.community.');
}

function normalizeStatus(status: string | undefined): WikiFrontmatter['status'] {
  if (status === 'published' || status === 'archived') {
    return status;
  }

  return 'draft';
}

function communityKey(fileStem: string): string {
  return fileStem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'community';
}

function normalizeForComparison(value: string): string {
  return value.toLowerCase().replace(/[_\s-]+/g, '-');
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function readNumericStat(stats: Record<string, unknown> | undefined, key: string): number {
  const value = stats?.[key];
  return typeof value === 'number' ? value : 0;
}
