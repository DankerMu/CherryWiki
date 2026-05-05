import type { RetrievalResult, SearchHit } from './retrieval-engine.js';
import type { GraphCandidate } from './types.js';

const DEFAULT_RRF_K = 60;
const DEFAULT_TOP_K = 8;
const DEFAULT_INJECTION_PENALTY = 0.3;

type FusedHit = {
  hit: SearchHit;
  score: number;
};

export type FusedRetrievalResult =
  | { type: 'wiki_chunk'; hit: SearchHit; score: number }
  | { type: 'graph'; candidate: GraphCandidate; score: number };

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

export function rrfFuseThreeSource(
  vectorResults: SearchHit[],
  bm25Results: SearchHit[],
  graphCandidates: GraphCandidate[],
  options: { k?: number; topK?: number; injectionPenalty?: number } = {},
): FusedRetrievalResult[] {
  const k = normalizeNonNegativeNumber(options.k, DEFAULT_RRF_K);
  const topK = normalizePositiveInteger(options.topK, DEFAULT_TOP_K);
  const injectionPenalty = normalizeNonNegativeNumber(options.injectionPenalty, DEFAULT_INJECTION_PENALTY);
  const fusedByChunkId = new Map<string, FusedHit>();

  addRankedResults(fusedByChunkId, vectorResults, k);
  addRankedResults(fusedByChunkId, bm25Results, k);

  const wikiResults: Array<Extract<FusedRetrievalResult, { type: 'wiki_chunk' }>> = Array.from(
    fusedByChunkId.values(),
  ).map(({ hit, score }) => ({
    type: 'wiki_chunk',
    hit,
    score: hit.injectionRisk ? score * injectionPenalty : score,
  }));
  const graphResults = rankGraphCandidates(graphCandidates, k);
  const fusedResults = [...wikiResults, ...graphResults];

  if (fusedResults.length === 0) {
    return [];
  }

  if (
    graphResults.length === 0 &&
    wikiResults.length > 0 &&
    wikiResults.every((result) => result.hit.injectionRisk)
  ) {
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
      if (hit.injectionRisk) {
        existing.hit = { ...existing.hit, injectionRisk: true };
      }
      continue;
    }

    fusedByChunkId.set(hit.chunkId, {
      hit,
      score: scoreContribution,
    });
  }
}

function rankGraphCandidates(graphCandidates: GraphCandidate[], k: number): FusedRetrievalResult[] {
  const seenCandidateIds = new Set<string>();
  const fusedResults: FusedRetrievalResult[] = [];

  for (const [index, candidate] of graphCandidates.entries()) {
    const candidateKey = `${candidate.type}:${candidate.id}`;
    if (seenCandidateIds.has(candidateKey)) {
      continue;
    }

    seenCandidateIds.add(candidateKey);
    const rank = index + 1;
    fusedResults.push({
      type: 'graph',
      candidate,
      score: (1 / (k + rank)) * graphConfidenceFactor(candidate),
    });
  }

  return fusedResults;
}

function graphConfidenceFactor(candidate: GraphCandidate): number {
  const confidence = Math.max(0, candidate.effective_confidence_score);
  const evidenceCount = Math.max(0, candidate.evidence_count);

  return confidence * Math.log(1 + evidenceCount);
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
