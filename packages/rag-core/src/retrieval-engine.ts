import { rrfFuse } from './rrf-fusion.js';
import type { SourceChainJson } from './types.js';

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 50;
const DEFAULT_SEARCH_TOP_N = 20;

export type RetrievalParams = {
  query: string;
  queryEmbedding: number[];
  spaceId: string;
  tenantId: string;
  userGroupIds: string[];
  snapshotId: string;
  topK?: number;
};

export type RetrievalResult = {
  chunkId: string;
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

  const searchParams = {
    spaceId: params.spaceId,
    tenantId: params.tenantId,
    userGroupIds: params.userGroupIds,
    snapshotId: params.snapshotId,
    topN,
  };

  const [vectorResult, bm25Result] = await Promise.allSettled([
    Promise.resolve().then(() => vectorSearch({ ...searchParams, queryEmbedding: params.queryEmbedding })),
    Promise.resolve().then(() => bm25Search({ ...searchParams, query: params.query })),
  ]);

  const vectorResults = vectorResult.status === 'fulfilled' ? vectorResult.value : [];
  const bm25Results = bm25Result.status === 'fulfilled' ? bm25Result.value : [];

  return rrfFuse(vectorResults, bm25Results, { topK });
}

function normalizeTopK(topK: number | undefined): number {
  if (typeof topK !== 'number' || !Number.isFinite(topK) || topK <= 0) {
    return DEFAULT_TOP_K;
  }

  return Math.min(Math.floor(topK), MAX_TOP_K);
}
