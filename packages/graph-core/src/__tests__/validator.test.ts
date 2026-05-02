import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode, GraphOutput } from '../types.js';
import { MAX_EDGES, MAX_NODES, validateGraphOutput } from '../validator.js';

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    label: 'Node 1',
    norm_label: 'node 1',
    type: 'concept',
    community: null,
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

function graph(overrides: Partial<GraphOutput> = {}): GraphOutput {
  return {
    nodes: [node(), node({ id: 'n2', label: 'Node 2', norm_label: 'node 2' })],
    edges: [edge()],
    hyperedges: [],
    ...overrides,
  };
}

describe('validateGraphOutput', () => {
  it('rejects empty nodes', () => {
    const result = validateGraphOutput(graph({ nodes: [] }));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('graph.json must contain at least one node');
  });

  it('warns and excludes edges with dangling source refs', () => {
    const result = validateGraphOutput(graph({ edges: [edge({ source: 'missing_node' })] }));

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('edge references non-existent source node: missing_node');
    expect(result.validEdges).toHaveLength(0);
  });

  it('warns and excludes edges with dangling target refs', () => {
    const result = validateGraphOutput(graph({ edges: [edge({ target: 'missing_node' })] }));

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('edge references non-existent target node: missing_node');
    expect(result.validEdges).toHaveLength(0);
  });

  it('normalizes invalid confidence labels to AMBIGUOUS', () => {
    const result = validateGraphOutput(
      graph({ edges: [edge({ confidence: 'UNKNOWN', confidence_score: 0.9 })] }),
    );

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('invalid confidence label "UNKNOWN" normalized to AMBIGUOUS');
    expect(result.validEdges).toHaveLength(1);
    expect(result.validEdges[0]?.confidence).toBe('AMBIGUOUS');
    expect(result.validEdges[0]?.confidence_score).toBe(0.2);
  });

  it('warns and excludes edges missing required fields', () => {
    const result = validateGraphOutput(graph({ edges: [edge({ source: '', relation: '' })] }));

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('edge missing required field: source=, target=n2, relation=');
    expect(result.validEdges).toHaveLength(0);
  });

  it('rejects node labels longer than 256 characters', () => {
    const result = validateGraphOutput(
      graph({
        nodes: [node({ label: 'a'.repeat(257) })],
        edges: [],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('node label exceeds 256 chars: n1');
    expect(result.validNodes).toHaveLength(0);
  });

  it('rejects node count above the configured limit', () => {
    const result = validateGraphOutput(
      graph({ nodes: new Array<GraphNode>(MAX_NODES + 1), edges: [] }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`node count ${MAX_NODES + 1} exceeds limit ${MAX_NODES}`);
  });

  it('rejects edge count above the configured limit', () => {
    const result = validateGraphOutput(graph({ edges: new Array<GraphEdge>(MAX_EDGES + 1) }));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`edge count ${MAX_EDGES + 1} exceeds limit ${MAX_EDGES}`);
  });

  it('supports custom node and edge limits', () => {
    const nodeLimited = validateGraphOutput(graph(), { maxNodes: 1 });
    const edgeLimited = validateGraphOutput(
      graph({ edges: [edge(), edge({ relation: 'depends_on' })] }),
      { maxEdges: 1 },
    );

    expect(nodeLimited.valid).toBe(false);
    expect(nodeLimited.errors).toContain('node count 2 exceeds limit 1');
    expect(edgeLimited.valid).toBe(false);
    expect(edgeLimited.errors).toContain('edge count 2 exceeds limit 1');
  });
});
