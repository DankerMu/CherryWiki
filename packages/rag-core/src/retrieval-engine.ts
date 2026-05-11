import { rrfFuse } from './rrf-fusion.js';
import type { SourceChainJson } from './types.js';

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 50;
const DEFAULT_SEARCH_TOP_N = 20;

export type RetrievalParams = {
  query: string;
  queryEmbedding: number[];
  spaceIds: string[];
  tenantId: string;
  userGroupIds: string[];
  snapshotsBySpace: Record<string, string>;
  topK?: number;
};

export type RetrievalResult = {
  chunkId: string;
  spaceId: string;
  content: string;
  score: number;
  wikiPagePk: string;
  sectionId: string | null;
  sourceChainJson: SourceChainJson;
  injectionRisk: boolean;
  pageTitle: string;
  sectionTitle: string | null;
};

export type SearchHit = {
  chunkId: string;
  spaceId: string;
  content: string;
  score: number;
  wikiPagePk: string;
  sectionId: string | null;
  sourceChainJson: SourceChainJson;
  injectionRisk: boolean;
  pageTitle: string;
  sectionTitle: string | null;
};

export type VectorSearchFn = (params: {
  queryEmbedding: number[];
  spaceId: string;
  tenantId: string;
  userGroupIds: string[];
  snapshotId: string;
  topN: number;
}) => Promise<SearchHit[]>;

export type Bm25SearchFn = (params: {
  query: string;
  spaceId: string;
  tenantId: string;
  userGroupIds: string[];
  snapshotId: string;
  topN: number;
}) => Promise<SearchHit[]>;

export async function retrieve(
  params: RetrievalParams,
  vectorSearch: VectorSearchFn,
  bm25Search: Bm25SearchFn,
): Promise<RetrievalResult[]> {
  const topK = normalizeTopK(params.topK);
  const topN = Math.max(DEFAULT_SEARCH_TOP_N, topK);
  const allVectorHits: SearchHit[] = [];
  const allBm25Hits: SearchHit[] = [];
  const selectedSpaceIds = new Set(params.spaceIds);
  const spaceEntries = Object.entries(params.snapshotsBySpace).filter(([spaceId]) => selectedSpaceIds.has(spaceId));

  if (spaceEntries.length === 0) {
    return [];
  }

  await Promise.all(
    spaceEntries.map(async ([spaceId, snapshotId]) => {
      const searchParams = {
        spaceId,
        tenantId: params.tenantId,
        userGroupIds: params.userGroupIds,
        snapshotId,
        topN,
      };

      const [vectorResult, bm25Result] = await Promise.allSettled([
        Promise.resolve().then(() => vectorSearch({ ...searchParams, queryEmbedding: params.queryEmbedding })),
        Promise.resolve().then(() => bm25Search({ ...searchParams, query: params.query })),
      ]);

      if (vectorResult.status === 'fulfilled') {
        allVectorHits.push(...vectorResult.value.map((hit) => ({ ...hit, spaceId })));
      }

      if (bm25Result.status === 'fulfilled') {
        allBm25Hits.push(...bm25Result.value.map((hit) => ({ ...hit, spaceId })));
      }
    }),
  );

  return rrfFuse(allVectorHits, allBm25Hits, { topK });
}

function normalizeTopK(topK: number | undefined): number {
  if (typeof topK !== 'number' || !Number.isFinite(topK) || topK <= 0) {
    return DEFAULT_TOP_K;
  }

  return Math.min(Math.floor(topK), MAX_TOP_K);
}
