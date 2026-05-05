import 'reflect-metadata';

import { retrieveGraphCandidates } from '@cherrygraph/rag-core';
import type { GraphPath, GraphQueryEdge, GraphQueryNode, GraphQueryService } from '@cherrygraph/graph-core';
import { describe, expect, it } from 'vitest';

describe('confidence policy', () => {
  it('keeps INFERRED relationships and annotates them in graph context', async () => {
    const candidates = await retrieveGraphCandidates(
      {
        query: 'A depends on B',
        spaceIds: ['space-1'],
        activeRunIds: new Map([['space-1', 'run-1']]),
      },
      createGraphQueryService([
        createPath({
          edges: [createEdge({ confidence_label: 'INFERRED' })],
          total_confidence: 0.7,
        }),
      ]),
    );

    const path = candidates.find((candidate) => candidate.type === 'graph_path');
    expect(path?.confidence_label).toBe('INFERRED');
    expect(path?.content).toContain('推断');
  });

  it('excludes AMBIGUOUS paths when the policy is exclude', async () => {
    const candidates = await retrieveGraphCandidates(
      {
        query: 'A depends on B',
        spaceIds: ['space-1'],
        activeRunIds: new Map([['space-1', 'run-1']]),
        ambiguousEdgePolicy: 'exclude',
      },
      createGraphQueryService([
        createPath({
          edges: [createEdge({ confidence_label: 'AMBIGUOUS' })],
          total_confidence: 0.4,
        }),
      ]),
    );

    expect(candidates.some((candidate) => candidate.type === 'graph_path')).toBe(false);
  });
});

function createGraphQueryService(paths: GraphPath[]): GraphQueryService {
  return {
    searchNodes: () => Promise.resolve([createNode({ id: 'node-a', label: 'A' }), createNode({ id: 'node-b', label: 'B' })]),
    findPath: () => Promise.resolve(paths),
  } as unknown as GraphQueryService;
}

function createNode(overrides: Partial<GraphQueryNode> = {}): GraphQueryNode {
  return {
    id: 'node-a',
    node_key: 'A',
    stable_key: 'entity:a',
    label: 'A',
    node_type: 'service',
    description: null,
    space_id: 'space-1',
    community_id: null,
    score: 1,
    ...overrides,
  };
}

function createEdge(overrides: Partial<GraphQueryEdge> = {}): GraphQueryEdge {
  return {
    id: 'edge-1',
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    relation_type: 'depends_on',
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.9,
    evidence_count: 2,
    space_id: 'space-1',
    ...overrides,
  };
}

function createPath(overrides: Partial<GraphPath> = {}): GraphPath {
  return {
    nodes: [createNode({ id: 'node-a', label: 'A' }), createNode({ id: 'node-b', label: 'B' })],
    edges: [createEdge()],
    total_confidence: 0.9,
    ...overrides,
  };
}
