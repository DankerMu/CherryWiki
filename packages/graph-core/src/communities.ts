import type { GraphCommunity, GraphNode } from './types.js';

export function mergeCommunities(nodes: GraphNode[]): GraphCommunity[] {
  const groups = new Map<string, number>();
  for (const node of nodes) {
    if (node.community === null) {
      continue;
    }

    groups.set(node.community, (groups.get(node.community) ?? 0) + 1);
  }

  return Array.from(groups.entries()).map(([communityKey, nodeCount]) => ({
    community_key: communityKey,
    label: communityKey,
    node_count: nodeCount,
  }));
}
