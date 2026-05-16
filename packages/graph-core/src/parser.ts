import { normalizeLabel } from './normalize-label.js';
import type { GraphEdge, GraphNode, GraphOutput } from './types.js';
import { MAX_EDGES, MAX_NODES } from './validator.js';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readArray(record: JsonRecord, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function parseNode(value: unknown): GraphNode {
  const record = isRecord(value) ? value : {};
  const label = readString(record, 'label') ?? '';
  const community = readString(record, 'community') ?? null;
  const node: GraphNode = {
    id: readString(record, 'id') ?? '',
    label,
    norm_label: readString(record, 'norm_label') ?? normalizeLabel(label),
    type: readString(record, 'type') ?? 'concept',
    community,
  };

  const sourceFile = readString(record, 'source_file');
  if (sourceFile !== undefined) {
    node.source_file = sourceFile;
  }

  const sourceLocation = readString(record, 'source_location');
  if (sourceLocation !== undefined) {
    node.source_location = sourceLocation;
  }

  return node;
}

function parseEdge(value: unknown): GraphEdge {
  const record = isRecord(value) ? value : {};
  return {
    source: readString(record, 'source') ?? '',
    target: readString(record, 'target') ?? '',
    relation: readString(record, 'relation') ?? '',
    confidence: readString(record, 'confidence') ?? 'AMBIGUOUS',
    confidence_score: readNumber(record, 'confidence_score') ?? 0.2,
  };
}

export function parseGraphJson(raw: string): GraphOutput {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Invalid graph.json: malformed JSON');
  }

  const record = isRecord(data) ? data : {};
  const rawNodes = readArray(record, 'nodes');
  // networkx exports use 'links'; our own format uses 'edges' — try both
  const linksArray = readArray(record, 'links');
  const rawEdges = linksArray.length > 0 ? linksArray : readArray(record, 'edges');

  if (rawNodes.length > MAX_NODES) {
    throw new Error(`graph.json node count ${rawNodes.length} exceeds limit ${MAX_NODES}`);
  }

  if (rawEdges.length > MAX_EDGES) {
    throw new Error(`graph.json edge count ${rawEdges.length} exceeds limit ${MAX_EDGES}`);
  }

  return {
    nodes: rawNodes.map(parseNode),
    edges: rawEdges.map(parseEdge),
    hyperedges: readArray(record, 'hyperedges'),
  };
}
