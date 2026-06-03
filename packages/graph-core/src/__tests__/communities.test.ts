import { describe, expect, it } from 'vitest';

import { detectCommunities } from '../communities.js';
import type { GraphEdge, GraphNode } from '../types.js';

function node(id: string, community: string | null = null, label = id): GraphNode {
  return {
    id,
    label,
    norm_label: id,
    type: 'concept',
    community,
  };
}

function edge(source: string, target: string): GraphEdge {
  return {
    source,
    target,
    relation: 'links_to',
    confidence: 'EXTRACTED',
    confidence_score: 1,
  };
}

describe('detectCommunities', () => {
  it('returns empty result for empty nodes', () => {
    expect(detectCommunities([], [])).toEqual({
      assignments: new Map<string, string>(),
      communities: [],
    });
  });

  it('splits two disconnected 3-node clusters into two communities ordered by size', () => {
    const nodes = [
      node('a1'),
      node('a2'),
      node('a3'),
      node('b1'),
      node('b2'),
    ];
    const edges = [edge('a1', 'a2'), edge('a2', 'a3'), edge('a1', 'a3'), edge('b1', 'b2')];

    const { assignments, communities } = detectCommunities(nodes, edges);

    expect(communities).toHaveLength(2);
    // Larger cluster (3 nodes) gets community-1, smaller (2 nodes) gets community-2.
    expect(communities[0]?.node_count).toBe(3);
    expect(communities[1]?.node_count).toBe(2);

    const clusterA = communities[0]!.community_key;
    const clusterB = communities[1]!.community_key;
    expect(assignments.get('a1')).toBe(clusterA);
    expect(assignments.get('a2')).toBe(clusterA);
    expect(assignments.get('a3')).toBe(clusterA);
    expect(assignments.get('b1')).toBe(clusterB);
    expect(assignments.get('b2')).toBe(clusterB);
  });

  it('separates two dense groups joined by a single weak edge', () => {
    // Two hub-and-spoke groups linked by one weak leaf-to-leaf bridge (xc-ya).
    const nodes = [
      node('xh'),
      node('xa'),
      node('xb'),
      node('xc'),
      node('yh'),
      node('ya'),
      node('yb'),
      node('yc'),
    ];
    const edges = [
      edge('xh', 'xa'),
      edge('xh', 'xb'),
      edge('xh', 'xc'),
      edge('yh', 'ya'),
      edge('yh', 'yb'),
      edge('yh', 'yc'),
      edge('xc', 'ya'), // single weak bridge
    ];

    const { assignments, communities } = detectCommunities(nodes, edges);

    expect(communities.length).toBeGreaterThanOrEqual(2);
    // Each group's core (hub + its own non-bridge leaves) stays together.
    expect(assignments.get('xh')).toBe(assignments.get('xa'));
    expect(assignments.get('xh')).toBe(assignments.get('xb'));
    expect(assignments.get('yh')).toBe(assignments.get('yb'));
    expect(assignments.get('yh')).toBe(assignments.get('yc'));
    expect(assignments.get('xh')).not.toBe(assignments.get('yh'));
  });

  it('treats an isolated node as its own singleton community', () => {
    const nodes = [node('a1'), node('a2'), node('lonely')];
    const edges = [edge('a1', 'a2')];

    const { assignments, communities } = detectCommunities(nodes, edges);

    expect(communities).toHaveLength(2);
    const lonelyKey = assignments.get('lonely');
    const singleton = communities.find((c) => c.community_key === lonelyKey);
    expect(singleton?.node_count).toBe(1);
    expect(assignments.get('a1')).not.toBe(lonelyKey);
  });

  it('is deterministic across repeated calls on identical input', () => {
    const nodes = [node('n1'), node('n2'), node('n3'), node('n4')];
    const edges = [edge('n1', 'n2'), edge('n3', 'n4')];

    const first = detectCommunities(nodes, edges);
    const second = detectCommunities(nodes, edges);

    expect([...first.assignments.entries()]).toEqual([...second.assignments.entries()]);
    expect(first.communities).toEqual(second.communities);
  });

  it('uses the highest-degree member label as the community label', () => {
    const nodes = [
      node('hub', null, 'Hub Node'),
      node('leaf1', null, 'Leaf 1'),
      node('leaf2', null, 'Leaf 2'),
    ];
    const edges = [edge('hub', 'leaf1'), edge('hub', 'leaf2')];

    const { communities } = detectCommunities(nodes, edges);

    expect(communities).toHaveLength(1);
    expect(communities[0]?.label).toBe('Hub Node');
  });

  describe('backward compatibility with pre-assigned node.community', () => {
    it('groups nodes by their community field', () => {
      const { assignments, communities } = detectCommunities(
        [
          node('n1', 'auth_system'),
          node('n2', 'auth_system'),
          node('n3', 'auth_system'),
          node('n4', 'ingestion'),
          node('n5', 'ingestion'),
        ],
        [],
      );

      expect(communities).toEqual([
        { community_key: 'auth_system', label: 'auth_system', node_count: 3 },
        { community_key: 'ingestion', label: 'ingestion', node_count: 2 },
      ]);
      expect(assignments.get('n1')).toBe('auth_system');
      expect(assignments.get('n4')).toBe('ingestion');
    });

    it('excludes nodes with null community while still using field mode', () => {
      const { assignments, communities } = detectCommunities(
        [node('n1', null), node('n2', 'auth_system')],
        [],
      );

      expect(communities).toEqual([
        { community_key: 'auth_system', label: 'auth_system', node_count: 1 },
      ]);
      expect(assignments.has('n1')).toBe(false);
      expect(assignments.get('n2')).toBe('auth_system');
    });
  });
});
