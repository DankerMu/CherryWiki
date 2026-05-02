import type {
  ConfidenceLabel,
  GraphEdge,
  GraphOutput,
  GraphNode,
  ValidationResult,
} from './types.js';

export const MAX_NODES = 50_000;
export const MAX_EDGES = 200_000;

const VALID_LABELS = new Set<string>(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

export function isConfidenceLabel(value: string): value is ConfidenceLabel {
  return VALID_LABELS.has(value);
}

export function validateGraphOutput(
  parsed: GraphOutput,
  limits: { maxNodes?: number; maxEdges?: number } = {},
): ValidationResult {
  const maxNodes = limits.maxNodes ?? MAX_NODES;
  const maxEdges = limits.maxEdges ?? MAX_EDGES;
  const errors: string[] = [];
  const warnings: string[] = [];
  const validNodes: GraphNode[] = [];
  const validEdges: GraphEdge[] = [];

  if (parsed.nodes.length === 0) {
    errors.push('graph.json must contain at least one node');
    return { valid: false, errors, warnings, validNodes, validEdges };
  }

  if (parsed.nodes.length > maxNodes) {
    errors.push(`node count ${parsed.nodes.length} exceeds limit ${maxNodes}`);
    return { valid: false, errors, warnings, validNodes, validEdges };
  }

  if (parsed.edges.length > maxEdges) {
    errors.push(`edge count ${parsed.edges.length} exceeds limit ${maxEdges}`);
    return { valid: false, errors, warnings, validNodes, validEdges };
  }

  const nodeIds = new Set<string>();
  for (const node of parsed.nodes) {
    if (!node.id || !node.label) {
      errors.push(`node missing required field: id=${node.id}, label=${node.label}`);
      continue;
    }

    if (node.label.length > 256) {
      errors.push(`node label exceeds 256 chars: ${node.id}`);
      continue;
    }

    nodeIds.add(node.id);
    validNodes.push(node);
  }

  for (const edge of parsed.edges) {
    if (!edge.source || !edge.target || !edge.relation) {
      warnings.push(
        `edge missing required field: source=${edge.source}, target=${edge.target}, relation=${edge.relation}`,
      );
      continue;
    }

    if (!nodeIds.has(edge.source)) {
      warnings.push(`edge references non-existent source node: ${edge.source}`);
      continue;
    }

    if (!nodeIds.has(edge.target)) {
      warnings.push(`edge references non-existent target node: ${edge.target}`);
      continue;
    }

    if (!isConfidenceLabel(edge.confidence)) {
      warnings.push(`invalid confidence label "${edge.confidence}" normalized to AMBIGUOUS`);
      validEdges.push({
        ...edge,
        confidence: 'AMBIGUOUS',
        confidence_score: 0.2,
      });
      continue;
    }

    validEdges.push(edge);
  }

  return { valid: errors.length === 0, errors, warnings, validNodes, validEdges };
}
