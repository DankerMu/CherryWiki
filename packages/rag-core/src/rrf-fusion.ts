import type { RetrievalResult, SearchHit } from './retrieval-engine.js';

const DEFAULT_RRF_K = 60;
const DEFAULT_TOP_K = 8;
const DEFAULT_INJECTION_PENALTY = 0.3;

type FusedHit = {
  hit: SearchHit;
  score: number;
};

export function rrfFuse(
  vectorResults: SearchHit[],
  bm25Results: SearchHit[],
  options: { k?: number; topK?: number; injectionPenalty?: number } = {},
): RetrievalResult[] {
  const k = normalizeNonNegativeNumber(options.k, DEFAULT_RRF_K);
  const topK = normalizePositiveInteger(options.topK, DEFAULT_TOP_K);
  const injectionPenalty = normalizeNonNegativeNumber(options.injectionPenalty, DEFAULT_INJECTION_PENALTY);
  const fusedByChunkId = new Map<string, FusedHit>();

  addRankedResults(fusedByChunkId, vectorResults, k);
  addRankedResults(fusedByChunkId, bm25Results, k);

  const fusedResults = Array.from(fusedByChunkId.values()).map(({ hit, score }) => ({
    ...hit,
    score: hit.injectionRisk ? score * injectionPenalty : score,
  }));

  if (fusedResults.length === 0 || fusedResults.every((result) => result.injectionRisk)) {
    return [];
  }

  return fusedResults.sort((left, right) => right.score - left.score).slice(0, topK);
}

function addRankedResults(fusedByChunkId: Map<string, FusedHit>, results: SearchHit[], k: number): void {
  const seenChunkIds = new Set<string>();

  for (const [index, hit] of results.entries()) {
    if (seenChunkIds.has(hit.chunkId)) {
      continue;
    }

    seenChunkIds.add(hit.chunkId);

    const rank = index + 1;
    const scoreContribution = 1 / (k + rank);
    const existing = fusedByChunkId.get(hit.chunkId);

    if (existing) {
      existing.score += scoreContribution;
      continue;
    }

    fusedByChunkId.set(hit.chunkId, {
      hit,
      score: scoreContribution,
    });
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return value;
}
