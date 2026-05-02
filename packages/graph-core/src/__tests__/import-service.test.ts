import { describe, expect, it } from 'vitest';

import { GraphImportService } from '../import-service.js';
import { computeStableKey } from '../stable-key.js';
import type { GraphEdge, GraphNode, ValidGraphOutput } from '../types.js';

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    label: 'Node 1',
    norm_label: 'node_1',
    type: 'concept',
    community: 'auth_system',
    source_file: 'auth.md',
    source_location: 'L1',
    ...overrides,
  };
}

function edge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    source: 'n1',
    target: 'n2',
    relation: 'links_to',
    confidence: 'EXTRACTED',
    confidence_score: 1,
    ...overrides,
  };
}

function graph(
  validNodes: GraphNode[] = [node(), node({ id: 'n2', label: 'Node 2', norm_label: 'node_2' })],
): ValidGraphOutput {
  return {
    validNodes,
    validEdges: validNodes.length >= 2 ? [edge()] : [],
  };
}

describe('GraphImportService', () => {
  it('prepares first run operations with all nodes created and no matches', () => {
    const operation = new GraphImportService().prepareImport('space-1', graph());

    expect(operation.nodes).toHaveLength(2);
    expect(operation.edges).toHaveLength(1);
    expect(operation.communities).toEqual([
      { community_key: 'auth_system', label: 'auth_system', node_count: 2 },
    ]);
    expect(operation.aliases).toHaveLength(2);
    expect(operation.nodes[0]?.sourceRefsJson).toEqual([{ file: 'auth.md', location: 'L1' }]);
    expect(operation.edges[0]).toMatchObject({
      confidenceLabel: 'EXTRACTED',
      rawScore: 1,
      effectiveScore: 0.9,
      evidenceCount: 1,
    });
    expect(operation.stats).toEqual({
      nodesCreated: 2,
      nodesMatched: 0,
      edgesCreated: 1,
      communitiesCreated: 1,
      aliasesCreated: 2,
      warnings: [],
      shrinkDetected: false,
    });
  });

  it('counts matches when stable keys already exist', () => {
    const existing = new Set<string>([
      computeStableKey('space-1', 'node_1', 'concept'),
      computeStableKey('space-1', 'node_2', 'concept'),
    ]);

    const operation = new GraphImportService().prepareImport('space-1', graph(), existing);

    expect(operation.stats.nodesCreated).toBe(2);
    expect(operation.stats.nodesMatched).toBe(2);
  });

  it('detects shrink guard above 80 percent deviation and skips import operations', () => {
    const validNodes = Array.from({ length: 15 }, (_, index) =>
      node({ id: `n${index}`, label: `Node ${index}`, norm_label: `node_${index}` }),
    );

    const operation = new GraphImportService().prepareImport(
      'space-1',
      graph(validNodes),
      new Set<string>(),
      100,
    );

    expect(operation.nodes).toEqual([]);
    expect(operation.edges).toEqual([]);
    expect(operation.communities).toEqual([]);
    expect(operation.aliases).toEqual([]);
    expect(operation.stats.shrinkDetected).toBe(true);
    expect(operation.stats.warnings).toEqual(['shrink guard: 85% deviation']);
  });

  it('proceeds when shrink deviation is within threshold', () => {
    const validNodes = Array.from({ length: 25 }, (_, index) =>
      node({ id: `n${index}`, label: `Node ${index}`, norm_label: `node_${index}` }),
    );

    const operation = new GraphImportService().prepareImport(
      'space-1',
      graph(validNodes),
      new Set<string>(),
      100,
    );

    expect(operation.nodes).toHaveLength(25);
    expect(operation.stats.shrinkDetected).toBe(false);
  });

  it('supports importRun as a pure wrapper around prepareImport', () => {
    const existingStableKeys = new Set<string>([computeStableKey('space-1', 'node_1', 'concept')]);

    const operation = new GraphImportService().importRun('tenant-1', 'space-1', 'run-1', graph(), {
      existingStableKeys,
    });

    expect(operation).toMatchObject({
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      runId: 'run-1',
    });
    expect(operation.stats.nodesMatched).toBe(1);
  });
});
