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
  source_files: string[];
}

export interface GraphNodeRelation {
  direction: 'out' | 'in';
  relation_type: string;
  confidence_label: string;
  effective_confidence_score: number | null;
  neighbor_id: string;
  neighbor_label: string;
}

export interface GraphNodeWikiPage {
  title: string;
  content_markdown: string;
}

export interface GraphNodeDetail {
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
  evidence: GraphEvidenceRef[];
  wiki_page: GraphNodeWikiPage | null;
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
type RawNodeRow = Omit<GraphQueryNode, 'description' | 'score' | 'source_files'> & {
  description?: string | null;
  score?: number | string | null;
  source_refs_json?: unknown;
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
type RawCommunityNodesRow = {
  nodes_json?: unknown;
  edges_json?: unknown;
  truncated?: boolean | null;
};
type RawCommunityRow = Omit<GraphCommunitySummary, 'node_count'> & {
  node_count?: number | string | null;
};
type RawEvidenceRefRow = Omit<GraphEvidenceRef, 'confidence_contribution'> & {
  confidence_contribution?: number | string | null;
};
type RawNodeDetailNode = {
  id: string;
  node_key: string;
  stable_key: string;
  label: string;
  type?: string | null;
  source_refs_json?: unknown;
  space_id: string;
  community_id?: string | null;
};
type RawNodeDetailRow = {
  node_json?: unknown;
  relations_json?: unknown;
  evidence_json?: unknown;
  wiki_page_json?: unknown;
};

const DEFAULT_TOP_K = 20;
const MAX_PATH_RESULTS = 50;
const MAX_PATH_INTERMEDIATE_ROWS = 500;
const MAX_NEIGHBOR_RESULTS = 200;
const MAX_COMMUNITY_RESULTS = 100;
const MAX_COMMUNITY_NODE_RESULTS = 200;
const MAX_NODE_RELATIONS = 200;
const MAX_NODE_EVIDENCE = 10;
const MAX_WIKI_MARKDOWN_CHARS = 4000;

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
        source_refs_json,
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
            'source_refs_json', n.source_refs_json,
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
            'source_refs_json', n.source_refs_json,
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

  async getNodeDetail(
    nodeId: string,
    spaceIds: string[],
    activeRunIds: ActiveGraphifyRunIds,
  ): Promise<GraphNodeDetail | null> {
    const activeScope = activeGraphScope(spaceIds, activeRunIds);
    if (nodeId.trim().length === 0 || activeScope.spaceIds.length === 0) {
      return null;
    }

    const result = await this.db.execute<RawNodeDetailRow>(sql`
      with node as (
        select id, node_key, stable_key, label, type, source_refs_json, space_id, community_id, wiki_page_pk
        from graph_nodes
        where id = ${nodeId}
          and space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
        limit 1
      ),
      node_edges as (
        select
          e.id,
          case when e.source_node_id = node.id then 'out' else 'in' end as direction,
          e.relation_type,
          e.confidence_label,
          e.effective_confidence_score,
          case when e.source_node_id = node.id then e.target_node_id else e.source_node_id end as neighbor_id
        from graph_edges e
        join node on e.source_node_id = node.id or e.target_node_id = node.id
        where e.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and e.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
        order by e.effective_confidence_score desc nulls last, e.id asc
        limit ${MAX_NODE_RELATIONS}
      )
      select
        (select row_to_json(node) from node) as node_json,
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'direction', ne.direction,
            'relation_type', ne.relation_type,
            'confidence_label', ne.confidence_label,
            'effective_confidence_score', ne.effective_confidence_score,
            'neighbor_id', ne.neighbor_id,
            'neighbor_label', coalesce(neighbor.label, ne.neighbor_id)
          )), '[]'::jsonb)
          from node_edges ne
          left join graph_nodes neighbor on neighbor.id = ne.neighbor_id
            and neighbor.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
            and neighbor.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
        ) as relations_json,
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', refs.id,
            'page_id', refs.page_id,
            'page_version_id', refs.page_version_id,
            'source_document_id', refs.source_document_id,
            'quote_text', refs.quote_text,
            'confidence_contribution', refs.confidence_contribution
          )), '[]'::jsonb)
          from (
            select refs.id, refs.page_id, refs.page_version_id, refs.source_document_id, refs.quote_text, refs.confidence_contribution
            from graph_evidence_refs refs
            where refs.edge_id in (select id from node_edges)
              and refs.quote_text is not null
            order by refs.created_at asc, refs.id asc
            limit ${MAX_NODE_EVIDENCE}
          ) refs
        ) as evidence_json,
        (
          select jsonb_build_object(
            'title', pages.title,
            'content_markdown', left(coalesce(versions.content_markdown, ''), ${MAX_WIKI_MARKDOWN_CHARS})
          )
          from node
          join wiki_pages pages on pages.id = node.wiki_page_pk
          left join wiki_page_versions versions on versions.id = pages.current_version_id
          where node.wiki_page_pk is not null
        ) as wiki_page_json
      from node
    `);

    const [row] = rowsFromResult<RawNodeDetailRow>(result);
    if (row === undefined || !isRawNodeDetailNode(row.node_json)) {
      return null;
    }

    const node = row.node_json;
    return {
      id: node.id,
      node_key: node.node_key,
      stable_key: node.stable_key,
      label: node.label,
      node_type: node.type ?? null,
      space_id: node.space_id,
      community_id: node.community_id ?? null,
      score: 1,
      source_files: parseSourceFiles(node.source_refs_json),
      relations: parseRelations(row.relations_json),
      evidence: parseEvidenceArray(row.evidence_json),
      wiki_page: parseWikiPage(row.wiki_page_json),
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
  ): Promise<{ nodes: GraphQueryNode[]; edges: GraphQueryEdge[]; truncated: boolean }> {
    const activeScope = activeGraphScope(spaceIds, activeRunIds);
    if (communityId.trim().length === 0 || activeScope.spaceIds.length === 0) {
      return { nodes: [], edges: [], truncated: false };
    }

    const result = await this.db.execute<RawCommunityNodesRow>(sql`
      with matching_nodes as (
        select
          id,
          node_key,
          stable_key,
          label,
          type,
          source_refs_json,
          space_id,
          community_id,
          graphify_run_id,
          count(*) over () as total_count
        from graph_nodes
        where community_id = ${communityId}
          and space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
        order by label asc
        limit ${MAX_COMMUNITY_NODE_RESULTS}
      ),
      node_ids as (
        select id from matching_nodes
      ),
      community_edges as (
        select
          e.id,
          e.source_node_id,
          e.target_node_id,
          e.relation_type,
          e.confidence_label,
          e.effective_confidence_score,
          e.evidence_count,
          e.space_id
        from graph_edges e
        where e.space_id = any(${toPgTextArray(activeScope.spaceIds)}::text[])
          and e.graphify_run_id = any(${toPgTextArray(activeScope.runIds)}::text[])
          and e.source_node_id in (select id from node_ids)
          and e.target_node_id in (select id from node_ids)
        order by e.id asc
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
            'source_refs_json', n.source_refs_json,
            'space_id', n.space_id,
            'community_id', n.community_id,
            'score', 1
          ) order by n.label asc), '[]'::jsonb)
          from matching_nodes n
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
          from community_edges e
        ) as edges_json,
        coalesce((select max(total_count) from matching_nodes), 0) > ${MAX_COMMUNITY_NODE_RESULTS} as truncated
    `);

    const [row] = rowsFromResult<RawCommunityNodesRow>(result);
    if (row === undefined) {
      return { nodes: [], edges: [], truncated: false };
    }

    return {
      nodes: parseNodeArray(row.nodes_json).filter((node) => activeScope.spaceIds.includes(node.space_id)),
      edges: parseEdgeArray(row.edges_json).filter((edge) => activeScope.spaceIds.includes(edge.space_id)),
      truncated: row.truncated === true,
    };
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
    source_files: parseSourceFiles(row.source_refs_json),
  };
}

function parseSourceFiles(value: unknown): string[] {
  const raw = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!Array.isArray(raw)) {
    return [];
  }

  const files = raw
    .map((entry) => (isRecord(entry) && isString(entry.file) ? entry.file.trim() : ''))
    .filter((file) => file.length > 0);

  return [...new Set(files)];
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function parseRelations(value: unknown): GraphNodeRelation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((entry) => ({
    direction: entry.direction === 'out' ? 'out' : 'in',
    relation_type: isString(entry.relation_type) ? entry.relation_type : '',
    confidence_label: isString(entry.confidence_label) ? entry.confidence_label : '',
    effective_confidence_score: nullableNumber(asNumeric(entry.effective_confidence_score)),
    neighbor_id: isString(entry.neighbor_id) ? entry.neighbor_id : '',
    neighbor_label: isString(entry.neighbor_label) ? entry.neighbor_label : '',
  }));
}

function parseEvidenceArray(value: unknown): GraphEvidenceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((entry) => ({
    id: isString(entry.id) ? entry.id : '',
    page_id: isString(entry.page_id) ? entry.page_id : null,
    page_version_id: isString(entry.page_version_id) ? entry.page_version_id : null,
    source_document_id: isString(entry.source_document_id) ? entry.source_document_id : null,
    quote_text: isString(entry.quote_text) ? entry.quote_text : null,
    confidence_contribution: nullableNumber(asNumeric(entry.confidence_contribution)),
  }));
}

function parseWikiPage(value: unknown): GraphNodeWikiPage | null {
  if (!isRecord(value) || !isString(value.title)) {
    return null;
  }

  return {
    title: value.title,
    content_markdown: isString(value.content_markdown) ? value.content_markdown : '',
  };
}

function isRawNodeDetailNode(value: unknown): value is RawNodeDetailNode {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.node_key) &&
    isString(value.stable_key) &&
    isString(value.label) &&
    isString(value.space_id)
  );
}

function asNumeric(value: unknown): number | string | null | undefined {
  if (typeof value === 'number' || typeof value === 'string' || value === null || value === undefined) {
    return value;
  }

  return null;
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
