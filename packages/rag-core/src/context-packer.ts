import type { FusedRetrievalResult } from './rrf-fusion.js';
import type { GraphCandidate, RetrievalConfig } from './types.js';

export type ContextPackResult = {
  wiki_context: string;
  graph_context: string;
  community_context: string;
  total_tokens: number;
  truncated_items: number;
  conflict_annotations: string[];
};

type ContextItem<T> = {
  value: T;
  text: string;
  score: number;
  tokens: number;
};

type PackedItems<T> = {
  included: Array<ContextItem<T>>;
  tokens: number;
  truncated: number;
};

type EntityPair = {
  source: string;
  target: string;
};

const CONTEXT_SEPARATOR = '\n\n';
const CONFLICT_ANNOTATION_PREFIX = '图谱中存在关系';
const NEGATION_KEYWORDS = [
  'not',
  'no',
  'never',
  'without',
  'denies',
  'deny',
  'denied',
  'contradicts',
  'unrelated',
  'not related',
  'not connected',
  'does not',
  "doesn't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  '不',
  '不是',
  '没有',
  '未',
  '无关',
  '否认',
  '并非',
  '不属于',
  '不连接',
  '不存在',
] as const;

export function packContext(
  fusedResults: FusedRetrievalResult[],
  config: RetrievalConfig,
  tokenCounter: (text: string) => number,
): ContextPackResult {
  let remainingTotalBudget = normalizeTokenBudget(config.context_token_budget);
  const wikiItems = makeWikiItems(fusedResults, tokenCounter);
  const wikiPack = packItems(wikiItems, config.wiki_context_budget, remainingTotalBudget);
  remainingTotalBudget -= wikiPack.tokens;

  const conflictAnnotationsByCandidate = detectGraphChunkConflicts(
    fusedResults
      .filter((result): result is Extract<FusedRetrievalResult, { type: 'graph' }> => result.type === 'graph')
      .map((result) => result.candidate),
    wikiPack.included.map((item) => item.value.hit.content),
  );

  const graphItems = makeGraphItems(fusedResults, conflictAnnotationsByCandidate, tokenCounter);
  const graphPack = packItems(graphItems, config.graph_context_budget, remainingTotalBudget);
  remainingTotalBudget -= graphPack.tokens;

  const communityItems = makeCommunityItems(fusedResults, tokenCounter);
  const communityPack = packItems(communityItems, config.community_summary_budget, remainingTotalBudget);

  const conflictAnnotations = [...conflictAnnotationsByCandidate.values()];

  return {
    wiki_context: joinContext(wikiPack.included),
    graph_context: joinContext(graphPack.included),
    community_context: joinContext(communityPack.included),
    total_tokens: wikiPack.tokens + graphPack.tokens + communityPack.tokens,
    truncated_items: wikiPack.truncated + graphPack.truncated + communityPack.truncated,
    conflict_annotations: conflictAnnotations,
  };
}

function makeWikiItems(
  fusedResults: FusedRetrievalResult[],
  tokenCounter: (text: string) => number,
): Array<ContextItem<Extract<FusedRetrievalResult, { type: 'wiki_chunk' }>>> {
  return fusedResults
    .filter((result): result is Extract<FusedRetrievalResult, { type: 'wiki_chunk' }> => result.type === 'wiki_chunk')
    .map((result) => makeContextItem(result, result.hit.content, result.score, tokenCounter))
    .sort(compareContextItems);
}

function makeGraphItems(
  fusedResults: FusedRetrievalResult[],
  conflictAnnotationsByCandidate: Map<string, string>,
  tokenCounter: (text: string) => number,
): Array<ContextItem<Extract<FusedRetrievalResult, { type: 'graph' }>>> {
  return fusedResults
    .filter(
      (result): result is Extract<FusedRetrievalResult, { type: 'graph' }> =>
        result.type === 'graph' && result.candidate.type !== 'community',
    )
    .map((result) => {
      const annotation = conflictAnnotationsByCandidate.get(candidateKey(result.candidate));
      const text = annotation === undefined ? result.candidate.content : `${result.candidate.content}\n${annotation}`;
      return makeContextItem(result, text, result.score, tokenCounter);
    })
    .sort(compareContextItems);
}

function makeCommunityItems(
  fusedResults: FusedRetrievalResult[],
  tokenCounter: (text: string) => number,
): Array<ContextItem<Extract<FusedRetrievalResult, { type: 'graph' }>>> {
  return fusedResults
    .filter(
      (result): result is Extract<FusedRetrievalResult, { type: 'graph' }> =>
        result.type === 'graph' && result.candidate.type === 'community',
    )
    .map((result) => makeContextItem(result, result.candidate.content, result.score, tokenCounter))
    .sort(compareContextItems);
}

function makeContextItem<T>(
  value: T,
  text: string,
  score: number,
  tokenCounter: (text: string) => number,
): ContextItem<T> {
  return {
    value,
    text,
    score,
    tokens: countTokens(text, tokenCounter),
  };
}

function packItems<T>(
  items: Array<ContextItem<T>>,
  categoryBudget: number,
  remainingTotalBudget: number,
): PackedItems<T> {
  const budget = Math.min(normalizeTokenBudget(categoryBudget), Math.max(0, remainingTotalBudget));
  const included: Array<ContextItem<T>> = [];
  let usedTokens = 0;

  for (const item of items) {
    if (usedTokens + item.tokens > budget) {
      continue;
    }

    included.push(item);
    usedTokens += item.tokens;
  }

  return {
    included,
    tokens: usedTokens,
    truncated: items.length - included.length,
  };
}

function detectGraphChunkConflicts(
  graphCandidates: GraphCandidate[],
  wikiChunkContents: string[],
): Map<string, string> {
  const annotationsByCandidate = new Map<string, string>();

  for (const candidate of graphCandidates) {
    if (candidate.type !== 'graph_path') {
      continue;
    }

    const conflict = findPathConflict(candidate, wikiChunkContents);
    if (conflict !== null) {
      annotationsByCandidate.set(candidateKey(candidate), conflict);
    }
  }

  return annotationsByCandidate;
}

function findPathConflict(candidate: GraphCandidate, wikiChunkContents: string[]): string | null {
  for (const pair of extractPathEntityPairs(candidate.content)) {
    for (const content of wikiChunkContents) {
      if (chunkContradictsPair(content, pair)) {
        return `${CONFLICT_ANNOTATION_PREFIX} ${pair.source} → ${pair.target} 但与页面内容不一致`;
      }
    }
  }

  return null;
}

function extractPathEntityPairs(content: string): EntityPair[] {
  const body = content
    .replace(/^\[Path\]\s*/, '')
    .replace(/\s*\(confidence:[^)]+\)\s*$/i, '');
  const segments = body
    .split('→')
    .map((segment) => segment.replace(/（[^）]*）/g, '').trim())
    .filter((segment) => segment.length > 0);
  const entities: string[] = [];

  for (let index = 0; index < segments.length; index += 2) {
    const segment = segments[index];
    if (segment !== undefined) {
      entities.push(segment);
    }
  }

  const pairs: EntityPair[] = [];
  for (let index = 0; index < entities.length - 1; index += 1) {
    const source = entities[index];
    const target = entities[index + 1];
    if (source !== undefined && target !== undefined) {
      pairs.push({ source, target });
    }
  }

  return pairs;
}

function chunkContradictsPair(content: string, pair: EntityPair): boolean {
  const normalizedContent = content.toLocaleLowerCase();
  const source = pair.source.toLocaleLowerCase();
  const target = pair.target.toLocaleLowerCase();

  if (!normalizedContent.includes(source) || !normalizedContent.includes(target)) {
    return false;
  }

  return hasNegationNearEntity(normalizedContent, source) || hasNegationNearEntity(normalizedContent, target);
}

function hasNegationNearEntity(content: string, entity: string): boolean {
  for (const position of findOccurrences(content, entity)) {
    const windowStart = Math.max(0, position - 80);
    const windowEnd = Math.min(content.length, position + entity.length + 80);
    const nearbyText = content.slice(windowStart, windowEnd);

    if (NEGATION_KEYWORDS.some((keyword) => nearbyText.includes(keyword))) {
      return true;
    }
  }

  return false;
}

function findOccurrences(content: string, needle: string): number[] {
  const positions: number[] = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const position = content.indexOf(needle, searchFrom);
    if (position === -1) {
      break;
    }

    positions.push(position);
    searchFrom = position + Math.max(needle.length, 1);
  }

  return positions;
}

function candidateKey(candidate: GraphCandidate): string {
  return `${candidate.type}:${candidate.id}`;
}

function joinContext<T>(items: Array<ContextItem<T>>): string {
  return items.map((item) => item.text).join(CONTEXT_SEPARATOR);
}

function compareContextItems<T>(left: ContextItem<T>, right: ContextItem<T>): number {
  return right.score - left.score;
}

function countTokens(text: string, tokenCounter: (text: string) => number): number {
  const tokenCount = tokenCounter(text);
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) {
    return 0;
  }

  return Math.ceil(tokenCount);
}

function normalizeTokenBudget(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}
