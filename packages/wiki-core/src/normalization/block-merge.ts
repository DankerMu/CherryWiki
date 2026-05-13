import { createHash } from 'node:crypto';

import { blockIdFromHeading, extractH2Blocks } from './block-markers.js';

export interface BlockMetadataInfo {
  blockId: string;
  owner: 'graphify' | 'human';
  contentHash: string;
  content?: string;
  normalizedContent?: string;
  graphifyRunId?: string;
  lastEditor?: string;
  editable: boolean;
}

export interface BlockMatchResult {
  blockId: string;
  content: string;
  matchedMetadata?: BlockMetadataInfo;
  matchType: 'marker' | 'heading' | 'hash' | 'position' | 'new';
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
  const results: BlockMatchResult[] = [];

  for (const [index, block] of blocks.entries()) {
    const heading = readH2Heading(block.content);
    const headingBlockId = heading ? blockIdFromHeading(heading, index) : block.blockId;
    const headingMatch = findFirstUnmatchedByBlockId(
      [block.blockId, headingBlockId],
      sidecarByBlockId,
      matchedSidecarIds,
    );

    if (headingMatch !== undefined && !matchedSidecarIds.has(headingMatch.blockId)) {
      matchedSidecarIds.add(headingMatch.blockId);
      results.push({
        blockId: headingMatch.blockId,
        content: block.content,
        matchedMetadata: headingMatch,
        matchType: 'heading',
      });
      continue;
    }

    const markerMatch = findMarkerMatch(block.content, markdown, block.start, sidecarByBlockId, matchedSidecarIds);
    if (markerMatch !== undefined) {
      matchedSidecarIds.add(markerMatch.blockId);
      results.push({
        blockId: markerMatch.blockId,
        content: block.content,
        matchedMetadata: markerMatch,
        matchType: 'marker',
      });
      continue;
    }

    const stableHeadingMatch = findStableHeadingMatch(heading, sidecar, matchedSidecarIds);
    if (stableHeadingMatch !== undefined) {
      matchedSidecarIds.add(stableHeadingMatch.blockId);
      results.push({
        blockId: stableHeadingMatch.blockId,
        content: block.content,
        matchedMetadata: stableHeadingMatch,
        matchType: 'heading',
      });
      continue;
    }

    const normalizedContent = normalizeBlockContent(block.content);
    const hashMatch = findContentHashMatch(normalizedContent, sidecar, matchedSidecarIds);
    if (hashMatch !== undefined) {
      matchedSidecarIds.add(hashMatch.blockId);
      results.push({
        blockId: hashMatch.blockId,
        content: block.content,
        matchedMetadata: hashMatch,
        matchType: 'hash',
      });
      continue;
    }

    const contentMatch = findBestContentMatch(normalizedContent, sidecar, matchedSidecarIds);
    if (contentMatch !== undefined) {
      matchedSidecarIds.add(contentMatch.blockId);
      results.push({
        blockId: contentMatch.blockId,
        content: block.content,
        matchedMetadata: contentMatch,
        matchType: 'hash',
      });
      continue;
    }

    results.push({
      blockId: block.blockId,
      content: block.content,
      matchType: 'new',
    });
  }

  const unmatchedSidecar = sidecar.filter((metadata) => !matchedSidecarIds.has(metadata.blockId));
  const unmatchedBlockIndexes = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.matchType === 'new');
  if (sidecar.length === 1 && results.length === 1 && unmatchedSidecar.length === 1 && unmatchedBlockIndexes.length === 1) {
    const metadata = unmatchedSidecar[0];
    const unmatchedBlock = unmatchedBlockIndexes[0];
    if (metadata !== undefined && unmatchedBlock !== undefined) {
      results[unmatchedBlock.index] = {
        blockId: metadata.blockId,
        content: unmatchedBlock.result.content,
        matchedMetadata: metadata,
        matchType: 'position',
      };
    }
  }

  return results;
}

export function mergeBlocks(
  matchedBlocks: BlockMatchResult[],
  userId?: string,
  runId?: string,
  sidecar: BlockMetadataInfo[] = [],
): MergeResult {
  const matchedSidecarIds = new Set(
    matchedBlocks
      .map((block) => block.matchedMetadata?.blockId)
      .filter((blockId): blockId is string => blockId !== undefined),
  );
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
  const retainedHumanBlocks = sidecar.filter(
    (metadata) => metadata.owner === 'human' && !matchedSidecarIds.has(metadata.blockId),
  );
  const retainedMarkdown = retainedHumanBlocks.map(formatRetainedHumanBlock);

  return {
    mergedMarkdown: [...matchedBlocks.map((block) => block.content.trimEnd()), ...retainedMarkdown]
      .filter((content) => content.length > 0)
      .join('\n\n')
      .trimEnd(),
    newMetadata: [...newMetadata, ...retainedHumanBlocks.map((metadata) => ({ ...metadata }))],
    proposals: [],
  };
}

function readH2Heading(content: string): string | undefined {
  const match = /^##(?!#)[ \t]+(.+?)\s*#*\s*$/m.exec(content);
  return match?.[1]?.trim().replace(/\s+#*$/, '');
}

function findFirstUnmatchedByBlockId(
  blockIds: string[],
  sidecarByBlockId: Map<string, BlockMetadataInfo>,
  matchedSidecarIds: Set<string>,
): BlockMetadataInfo | undefined {
  for (const blockId of new Set(blockIds)) {
    const metadata = sidecarByBlockId.get(blockId);
    if (metadata !== undefined && !matchedSidecarIds.has(metadata.blockId)) {
      return metadata;
    }
  }

  return undefined;
}

function findStableHeadingMatch(
  heading: string | undefined,
  sidecar: BlockMetadataInfo[],
  matchedSidecarIds: Set<string>,
): BlockMetadataInfo | undefined {
  const headingKey = normalizeHeadingKey(heading);
  if (headingKey === undefined) {
    return undefined;
  }

  return findUniqueSidecarMatch(sidecar, matchedSidecarIds, (metadata) => {
    const sidecarHeadingKey =
      normalizeHeadingKey(readH2Heading(metadata.content ?? metadata.normalizedContent ?? '')) ??
      normalizeHeadingKey(metadata.blockId.replace(/-/g, ' '));
    return sidecarHeadingKey === headingKey;
  });
}

function findContentHashMatch(
  normalizedContent: string,
  sidecar: BlockMetadataInfo[],
  matchedSidecarIds: Set<string>,
): BlockMetadataInfo | undefined {
  const incomingFullHash = hashNormalizedContent(normalizedContent);
  const incomingBodyContent = stripLeadingH2(normalizedContent);
  const incomingBodyHash = hashNormalizedContent(incomingBodyContent);

  return findUniqueSidecarMatch(sidecar, matchedSidecarIds, (metadata) => {
    if (metadata.contentHash === incomingFullHash || metadata.contentHash === incomingBodyHash) {
      return true;
    }

    if (metadata.normalizedContent === undefined && metadata.content === undefined) {
      return false;
    }

    const sidecarContent = normalizeBlockContent(metadata.content ?? metadata.normalizedContent ?? '');
    return (
      hashNormalizedContent(sidecarContent) === incomingFullHash ||
      hashNormalizedContent(stripLeadingH2(sidecarContent)) === incomingBodyHash
    );
  });
}

function findMarkerMatch(
  content: string,
  markdown: string,
  blockStart: number,
  sidecarByBlockId: Map<string, BlockMetadataInfo>,
  matchedSidecarIds: Set<string>,
): BlockMetadataInfo | undefined {
  const markerId = readEmbeddedMarkerId(content) ?? readPrecedingMarkerId(markdown, blockStart);
  if (markerId === undefined) {
    return undefined;
  }

  const metadata = sidecarByBlockId.get(markerId);
  if (metadata === undefined || matchedSidecarIds.has(metadata.blockId)) {
    return undefined;
  }

  return metadata;
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

function findUniqueSidecarMatch(
  sidecar: BlockMetadataInfo[],
  matchedSidecarIds: Set<string>,
  predicate: (metadata: BlockMetadataInfo) => boolean,
): BlockMetadataInfo | undefined {
  let match: BlockMetadataInfo | undefined;

  for (const metadata of sidecar) {
    if (matchedSidecarIds.has(metadata.blockId) || !predicate(metadata)) {
      continue;
    }

    if (match !== undefined) {
      return undefined;
    }
    match = metadata;
  }

  return match;
}

function normalizeHeadingKey(heading: string | undefined): string | undefined {
  if (heading === undefined) {
    return undefined;
  }

  const normalized = heading
    .toLowerCase()
    .trim()
    .replace(/\p{P}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : undefined;
}

function hashNormalizedContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function stripLeadingH2(content: string): string {
  return content.replace(/^##(?!#)[ \t]+.+(?:\n|$)/, '').trimEnd();
}

function readEmbeddedMarkerId(content: string): string | undefined {
  const markerMatch =
    /<!--\s*(?:graphify:(?:managed|human)(?::retained)?|human:curated)(?::start)?\s+id="([^"]+)"/.exec(content);
  return markerMatch?.[1];
}

function readPrecedingMarkerId(markdown: string, blockStart: number): string | undefined {
  const beforeBlock = markdown.slice(0, blockStart);
  const markerMatch =
    /<!--\s*(?:graphify:(?:managed|human)|human:curated):start\s+id="([^"]+)"(?:\s+run="[^"]*")?\s*-->\s*$/.exec(
      beforeBlock,
    );
  return markerMatch?.[1];
}

function formatRetainedHumanBlock(metadata: BlockMetadataInfo): string {
  const content = (metadata.content ?? metadata.normalizedContent ?? '').trimEnd();
  return [
    `<!-- graphify:human:start id="${escapeMarkerAttribute(metadata.blockId)}" retained="true" -->`,
    content,
    '<!-- graphify:human:end -->',
  ].join('\n');
}

function escapeMarkerAttribute(value: string): string {
  return value.replace(/"/g, '&quot;');
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
