import type { GraphCommunity, GraphEdge, GraphNode } from './types.js';

interface DetectResult {
  assignments: Map<string, string>;
  communities: GraphCommunity[];
}

// Group nodes by their pre-assigned community field (old-pipeline graph.json).
function detectFromNodeField(nodes: GraphNode[]): DetectResult {
  const assignments = new Map<string, string>();
  const order: string[] = [];
  const counts = new Map<string, number>();

  for (const node of nodes) {
    if (node.community === null) {
      continue;
    }

    assignments.set(node.id, node.community);
    if (!counts.has(node.community)) {
      order.push(node.community);
    }
    counts.set(node.community, (counts.get(node.community) ?? 0) + 1);
  }

  const communities = order.map((community_key) => ({
    community_key,
    label: community_key,
    node_count: counts.get(community_key) ?? 0,
  }));

  return { assignments, communities };
}

// Build an undirected adjacency map, ignoring edges that reference unknown nodes.
function buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set<string>());
  }

  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target) || edge.source === edge.target) {
      continue;
    }

    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  return adjacency;
}

// Pick the most frequent neighbour label; tie-break by smallest label string.
function bestLabel(neighbors: Set<string>, label: Map<string, string>): string {
  const tally = new Map<string, number>();
  for (const neighbor of neighbors) {
    const value = label.get(neighbor);
    if (value !== undefined) {
      tally.set(value, (tally.get(value) ?? 0) + 1);
    }
  }

  let chosen = '';
  let bestCount = -1;
  for (const [value, count] of tally) {
    if (count > bestCount || (count === bestCount && value < chosen)) {
      chosen = value;
      bestCount = count;
    }
  }

  return chosen;
}

// Deterministic synchronous label propagation; identical input yields identical labels.
function propagateLabels(
  sortedIds: string[],
  adjacency: Map<string, Set<string>>,
): Map<string, string> {
  const label = new Map<string, string>();
  for (const id of sortedIds) {
    label.set(id, id);
  }

  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    for (const id of sortedIds) {
      const neighbors = adjacency.get(id);
      if (neighbors === undefined || neighbors.size === 0) {
        continue;
      }

      const next = bestLabel(neighbors, label);
      if (next !== '' && next !== label.get(id)) {
        label.set(id, next);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return label;
}

function detectByPropagation(nodes: GraphNode[], edges: GraphEdge[]): DetectResult {
  const adjacency = buildAdjacency(nodes, edges);
  const sortedIds = nodes.map((node) => node.id).sort();
  const label = propagateLabels(sortedIds, adjacency);

  // Group node ids by their final label.
  const groups = new Map<string, string[]>();
  for (const id of sortedIds) {
    const value = label.get(id) ?? id;
    const members = groups.get(value);
    if (members === undefined) {
      groups.set(value, [id]);
    } else {
      members.push(id);
    }
  }

  const labelByNode = new Map(nodes.map((node) => [node.id, node.label]));
  // Order groups by node_count DESC, then smallest member id ASC -> stable ordinals.
  const orderedGroups = Array.from(groups.values()).sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    return a[0]! < b[0]! ? -1 : 1;
  });

  const assignments = new Map<string, string>();
  const communities: GraphCommunity[] = orderedGroups.map((members, index) => {
    const community_key = `community-${index + 1}`;
    for (const id of members) {
      assignments.set(id, community_key);
    }

    // Representative = highest-degree member; tie-break smallest id.
    let repId = members[0]!;
    let repDegree = adjacency.get(repId)?.size ?? 0;
    for (const id of members) {
      const degree = adjacency.get(id)?.size ?? 0;
      if (degree > repDegree || (degree === repDegree && id < repId)) {
        repId = id;
        repDegree = degree;
      }
    }

    return {
      community_key,
      label: labelByNode.get(repId) ?? repId,
      node_count: members.length,
    };
  });

  return { assignments, communities };
}

/**
 * Compute community assignments and definitions from the extracted graph.
 *
 * - If any node carries a pre-assigned `community`, preserve old grouping behaviour
 *   (community_key === the original value).
 * - Otherwise run deterministic label propagation over the undirected edge graph.
 *
 * `assignments` maps node.id -> LOCAL community_key; the persist layer maps that
 * local key to a generated graph_communities PK. No global PKs are minted here.
 */
export function detectCommunities(nodes: GraphNode[], edges: GraphEdge[]): DetectResult {
  if (nodes.length === 0) {
    return { assignments: new Map<string, string>(), communities: [] };
  }

  if (nodes.some((node) => node.community !== null)) {
    return detectFromNodeField(nodes);
  }

  return detectByPropagation(nodes, edges);
}
