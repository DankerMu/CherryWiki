import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { normalizeLabel } from './normalize-label.js';

export interface GraphQueryNode {
  id: string;
  node_key: string;
  stable_key: string;
  label: string;
  node_type: string | null;
  description: string | null;
  space_id: string;
  community_id: string | null;
  score: number;
}

export interface GraphQueryEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  confidence_label: string;
  effective_confidence_score: number | null;
  evidence_count: number;
  space_id: string;
}

export interface GraphPath {
  nodes: GraphQueryNode[];
  edges: GraphQueryEdge[];
  total_confidence: number;
}

export interface GraphEvidenceRef {
  id: string;
  page_id: string | null;
  page_version_id: string | null;
  source_document_id: string | null;
  quote_text: string | null;
  confidence_contribution: number | null;
}

export interface GraphCommunitySummary {
  id: string;
  community_key: string;
  label: string | null;
  summary: string | null;
  node_count: number;
}

export type ActiveGraphifyRunIds = Map<string, string>;

type QueryResult<T> = T[] | { rows?: T[] };
type RawNodeRow = Omit<GraphQueryNode, 'description' | 'score'> & {
  description?: string | null;
  score?: number | string | null;
};
type RawEdgeRow = Omit<GraphQueryEdge, 'effective_confidence_score' | 'evidence_count'> & {
  effective_confidence_score?: number | string | null;
  evidence_count?: number | string | null;
};
type RawPathRow = {
  nodes_json?: unknown;
  edges_json?: unknown;
};
type RawNeighborsRow = {
  nodes_json?: unknown;
  edges_json?: unknown;
};
type RawCommunityRow = Omit<GraphCommunitySummary, 'node_count'> & {
  node_count?: number | string | null;
};
type RawEvidenceRefRow = Omit<GraphEvidenceRef, 'confidence_contribution'> & {
  confidence_contribution?: number | string | null;
};

const DEFAULT_TOP_K = 20;
const MAX_PATH_RESULTS = 50;
const MAX_PATH_INTERMEDIATE_ROWS = 500;
const MAX_NEIGHBOR_RESULTS = 200;
const MAX_COMMUNITY_RESULTS = 100;
const MAX_COMMUNITY_NODE_RESULTS = 100;

export class GraphQueryService {
  constructor(private readonly db: NodePgDatabase) {}

  async searchNodes(
    query: string,
    spaceIds: string[],
    activeRunIds: ActiveGraphifyRunIds,
    topK = DEFAULT_TOP_K,
  ): Promise<GraphQueryNode[]> {
    const activeScope = activeGraphScope(spaceIds, activeRunIds);
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0 || activeScope.spaceIds.length === 0) {
      return [];
    }

    const normalizedQuery = normalizeLabel(trimmedQuery);
    const limit = normalizePositiveInt(topK, DEFAULT_TOP_K);
    const result = await this.db.execute<RawNodeRow>(sql`
      select
        id,
        node_key,
        stable_key,
        label,
        type as node_type,
        null::text as description,
        space_id,
        community_id,
        greatest(
          similarity(label, ${trimmedQuery}),
          case when norm_label = ${normalizedQuery} then 1.0 else 0.0 end
        ) as score
      from graph_nodes
      where space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
        and graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
        and (
          label % ${trimmedQuery}
          or norm_label = ${normalizedQuery}
          or label ilike '%' || ${trimmedQuery} || '%'
        )
      order by score desc, label asc
      limit ${limit}
    `);

    return rowsFromResult<RawNodeRow>(result).map(toGraphQueryNode);
  }

  async findPath(
    sourceNodeId: string,
    targetNodeId: string,
    maxHops: number,
    spaceIds: string[],
    activeRunIds: ActiveGraphifyRunIds,
  ): Promise<GraphPath[]> {
    const activeScope = activeGraphScope(spaceIds, activeRunIds);
    const depthLimit = normalizePositiveInt(maxHops, 1);
    if (sourceNodeId.trim().length === 0 || targetNodeId.trim().length === 0 || activeScope.spaceIds.length === 0) {
      return [];
    }

    const result = await this.db.execute<RawPathRow>(sql`
      with recursive paths as (
        select
          n.id as current_node_id,
          array[n.id]::text[] as node_ids,
          array[]::text[] as edge_ids,
          0 as depth,
          1::double precision as total_confidence
        from graph_nodes n
        where n.id = ${sourceNodeId}
          and n.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and n.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])

        union all

        select
          next_node.id as current_node_id,
          paths.node_ids || next_node.id,
          paths.edge_ids || e.id,
          paths.depth + 1,
          paths.total_confidence
            * coalesce(e.effective_confidence_score, 0)
            * ln((1 + greatest(e.evidence_count, 0))::double precision) as total_confidence
        from paths
        join graph_edges e
          on e.source_node_id = paths.current_node_id
          or e.target_node_id = paths.current_node_id
        join graph_nodes next_node
          on next_node.id = case
            when e.source_node_id = paths.current_node_id then e.target_node_id
            else e.source_node_id
          end
        where paths.depth < ${depthLimit}
          and e.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and e.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
          and next_node.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and next_node.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
          and not next_node.id = any(paths.node_ids)
      ),
      candidate_paths as (
        select node_ids, edge_ids, depth, total_confidence
        from paths
        where current_node_id = ${targetNodeId}
          and depth > 0
        order by depth asc, total_confidence desc
        limit ${MAX_PATH_INTERMEDIATE_ROWS}
      ),
      distinct_paths as (
        select distinct on (node_ids, edge_ids) node_ids, edge_ids, depth, total_confidence
        from candidate_paths
        order by node_ids, edge_ids, depth asc, total_confidence desc
      ),
      limited_paths as (
        select node_ids, edge_ids, depth, total_confidence
        from distinct_paths
        order by depth asc, total_confidence desc
        limit ${MAX_PATH_RESULTS}
      )
      select
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', n.id,
            'node_key', n.node_key,
            'stable_key', n.stable_key,
            'label', n.label,
            'node_type', n.type,
            'description', null,
            'space_id', n.space_id,
            'community_id', n.community_id,
            'score', 1
          ) order by node_ord.ordinality), '[]'::jsonb)
          from unnest(limited_paths.node_ids) with ordinality as node_ord(id, ordinality)
          join graph_nodes n on n.id = node_ord.id
        ) as nodes_json,
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id,
            'source_node_id', e.source_node_id,
            'target_node_id', e.target_node_id,
            'relation_type', e.relation_type,
            'confidence_label', e.confidence_label,
            'effective_confidence_score', e.effective_confidence_score,
            'evidence_count', e.evidence_count,
            'space_id', e.space_id
          ) order by edge_ord.ordinality), '[]'::jsonb)
          from unnest(limited_paths.edge_ids) with ordinality as edge_ord(id, ordinality)
          join graph_edges e on e.id = edge_ord.id
        ) as edges_json
      from limited_paths
      order by depth asc, total_confidence desc
    `);

    const paths = rowsFromResult<RawPathRow>(result).map(toGraphPath);
    return this.filterPathsByACL(paths, activeScope.spaceIds).sort(
      (left, right) =>
        left.edges.length - right.edges.length || right.total_confidence - left.total_confidence,
    );
  }

  async getNeighbors(
    nodeId: string,
    hops: number,
    spaceIds: string[],
    activeRunIds: ActiveGraphifyRunIds,
  ): Promise<{ nodes: GraphQueryNode[]; edges: GraphQueryEdge[] }> {
    const activeScope = activeGraphScope(spaceIds, activeRunIds);
    const depthLimit = normalizePositiveInt(hops, 1);
    if (nodeId.trim().length === 0 || activeScope.spaceIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    const result = await this.db.execute<RawNeighborsRow>(sql`
      with recursive expansion as (
        select
          n.id as current_node_id,
          array[n.id]::text[] as node_ids,
          array[]::text[] as edge_ids,
          0 as depth
        from graph_nodes n
        where n.id = ${nodeId}
          and n.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and n.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])

        union all

        select
          next_node.id as current_node_id,
          expansion.node_ids || next_node.id,
          expansion.edge_ids || e.id,
          expansion.depth + 1
        from expansion
        join graph_edges e
          on e.source_node_id = expansion.current_node_id
          or e.target_node_id = expansion.current_node_id
        join graph_nodes next_node
          on next_node.id = case
            when e.source_node_id = expansion.current_node_id then e.target_node_id
            else e.source_node_id
          end
        where expansion.depth < ${depthLimit}
          and e.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and e.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
          and next_node.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and next_node.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
          and not next_node.id = any(expansion.node_ids)
      ),
      node_ids as (
        select id
        from (
          select distinct unnest(node_ids) as id from expansion
        ) distinct_nodes
        order by case when id = ${nodeId} then 0 else 1 end, id asc
        limit ${MAX_NEIGHBOR_RESULTS}
      ),
      edge_ids as (
        select id
        from (
          select distinct unnest(edge_ids) as id from expansion
        ) distinct_edges
        order by id asc
        limit ${MAX_NEIGHBOR_RESULTS}
      )
      select
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', n.id,
            'node_key', n.node_key,
            'stable_key', n.stable_key,
            'label', n.label,
            'node_type', n.type,
            'description', null,
            'space_id', n.space_id,
            'community_id', n.community_id,
            'score', 1
          ) order by n.label asc), '[]'::jsonb)
          from node_ids
          join graph_nodes n on n.id = node_ids.id
        ) as nodes_json,
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id,
            'source_node_id', e.source_node_id,
            'target_node_id', e.target_node_id,
            'relation_type', e.relation_type,
            'confidence_label', e.confidence_label,
            'effective_confidence_score', e.effective_confidence_score,
            'evidence_count', e.evidence_count,
            'space_id', e.space_id
          ) order by e.id asc), '[]'::jsonb)
          from edge_ids
          join graph_edges e on e.id = edge_ids.id
        ) as edges_json
    `);

    const [row] = rowsFromResult<RawNeighborsRow>(result);
    if (row === undefined) {
      return { nodes: [], edges: [] };
    }

    return {
      nodes: parseNodeArray(row.nodes_json).filter((node) => activeScope.spaceIds.includes(node.space_id)),
      edges: parseEdgeArray(row.edges_json).filter((edge) => activeScope.spaceIds.includes(edge.space_id)),
    };
  }

  async getCommunities(
    spaceIds: string[],
    activeRunIds: ActiveGraphifyRunIds,
  ): Promise<GraphCommunitySummary[]> {
    const activeScope = activeGraphScope(spaceIds, activeRunIds);
    if (activeScope.spaceIds.length === 0) {
      return [];
    }

    const result = await this.db.execute<RawCommunityRow>(sql`
      select id, community_key, label, summary, node_count
      from graph_communities
      where space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
        and graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
      order by node_count desc, label asc nulls last, community_key asc
      limit ${MAX_COMMUNITY_RESULTS}
    `);

    return rowsFromResult<RawCommunityRow>(result).map((row) => ({
      id: row.id,
      community_key: row.community_key,
      label: row.label,
      summary: row.summary,
      node_count: normalizeNumber(row.node_count, 0),
    }));
  }

  async getCommunityNodes(
    communityId: string,
    spaceIds: string[],
    activeRunIds: ActiveGraphifyRunIds,
  ): Promise<GraphQueryNode[]> {
    const activeScope = activeGraphScope(spaceIds, activeRunIds);
    if (communityId.trim().length === 0 || activeScope.spaceIds.length === 0) {
      return [];
    }

    const result = await this.db.execute<RawNodeRow>(sql`
      select
        id,
        node_key,
        stable_key,
        label,
        type as node_type,
        null::text as description,
        space_id,
        community_id,
        1 as score
      from graph_nodes
      where community_id = ${communityId}
        and space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
        and graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
      order by label asc
      limit ${MAX_COMMUNITY_NODE_RESULTS}
    `);

    return rowsFromResult<RawNodeRow>(result).map(toGraphQueryNode);
  }

  async getEvidenceRefs(edgeId: string, spaceIds: string[]): Promise<GraphEvidenceRef[]> {
    const allowedSpaceIds = uniqueNonEmpty(spaceIds);
    if (edgeId.trim().length === 0 || allowedSpaceIds.length === 0) {
      return [];
    }

    const result = await this.db.execute<RawEvidenceRefRow>(sql`
      select
        refs.id,
        refs.page_id,
        refs.page_version_id,
        refs.source_document_id,
        refs.quote_text,
        refs.confidence_contribution
      from graph_evidence_refs refs
      join graph_edges edge_acl on edge_acl.id = refs.edge_id
      left join wiki_pages pages on pages.id = refs.page_id
      left join source_documents source_docs on source_docs.id = refs.source_document_id
      where refs.edge_id = ${edgeId}
        and edge_acl.space_id = any(${toPgTextArray(allowedSpaceIds)}::text[])
      order by refs.created_at asc, refs.id asc
    `);

    return rowsFromResult<RawEvidenceRefRow>(result).map((row) => ({
      id: row.id,
      page_id: row.page_id,
      page_version_id: row.page_version_id,
      source_document_id: row.source_document_id,
      quote_text: row.quote_text,
      confidence_contribution: nullableNumber(row.confidence_contribution),
    }));
  }

  filterPathsByACL(paths: GraphPath[], allowedSpaceIds: string[]): GraphPath[] {
    const allowed = new Set(uniqueNonEmpty(allowedSpaceIds));
    if (allowed.size === 0) {
      return [];
    }

    return paths.filter((path) => {
      const nodesAllowed = path.nodes.every((node) => allowed.has(node.space_id));
      const edgesAllowed = path.edges.every((edge) => allowed.has(edge.space_id));
      return nodesAllowed && edgesAllowed;
    });
  }
}

function toGraphPath(row: RawPathRow): GraphPath {
  const nodes = parseNodeArray(row.nodes_json);
  const edges = parseEdgeArray(row.edges_json);
  return {
    nodes,
    edges,
    total_confidence: scorePath(edges),
  };
}

function scorePath(edges: GraphQueryEdge[]): number {
  if (edges.length === 0) {
    return 0;
  }

  return edges.reduce((total, edge) => {
    const confidence = edge.effective_confidence_score ?? 0;
    return total * confidence * Math.log(1 + edge.evidence_count);
  }, 1);
}

function toGraphQueryNode(row: RawNodeRow): GraphQueryNode {
  return {
    id: row.id,
    node_key: row.node_key,
    stable_key: row.stable_key,
    label: row.label,
    node_type: row.node_type,
    description: row.description ?? null,
    space_id: row.space_id,
    community_id: row.community_id,
    score: normalizeNumber(row.score, 0),
  };
}

function toGraphQueryEdge(row: RawEdgeRow): GraphQueryEdge {
  return {
    id: row.id,
    source_node_id: row.source_node_id,
    target_node_id: row.target_node_id,
    relation_type: row.relation_type,
    confidence_label: row.confidence_label,
    effective_confidence_score: nullableNumber(row.effective_confidence_score),
    evidence_count: normalizeNumber(row.evidence_count, 0),
    space_id: row.space_id,
  };
}

function parseNodeArray(value: unknown): GraphQueryNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRawNodeRow).map(toGraphQueryNode);
}

function parseEdgeArray(value: unknown): GraphQueryEdge[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRawEdgeRow).map(toGraphQueryEdge);
}

function rowsFromResult<T>(result: QueryResult<T>): T[] {
  if (Array.isArray(result)) {
    return result;
  }

  return result.rows ?? [];
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function activeGraphScope(
  spaceIds: string[],
  activeRunIds: ActiveGraphifyRunIds,
): { spaceIds: string[]; runIds: string[] } {
  const entries = uniqueNonEmpty(spaceIds)
    .map((spaceId) => {
      const runId = activeRunIds.get(spaceId)?.trim() ?? '';
      return { spaceId, runId };
    })
    .filter((entry) => entry.runId.length > 0);

  return {
    spaceIds: entries.map((entry) => entry.spaceId),
    runIds: [...new Set(entries.map((entry) => entry.runId))],
  };
}

function normalizePositiveInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeNumber(value: number | string | null | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function nullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeNumber(value, 0);
}

function isRawNodeRow(value: unknown): value is RawNodeRow {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.node_key) &&
    isString(value.stable_key) &&
    isString(value.label) &&
    (isString(value.node_type) || value.node_type === null) &&
    isString(value.space_id) &&
    (isString(value.community_id) || value.community_id === null)
  );
}

function isRawEdgeRow(value: unknown): value is RawEdgeRow {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.source_node_id) &&
    isString(value.target_node_id) &&
    isString(value.relation_type) &&
    isString(value.confidence_label) &&
    isString(value.space_id)
  );
}

function toPgTextArray(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
