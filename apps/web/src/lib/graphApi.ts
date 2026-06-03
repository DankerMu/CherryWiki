import { api } from './api';

export type GraphNode = {
  id: string;
  node_key: string;
  stable_key: string;
  label: string;
  node_type: string | null;
  description?: string | null;
  source_files?: string[];
  space_id: string;
  community_id: string | null;
  score: number;
};

export type GraphNodeRelation = {
  direction: 'out' | 'in';
  relation_type: string;
  confidence_label: string;
  effective_confidence_score: number | null;
  neighbor_id: string;
  neighbor_label: string;
};

export type GraphNodeEvidence = {
  id: string;
  page_id: string | null;
  source_document_id: string | null;
  quote_text: string;
};

export type GraphNodeWikiPage = {
  title: string;
  content_markdown: string;
};

export type GraphNodeDetail = {
  id: string;
  node_key: string;
  stable_key: string;
  label: string;
  node_type: string | null;
  space_id: string;
  community_id: string | null;
  score: number;
  source_files: string[];
  relations: GraphNodeRelation[];
  evidence: GraphNodeEvidence[];
  wiki_page: GraphNodeWikiPage | null;
};

export type GraphEdge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship: string;
  confidence_label: string;
  effective_confidence_score: number | null;
  evidence_count: number;
  space_id: string;
};

export type GraphCommunity = {
  id: string;
  community_key: string;
  label: string | null;
  summary: string | null;
  node_count: number;
};

export type GraphSearchResponse = {
  nodes: GraphNode[];
  total: number;
};

export type GraphNeighborsResponse = {
  center_node: GraphNode | null;
  neighbors: Array<{
    node: GraphNode;
    edge: GraphEdge | null;
    hop: number;
  }>;
};

export type GraphCommunitiesResponse = {
  communities: GraphCommunity[];
};

export type GraphCommunityNodesResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
};

export function searchGraphNodes(input: {
  spaceId: string;
  query: string;
  limit?: number;
}): Promise<GraphSearchResponse> {
  return api.get<GraphSearchResponse>('/graph/nodes', {
    q: input.query,
    space_id: input.spaceId,
    top_k: input.limit ?? 20,
  });
}

export function getGraphNeighbors(input: {
  nodeId: string;
  spaceId: string;
  hops?: number;
}): Promise<GraphNeighborsResponse> {
  return api.get<GraphNeighborsResponse>(`/graph/nodes/${encodeURIComponent(input.nodeId)}/neighbors`, {
    hops: input.hops ?? 1,
    space_id: input.spaceId,
  });
}

export function getGraphNodeDetail(input: {
  nodeId: string;
  spaceId: string;
}): Promise<GraphNodeDetail> {
  return api.get<GraphNodeDetail>(`/graph/nodes/${encodeURIComponent(input.nodeId)}/detail`, {
    space_id: input.spaceId,
  });
}

export function getGraphCommunities(spaceId: string): Promise<GraphCommunitiesResponse> {
  return api.get<GraphCommunitiesResponse>('/graph/communities', {
    space_id: spaceId,
  });
}

export function getGraphCommunityNodes(
  communityId: string,
  spaceId: string,
): Promise<GraphCommunityNodesResponse> {
  return api.get<GraphCommunityNodesResponse>(
    `/graph/communities/${encodeURIComponent(communityId)}/nodes`,
    { space_id: spaceId },
  );
}
