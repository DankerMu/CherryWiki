import { describe, expect, it } from 'vitest';

import { retrieve, type Bm25SearchFn, type RetrievalParams, type SearchHit, type VectorSearchFn } from '../retrieval-engine.js';
import { rrfFuse } from '../rrf-fusion.js';
import type { SourceChainJson } from '../types.js';

const sourceChainJson: SourceChainJson = {
  source_document_ids: [],
  graph_node_ids: [],
  graph_edge_ids: [],
  edge_confidences: [],
  chain_confidence: 1,
};

const baseParams: RetrievalParams = {
  query: 'alpha beta',
  queryEmbedding: [0.1, 0.2, 0.3],
  spaceIds: ['space-1'],
  tenantId: 'tenant-1',
  userGroupIds: ['editors'],
  snapshotsBySpace: { 'space-1': 'snapshot-1' },
};

describe('rrfFuse', () => {
  it('merges vector and BM25 results with unique chunk ids and RRF scores', () => {
    const results = rrfFuse(
      [makeHit('A', 0.9), makeHit('B', 0.7), makeHit('C', 0.5)],
      [makeHit('B', 0.8), makeHit('D', 0.6), makeHit('A', 0.4)],
    );

    expect(results.map((result) => result.chunkId)).toEqual(['B', 'A', 'D', 'C']);
    expect(scoreFor(results, 'A')).toBeCloseTo(1 / 61 + 1 / 63);
    expect(scoreFor(results, 'B')).toBeCloseTo(1 / 62 + 1 / 61);
    expect(scoreFor(results, 'C')).toBeCloseTo(1 / 63);
    expect(scoreFor(results, 'D')).toBeCloseTo(1 / 62);
  });

  it('deduplicates the same chunk across result lists with a combined score', () => {
    const results = rrfFuse([makeHit('A', 0.9)], [makeHit('A', 0.8)]);

    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe('A');
    expect(results[0]?.score).toBeCloseTo(1 / 61 + 1 / 61);
  });

  it('demotes injection risk chunks with the default penalty', () => {
    const results = rrfFuse([makeHit('risk', 0.9, true), makeHit('safe', 0.8)], []);

    expect(scoreFor(results, 'risk')).toBeCloseTo((1 / 61) * 0.3);
    expect(scoreFor(results, 'safe')).toBeCloseTo(1 / 62);
    expect(results[0]?.chunkId).toBe('safe');
  });

  it('returns no hits when all fused chunks have injection risk', () => {
    const results = rrfFuse([makeHit('A', 0.9, true)], [makeHit('B', 0.8, true)]);

    expect(results).toEqual([]);
  });

  it('limits results to the default top K', () => {
    const vectorResults = Array.from({ length: 15 }, (_, index) => makeHit(`chunk-${index}`, 1 - index / 100));

    const results = rrfFuse(vectorResults, []);

    expect(results).toHaveLength(8);
    expect(results.map((result) => result.chunkId)).toEqual([
      'chunk-0',
      'chunk-1',
      'chunk-2',
      'chunk-3',
      'chunk-4',
      'chunk-5',
      'chunk-6',
      'chunk-7',
    ]);
  });
});

describe('retrieve', () => {
  it('returns an empty array when both search callbacks return no results', async () => {
    await expect(retrieve(baseParams, () => Promise.resolve([]), () => Promise.resolve([]))).resolves.toEqual([]);
  });

  it('falls back to BM25 results when vector search fails', async () => {
    const bm25Hit = makeHit('bm25-only', 0.8);
    const vectorSearch: VectorSearchFn = () => Promise.reject(new Error('vector unavailable'));
    const bm25Search: Bm25SearchFn = () => Promise.resolve([bm25Hit]);

    const results = await retrieve(baseParams, vectorSearch, bm25Search);

    expect(results.map((result) => result.chunkId)).toEqual(['bm25-only']);
    expect(results[0]?.score).toBeCloseTo(1 / 61);
  });

  it('falls back to vector results when BM25 search fails', async () => {
    const vectorHit = makeHit('vector-only', 0.9);
    const vectorSearch: VectorSearchFn = () => Promise.resolve([vectorHit]);
    const bm25Search: Bm25SearchFn = () => Promise.reject(new Error('bm25 unavailable'));

    const results = await retrieve(baseParams, vectorSearch, bm25Search);

    expect(results.map((result) => result.chunkId)).toEqual(['vector-only']);
    expect(results[0]?.score).toBeCloseTo(1 / 61);
  });

  it('returns an empty array when both search callbacks fail', async () => {
    const vectorSearch: VectorSearchFn = () => Promise.reject(new Error('vector unavailable'));
    const bm25Search: Bm25SearchFn = () => Promise.reject(new Error('bm25 unavailable'));

    await expect(retrieve(baseParams, vectorSearch, bm25Search)).resolves.toEqual([]);
  });

  it('passes retrieval scope and candidate limits to both search callbacks', async () => {
    const callbackParams: Array<{ topN: number; snapshotId: string; tenantId: string; spaceId: string }> = [];
    const params = { ...baseParams, topK: 25 };

    await retrieve(
      params,
      (received) => {
        callbackParams.push(received);
        return Promise.resolve([makeHit('vector', 0.9)]);
      },
      (received) => {
        callbackParams.push(received);
        return Promise.resolve([makeHit('bm25', 0.8)]);
      },
    );

    expect(callbackParams).toHaveLength(2);
    expect(callbackParams.every((received) => received.topN === 25)).toBe(true);
    expect(callbackParams.every((received) => received.snapshotId === 'snapshot-1')).toBe(true);
    expect(callbackParams.every((received) => received.tenantId === 'tenant-1')).toBe(true);
    expect(callbackParams.every((received) => received.spaceId === 'space-1')).toBe(true);
  });

  it('fans out over selected space snapshots and preserves source space ids', async () => {
    const callbackParams: Array<{ snapshotId: string; spaceId: string }> = [];

    const results = await retrieve(
      {
        ...baseParams,
        spaceIds: ['space-1', 'space-2'],
        snapshotsBySpace: { 'space-1': 'snapshot-1', 'space-2': 'snapshot-2' },
      },
      (received) => {
        callbackParams.push(received);
        return Promise.resolve([makeHit(`vector-${received.spaceId}`, 0.9, false, received.spaceId)]);
      },
      (received) => {
        callbackParams.push(received);
        return Promise.resolve([makeHit(`bm25-${received.spaceId}`, 0.8, false, received.spaceId)]);
      },
    );

    expect(callbackParams).toEqual([
      expect.objectContaining({ spaceId: 'space-1', snapshotId: 'snapshot-1' }),
      expect.objectContaining({ spaceId: 'space-1', snapshotId: 'snapshot-1' }),
      expect.objectContaining({ spaceId: 'space-2', snapshotId: 'snapshot-2' }),
      expect.objectContaining({ spaceId: 'space-2', snapshotId: 'snapshot-2' }),
    ]);
    expect(new Set(results.map((result) => result.spaceId))).toEqual(new Set(['space-1', 'space-2']));
  });

  it('applies topK globally after multi-space fusion', async () => {
    const results = await retrieve(
      {
        ...baseParams,
        spaceIds: ['space-1', 'space-2'],
        snapshotsBySpace: { 'space-1': 'snapshot-1', 'space-2': 'snapshot-2' },
        topK: 2,
      },
      (received) =>
        Promise.resolve([
          makeHit(`vector-a-${received.spaceId}`, 0.9, false, received.spaceId),
          makeHit(`vector-b-${received.spaceId}`, 0.8, false, received.spaceId),
        ]),
      () => Promise.resolve([]),
    );

    expect(results).toHaveLength(2);
  });

  it('ranks multi-space hits by search score regardless of callback resolution order', async () => {
    const params = {
      ...baseParams,
      spaceIds: ['space-fast', 'space-slow'],
      snapshotsBySpace: { 'space-fast': 'snapshot-fast', 'space-slow': 'snapshot-slow' },
      topK: 2,
    };
    const bm25Search: Bm25SearchFn = () => Promise.resolve([]);
    const slowHighScoreVectorSearch: VectorSearchFn = async (received) => {
      if (received.spaceId === 'space-slow') {
        await delay(5);
        return [makeHit('high-score', 0.95, false, received.spaceId)];
      }

      return [makeHit('low-score', 0.1, false, received.spaceId)];
    };
    const fastHighScoreVectorSearch: VectorSearchFn = async (received) => {
      if (received.spaceId === 'space-fast') {
        await delay(5);
        return [makeHit('low-score', 0.1, false, received.spaceId)];
      }

      return [makeHit('high-score', 0.95, false, received.spaceId)];
    };

    const slowHighScoreResults = await retrieve(params, slowHighScoreVectorSearch, bm25Search);
    const fastHighScoreResults = await retrieve(params, fastHighScoreVectorSearch, bm25Search);

    expect(slowHighScoreResults.map((result) => result.chunkId)).toEqual(['high-score', 'low-score']);
    expect(fastHighScoreResults.map((result) => result.chunkId)).toEqual(['high-score', 'low-score']);
  });

  it('ignores spaces without activated snapshots', async () => {
    const searchedSpaces: string[] = [];

    await retrieve(
      {
        ...baseParams,
        spaceIds: ['space-1', 'space-2'],
        snapshotsBySpace: { 'space-1': 'snapshot-1' },
      },
      (received) => {
        searchedSpaces.push(received.spaceId);
        return Promise.resolve([]);
      },
      (received) => {
        searchedSpaces.push(received.spaceId);
        return Promise.resolve([]);
      },
    );

    expect(searchedSpaces).toEqual(['space-1', 'space-1']);
  });
});

function makeHit(chunkId: string, score: number, injectionRisk = false, spaceId = 'space-1'): SearchHit {
  return {
    chunkId,
    spaceId,
    content: `content ${chunkId}`,
    score,
    wikiPagePk: `page-${chunkId}`,
    sectionId: `section-${chunkId}`,
    sourceChainJson,
    injectionRisk,
    pageTitle: `Page ${chunkId}`,
    sectionTitle: `Section ${chunkId}`,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function scoreFor(results: Array<{ chunkId: string; score: number }>, chunkId: string): number {
  const result = results.find((candidate) => candidate.chunkId === chunkId);

  if (!result) {
    throw new Error(`Missing score for ${chunkId}`);
  }

  return result.score;
}
