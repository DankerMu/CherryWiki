import { normalizeLabel } from './normalize-label.js';
import type { GraphEdge, GraphNode, GraphOutput } from './types.js';

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
  const data = JSON.parse(raw) as unknown;
  const record = isRecord(data) ? data : {};

  return {
    nodes: readArray(record, 'nodes').map(parseNode),
    edges: readArray(record, 'edges').map(parseEdge),
    hyperedges: readArray(record, 'hyperedges'),
  };
}
