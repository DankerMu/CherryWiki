import type { SourceChainJson } from './types.js';

type SourceLinkRow = {
  source_document_id?: string | null;
};

type GraphEvidenceRefRow = {
  edge_id?: string | null;
  graph_edge_id?: string | null;
  graph_node_id?: string | null;
  graph_node_ids?: string[] | null;
  source_node_id?: string | null;
  target_node_id?: string | null;
  confidence_label?: string | null;
  label?: string | null;
  confidence?: number | null;
  effective_confidence_score?: number | null;
  raw_confidence_score?: number | null;
  confidence_contribution?: number | null;
  edge?: {
    id?: string | null;
    source_node_id?: string | null;
    target_node_id?: string | null;
    confidence_label?: string | null;
    effective_confidence_score?: number | null;
    raw_confidence_score?: number | null;
  } | null;
};

export type SourceChainDeps = {
  getSourceLinks(pageVersionId: string): Promise<SourceLinkRow[]> | SourceLinkRow[];
  getGraphEvidenceRefs(pageId: string, pageVersionId: string): Promise<GraphEvidenceRefRow[]> | GraphEvidenceRefRow[];
};

export async function computeSourceChain(
  pageId: string,
  pageVersionId: string,
  deps: SourceChainDeps,
): Promise<SourceChainJson> {
  const [sourceLinks, graphEvidenceRefs] = await Promise.all([
    deps.getSourceLinks(pageVersionId),
    deps.getGraphEvidenceRefs(pageId, pageVersionId),
  ]);
  const sourceDocumentIds = uniqueStrings(sourceLinks.map((link) => link.source_document_id));
  const graphNodeIds = new Set<string>();
  const graphEdgeIds = new Set<string>();
  const edgeConfidenceById = new Map<string, { edge_id: string; confidence: number; label: string }>();

  for (const ref of graphEvidenceRefs) {
    addOptionalString(graphNodeIds, ref.graph_node_id);
    addOptionalStrings(graphNodeIds, ref.graph_node_ids ?? []);
    addOptionalString(graphNodeIds, ref.source_node_id ?? ref.edge?.source_node_id);
    addOptionalString(graphNodeIds, ref.target_node_id ?? ref.edge?.target_node_id);

    const edgeId = ref.edge_id ?? ref.graph_edge_id ?? ref.edge?.id ?? null;
    if (!edgeId) {
      continue;
    }

    graphEdgeIds.add(edgeId);

    const label = ref.confidence_label ?? ref.label ?? ref.edge?.confidence_label ?? 'UNKNOWN';
    const confidence = resolveConfidence(ref, label);
    const existing = edgeConfidenceById.get(edgeId);

    if (!existing || confidence < existing.confidence) {
      edgeConfidenceById.set(edgeId, { edge_id: edgeId, confidence, label });
    }
  }

  const edgeConfidences = [...edgeConfidenceById.values()];

  return {
    source_document_ids: sourceDocumentIds,
    graph_node_ids: [...graphNodeIds],
    graph_edge_ids: [...graphEdgeIds],
    edge_confidences: edgeConfidences,
    chain_confidence:
      edgeConfidences.length === 0 ? 1.0 : Math.min(...edgeConfidences.map((edge) => edge.confidence)),
  };
}

function resolveConfidence(ref: GraphEvidenceRefRow, label: string): number {
  if (label === 'AMBIGUOUS') {
    return 0.4;
  }

  return (
    ref.effective_confidence_score ??
    ref.confidence ??
    ref.confidence_contribution ??
    ref.edge?.effective_confidence_score ??
    ref.raw_confidence_score ??
    ref.edge?.raw_confidence_score ??
    1.0
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function addOptionalString(set: Set<string>, value: string | null | undefined): void {
  if (typeof value === 'string' && value.length > 0) {
    set.add(value);
  }
}

function addOptionalStrings(set: Set<string>, values: string[]): void {
  for (const value of values) {
    addOptionalString(set, value);
  }
}
