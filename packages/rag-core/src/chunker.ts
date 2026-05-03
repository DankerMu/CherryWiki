import { createHash } from 'node:crypto';

import { countTokens } from '@cherrygraph/ai-core';

import { checkInjectionRisk } from './injection-scanner.js';
import type { AclJson, ChunkOptions, ChunkResult, SourceChainJson } from './types.js';

const DEFAULT_MAX_CHUNK_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 64;
const CHARS_PER_TOKEN = 4;

type PageLike = {
  id?: string;
  tenant_id: string;
  space_id: string;
  page_id: string;
  content?: string | null;
  content_markdown?: string | null;
  sourceDocMetadata?: { injection_risk?: boolean };
};

type VersionLike = {
  id?: string;
  version_no: number;
  content?: string | null;
  content_markdown?: string | null;
  sourceDocMetadata?: { injection_risk?: boolean };
};

type SectionLike = {
  id?: string;
  section_id?: string;
  section_index: number;
  content?: string | null;
  content_markdown?: string | null;
  start_offset?: number | null;
  end_offset?: number | null;
};

export function chunkPage(
  page: PageLike,
  version: VersionLike,
  sections: SectionLike[],
  options: ChunkOptions = {},
): ChunkResult[] {
  const content = getPageContent(page, version);
  const normalizedOptions = normalizeChunkOptions(options);
  const sortedSections = [...sections].sort((left, right) => left.section_index - right.section_index);
  const sourceChainJson = buildDefaultSourceChainJson();
  const aclJson = buildDefaultAclJson(page, version);
  const chunks: ChunkResult[] = [];

  if (content.trim().length === 0) {
    return [];
  }

  const chunkTargets =
    sortedSections.length > 0
      ? sortedSections.map((section) => ({
          sectionId: section.id ?? section.section_id ?? null,
          content: getSectionContent(section, content),
        }))
      : [{ sectionId: null, content }];

  for (const target of chunkTargets) {
    for (const chunkContent of splitContentByTokenWindow(target.content, normalizedOptions)) {
      chunks.push({
        chunk_index: chunks.length,
        content: chunkContent,
        content_hash: hashContent(chunkContent),
        token_count: countTokens(chunkContent),
        section_id: target.sectionId,
        injection_risk: checkInjectionRisk(chunkContent, page.sourceDocMetadata ?? version.sourceDocMetadata),
        source_chain_json: sourceChainJson,
        acl_json: aclJson,
      });
    }
  }

  return chunks;
}

function normalizeChunkOptions(options: ChunkOptions): Required<ChunkOptions> {
  const maxChunkTokens =
    typeof options.maxChunkTokens === 'number' && Number.isFinite(options.maxChunkTokens) && options.maxChunkTokens > 0
      ? Math.floor(options.maxChunkTokens)
      : DEFAULT_MAX_CHUNK_TOKENS;
  const rawOverlapTokens =
    typeof options.overlapTokens === 'number' && Number.isFinite(options.overlapTokens) && options.overlapTokens >= 0
      ? Math.floor(options.overlapTokens)
      : DEFAULT_OVERLAP_TOKENS;

  return {
    maxChunkTokens,
    overlapTokens: Math.min(rawOverlapTokens, Math.max(0, maxChunkTokens - 1)),
  };
}

function getPageContent(page: PageLike, version: VersionLike): string {
  return version.content_markdown ?? version.content ?? page.content_markdown ?? page.content ?? '';
}

function getSectionContent(section: SectionLike, pageContent: string): string {
  if (typeof section.content === 'string') {
    return section.content;
  }

  if (typeof section.content_markdown === 'string') {
    return section.content_markdown;
  }

  if (typeof section.start_offset === 'number' && typeof section.end_offset === 'number') {
    return pageContent.slice(section.start_offset, section.end_offset);
  }

  return '';
}

function splitContentByTokenWindow(content: string, options: Required<ChunkOptions>): string[] {
  if (content.trim().length === 0) {
    return [];
  }

  const maxChars = options.maxChunkTokens * CHARS_PER_TOKEN;
  const overlapChars = options.overlapTokens * CHARS_PER_TOKEN;
  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    const end = Math.min(content.length, start + maxChars);
    const chunk = content.slice(start, end);

    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }

    if (end === content.length) {
      break;
    }

    start = Math.max(start + 1, end - overlapChars);
  }

  return chunks;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildDefaultSourceChainJson(): SourceChainJson {
  return {
    source_document_ids: [],
    graph_node_ids: [],
    graph_edge_ids: [],
    edge_confidences: [],
    chain_confidence: 1.0,
  };
}

function buildDefaultAclJson(page: PageLike, version: VersionLike): AclJson {
  return {
    tenant_id: page.tenant_id,
    space_id: page.space_id,
    allowed_group_ids: [],
    classification: 'internal',
    page_id: page.page_id,
    page_version: version.version_no,
  };
}
