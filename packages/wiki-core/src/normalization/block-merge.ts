import { createHash } from 'node:crypto';

import { blockIdFromHeading, extractH2Blocks } from './block-markers.js';

export interface BlockMetadataInfo {
  blockId: string;
  owner: 'graphify' | 'human';
  contentHash: string;
  normalizedContent?: string;
  graphifyRunId?: string;
  lastEditor?: string;
  editable: boolean;
}

export interface BlockMatchResult {
  blockId: string;
  content: string;
  matchedMetadata?: BlockMetadataInfo;
  matchType: 'marker' | 'heading' | 'hash' | 'new';
}

export interface MergeResult {
  mergedMarkdown: string;
  newMetadata: BlockMetadataInfo[];
  proposals: Array<{
    blockId: string;
    proposalType: 'conflict';
    diffJson: { humanContent: string; graphifyContent: string };
  }>;
}

const markerLinePattern = /^\s*<!--\s*graphify:(?:managed|human):[^>]*-->\s*$/;
const fuzzyContentThreshold = 0.8;

export function normalizeBlockContent(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !markerLinePattern.test(line))
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

export function normalizeBlockHash(content: string): string {
  return createHash('sha256').update(normalizeBlockContent(content)).digest('hex');
}

export function matchBlocksFallback(
  markdown: string,
  sidecar: BlockMetadataInfo[],
): BlockMatchResult[] {
  const sidecarByBlockId = new Map(sidecar.map((metadata) => [metadata.blockId, metadata]));
  const matchedSidecarIds = new Set<string>();
  const blocks = extractH2Blocks(markdown);

  return blocks.map((block, index) => {
    const heading = readH2Heading(block.content);
    const headingBlockId = heading ? blockIdFromHeading(heading, index) : block.blockId;
    const headingMatch = sidecarByBlockId.get(headingBlockId) ?? sidecarByBlockId.get(block.blockId);

    if (headingMatch !== undefined && !matchedSidecarIds.has(headingMatch.blockId)) {
      matchedSidecarIds.add(headingMatch.blockId);
      return {
        blockId: headingMatch.blockId,
        content: block.content,
        matchedMetadata: headingMatch,
        matchType: 'heading',
      };
    }

    const normalizedContent = normalizeBlockContent(block.content);
    const contentMatch = findBestContentMatch(normalizedContent, sidecar, matchedSidecarIds);
    if (contentMatch !== undefined) {
      matchedSidecarIds.add(contentMatch.blockId);
      return {
        blockId: contentMatch.blockId,
        content: block.content,
        matchedMetadata: contentMatch,
        matchType: 'hash',
      };
    }

    return {
      blockId: block.blockId,
      content: block.content,
      matchType: 'new',
    };
  });
}

export function mergeBlocks(
  matchedBlocks: BlockMatchResult[],
  userId?: string,
  runId?: string,
): MergeResult {
  const newMetadata = matchedBlocks.map((block) => {
    const contentHash = normalizeBlockHash(block.content);
    const existing = block.matchedMetadata;

    if (existing === undefined || block.matchType === 'new') {
      return {
        blockId: block.blockId,
        owner: 'human' as const,
        contentHash,
        ...(userId !== undefined ? { lastEditor: userId } : {}),
        editable: true,
      };
    }

    if (existing.owner === 'graphify') {
      if (contentHash === existing.contentHash) {
        return { ...existing };
      }

      const graphifyRunId = existing.graphifyRunId ?? runId;
      return {
        ...existing,
        owner: 'human' as const,
        contentHash,
        ...(graphifyRunId !== undefined ? { graphifyRunId } : {}),
        ...(userId !== undefined ? { lastEditor: userId } : {}),
        editable: true,
      };
    }

    if (contentHash === existing.contentHash) {
      return { ...existing };
    }

    return {
      ...existing,
      contentHash,
      ...(userId !== undefined ? { lastEditor: userId } : {}),
      editable: true,
    };
  });

  return {
    mergedMarkdown: matchedBlocks.map((block) => block.content.trimEnd()).join('\n\n').trimEnd(),
    newMetadata,
    proposals: [],
  };
}

function readH2Heading(content: string): string | undefined {
  const match = /^##(?!#)[ \t]+(.+?)\s*#*\s*$/m.exec(content);
  return match?.[1]?.trim().replace(/\s+#*$/, '');
}

function findBestContentMatch(
  normalizedContent: string,
  sidecar: BlockMetadataInfo[],
  matchedSidecarIds: Set<string>,
): BlockMetadataInfo | undefined {
  let bestMatch: BlockMetadataInfo | undefined;
  let bestScore = fuzzyContentThreshold;

  for (const metadata of sidecar) {
    if (matchedSidecarIds.has(metadata.blockId)) {
      continue;
    }

    if (metadata.normalizedContent === undefined) {
      continue;
    }

    const score = characterJaccardSimilarity(normalizedContent, metadata.normalizedContent);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = metadata;
    }
  }

  return bestMatch;
}

function characterJaccardSimilarity(left: string, right: string): number {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const counts = new Map<string, number>();
  for (const char of left) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let overlap = 0;
  for (const char of right) {
    const count = counts.get(char) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(char, count - 1);
    }
  }

  return overlap / (left.length + right.length - overlap);
}
