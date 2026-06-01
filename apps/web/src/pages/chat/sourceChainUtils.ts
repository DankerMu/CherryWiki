import type { ChatCitation } from '../../hooks/useChatStream.js';
import type { GraphPathData, GraphPathEdge, GraphPathNode } from '../../components/GraphPathViewer.js';

export function buildCitationPath(spaceId: string, citation: ChatCitation): string {
  const citationSpaceId = citation.space_id ?? spaceId;
  return `/spaces/${encodeURIComponent(citationSpaceId)}/wiki/${encodeURIComponent(getCitationPageId(citation))}`;
}

export function getCitationPageId(citation: ChatCitation): string {
  if (typeof citation.page_id === 'string' && citation.page_id.length > 0) return citation.page_id;
  const sourcePageId = citation.source_chain_json.page_id;
  return typeof sourcePageId === 'string' && sourcePageId.length > 0 ? sourcePageId : citation.wiki_page_pk;
}

export function getCitationConfidenceLabel(citation: ChatCitation): string | null {
  const chain = getCitationSourceChain(citation);
  const directLabel = readStringValue(chain, 'edge_confidence') ?? readStringValue(chain, 'confidence_label');
  if (directLabel !== null) {
    return directLabel;
  }

  const graphPath = getCitationGraphPath(citation);
  return graphPath?.edges.find((edge) => edge.confidence_label !== null && edge.confidence_label !== undefined)?.confidence_label ?? null;
}

export function getCitationStringArray(citation: ChatCitation, key: string): string[] {
  const chain = getCitationSourceChain(citation);
  const directValue = chain[key] ?? citation.source_chain_json[key];
  return readStringArray(directValue);
}

export function getCitationNumber(citation: ChatCitation, key: string): number | null {
  const chain = getCitationSourceChain(citation);
  return readNumberValue(chain, key) ?? readNumberValue(citation.source_chain_json, key);
}

export function getCitationGraphPath(citation: ChatCitation): GraphPathData | null {
  const sourceChain = getCitationSourceChain(citation);
  const pathRecord = readRecordValue(sourceChain, 'graph_path') ?? readRecordValue(citation.source_chain_json, 'graph_path');
  const nodesValue =
    readArrayValue(pathRecord, 'nodes') ??
    readArrayValue(sourceChain, 'graph_path_nodes') ??
    readArrayValue(citation.source_chain_json, 'graph_path_nodes');

  if (nodesValue === null || nodesValue.length === 0) {
    return null;
  }

  const nodes = nodesValue.map(normalizeGraphPathNode);
  const edgesValue =
    readArrayValue(pathRecord, 'edges') ??
    readArrayValue(sourceChain, 'graph_path_edges') ??
    readArrayValue(citation.source_chain_json, 'graph_path_edges') ??
    [];
  const edges = edgesValue.map((edge, index) => normalizeGraphPathEdge(edge, index, nodes));
  const confidence =
    readNumberValue(pathRecord, 'total_confidence') ??
    readNumberValue(pathRecord, 'confidence') ??
    readNumberValue(sourceChain, 'chain_confidence');
  const graphPath: GraphPathData = { nodes, edges };

  if (confidence !== null) {
    graphPath.total_confidence = confidence;
  }

  return graphPath;
}

export function formatCitationScore(score: number): string {
  if (!Number.isFinite(score)) {
    return '0.00';
  }

  if (score >= 0 && score <= 1) {
    return `${Math.round(score * 100)}%`;
  }

  return score.toFixed(2);
}

export function formatLatency(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    return '';
  }

  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
  }

  return `${Math.max(0, Math.round(milliseconds))}ms`;
}

export function formatToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  if (isRecord(input)) {
    const command = readStringValue(input, 'command') ?? readStringValue(input, 'query') ?? readStringValue(input, 'input');
    if (command !== null) {
      return command;
    }
  }

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function transformMarkdownUrl(url: string): string {
  if (url.startsWith('citation:')) {
    return url;
  }

  if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:')) {
    return url;
  }

  return '';
}

function getCitationSourceChain(citation: ChatCitation): Record<string, unknown> {
  return readRecordValue(citation.source_chain_json, 'source_chain') ?? citation.source_chain_json;
}

function normalizeGraphPathNode(value: unknown, index: number): GraphPathNode {
  if (!isRecord(value)) {
    return { id: `node-${index}`, label: String(value) };
  }

  const id =
    readStringValue(value, 'id') ??
    readStringValue(value, 'node_id') ??
    readStringValue(value, 'node_key') ??
    readStringValue(value, 'stable_key') ??
    `node-${index}`;
  const node: GraphPathNode = { id };
  const label = readStringValue(value, 'label') ?? readStringValue(value, 'name');
  const nodeKey = readStringValue(value, 'node_key');
  const stableKey = readStringValue(value, 'stable_key');
  const nodeType = readStringValue(value, 'node_type') ?? readStringValue(value, 'type');

  if (label !== null) node.label = label;
  if (nodeKey !== null) node.node_key = nodeKey;
  if (stableKey !== null) node.stable_key = stableKey;
  if (nodeType !== null) node.node_type = nodeType;

  return node;
}

function normalizeGraphPathEdge(value: unknown, index: number, nodes: GraphPathNode[]): GraphPathEdge {
  const sourceFallback = nodes[index]?.id ?? `source-${index}`;
  const targetFallback = nodes[index + 1]?.id ?? `target-${index}`;

  if (!isRecord(value)) {
    return {
      id: `edge-${index}`,
      source_node_id: sourceFallback,
      target_node_id: targetFallback,
      relationship: String(value),
    };
  }

  const edge: GraphPathEdge = {
    id: readStringValue(value, 'id') ?? readStringValue(value, 'edge_id') ?? `edge-${index}`,
    source_node_id: readStringValue(value, 'source_node_id') ?? readStringValue(value, 'source') ?? sourceFallback,
    target_node_id: readStringValue(value, 'target_node_id') ?? readStringValue(value, 'target') ?? targetFallback,
  };
  const relationship = readStringValue(value, 'relationship') ?? readStringValue(value, 'relationship_type') ?? readStringValue(value, 'type');
  const confidenceLabel = readStringValue(value, 'confidence_label') ?? readStringValue(value, 'edge_confidence');
  const confidenceScore = readNumberValue(value, 'effective_confidence_score') ?? readNumberValue(value, 'confidence');

  if (relationship !== null) edge.relationship = relationship;
  if (confidenceLabel !== null) edge.confidence_label = confidenceLabel;
  if (confidenceScore !== null) edge.effective_confidence_score = confidenceScore;

  return edge;
}

function readRecordValue(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (record === null) {
    return null;
  }

  const value = record[key];
  return isRecord(value) ? value : null;
}

function readArrayValue(record: Record<string, unknown> | null, key: string): unknown[] | null {
  if (record === null) {
    return null;
  }

  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function readStringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumberValue(record: Record<string, unknown> | null, key: string): number | null {
  if (record === null) {
    return null;
  }

  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
