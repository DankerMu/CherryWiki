import { describe, expect, it } from 'vitest';

import {
  RetrievalEvaluator,
  computeMRR,
  computeRecallAtK,
  formatComparisonTable,
  createStaticRetriever,
  type EvalEntry,
  type ModeEvaluationResult,
} from '../eval-retrieval.js';

describe('retrieval evaluation metrics', () => {
  it('computes recall@8 for full hits', () => {
    expect(computeRecallAtK(['A', 'B'], ['A', 'C', 'B', 'D'], 8)).toBe(1);
  });

  it('computes recall@8 for partial hits', () => {
    expect(computeRecallAtK(['A', 'B'], ['C', 'D', 'B'], 8)).toBe(0.5);
  });

  it('computes recall@8 with no hits', () => {
    expect(computeRecallAtK(['A', 'B'], ['C', 'D'], 8)).toBe(0);
  });

  it('computes MRR with first hit at rank 1', () => {
    expect(computeMRR(['A', 'B'], ['A', 'C', 'B'])).toBe(1);
  });

  it('computes MRR with first hit at rank 3', () => {
    expect(computeMRR(['A'], ['C', 'D', 'A'])).toBeCloseTo(1 / 3, 3);
  });

  it('computes MRR with no hits', () => {
    expect(computeMRR(['A'], ['C', 'D'])).toBe(0);
  });
});

describe('RetrievalEvaluator', () => {
  const evalSet: EvalEntry[] = [
    {
      query: 'alpha query',
      expected_pages: ['A'],
      expected_content_snippet: 'alpha',
      space_id: 'test-space',
    },
    {
      query: 'beta query',
      expected_pages: ['B'],
      expected_content_snippet: 'beta',
      space_id: 'test-space',
    },
  ];

  const deterministicRetriever = createStaticRetriever({
    wiki_only: {
      'alpha query': [
        { page: 'A', score: 1 },
        { page: 'B', score: 0.5 },
      ],
      'beta query': [
        { page: 'C', score: 1 },
        { page: 'B', score: 0.5 },
      ],
    },
    graph_rag: {
      'alpha query': [
        { page: 'A', score: 1 },
        { page: 'B', score: 0.5 },
      ],
      'beta query': [
        { page: 'B', score: 1 },
        { page: 'C', score: 0.5 },
      ],
    },
  });

  it('produces identical metrics on repeated runs with the same eval set', async () => {
    const evaluator = new RetrievalEvaluator(deterministicRetriever);

    const firstRun = await evaluator.evaluate(evalSet);
    const secondRun = await evaluator.evaluate(evalSet);

    expect(firstRun.map((result) => result.metrics)).toEqual(secondRun.map((result) => result.metrics));
  });

  it('formats the comparison table output', () => {
    const results: ModeEvaluationResult[] = [
      {
        mode: 'wiki_only',
        queries: [],
        metrics: { recallAt8: 0.65, mrr: 0.542 },
      },
      {
        mode: 'graph_rag',
        queries: [],
        metrics: { recallAt8: 0.85, mrr: 0.708 },
      },
    ];

    expect(formatComparisonTable(results)).toBe(
      [
        '┌──────────────┬───────────┬───────────┐',
        '│ Metric       │ wiki_only │ graph_rag │',
        '├──────────────┼───────────┼───────────┤',
        '│ recall@8     │ 0.650     │ 0.850     │',
        '│ MRR          │ 0.542     │ 0.708     │',
        '└──────────────┴───────────┴───────────┘',
      ].join('\n'),
    );
  });
});
