import type { ConflictFeedbackInput } from '../feedback/feedback.service.js';

export type ConflictSeverity = 'high' | 'medium' | 'low';
export type ConflictType = 'contradictory_edges' | 'edge_chunk_mismatch';

export type ConflictEntityPair = {
  source_node_id: string;
  target_node_id: string;
  source_label: string;
  target_label: string;
};

export type ConflictEdgeRow = {
  edge_id: string;
  space_id: string;
  source_node_id: string;
  target_node_id: string;
  source_label: string;
  target_label: string;
  relation_type: string;
  confidence_label: string;
  effective_confidence_score?: number | string | null;
};

export type EdgeChunkMismatchRow = ConflictEdgeRow & {
  chunk_id: string;
  chunk_content: string;
};

export type DetectedConflict = ConflictFeedbackInput & {
  space_id: string;
};

type RelationKey =
  | 'depends_on'
  | 'independent_of'
  | 'causes'
  | 'prevents'
  | 'enables'
  | 'blocks'
  | 'requires'
  | 'excludes'
  | 'supports'
  | 'contradicts';

export const CONTRADICTION_MAP: Readonly<Record<RelationKey, RelationKey>> = {
  depends_on: 'independent_of',
  independent_of: 'depends_on',
  causes: 'prevents',
  prevents: 'causes',
  enables: 'blocks',
  blocks: 'enables',
  requires: 'excludes',
  excludes: 'requires',
  supports: 'contradicts',
  contradicts: 'supports',
};

const CONTRADICTION_PHRASES: Readonly<Record<RelationKey, readonly string[]>> = {
  depends_on: ['depends on', 'dependent on', 'requires', 'relies on', 'needs'],
  independent_of: ['independent of', 'does not depend on', 'do not depend on', 'not dependent on', 'no dependency on'],
  causes: ['causes', 'leads to', 'results in', 'triggers'],
  prevents: ['prevents', 'does not cause', 'do not cause', 'not cause', 'blocks from happening'],
  enables: ['enables', 'allows', 'makes possible', 'unblocks'],
  blocks: ['blocks', 'prevents', 'disables', 'stops'],
  requires: ['requires', 'must have', 'needs', 'depends on'],
  excludes: ['excludes', 'cannot coexist', 'mutually exclusive', 'incompatible with'],
  supports: ['supports', 'backs', 'reinforces', 'is evidence for'],
  contradicts: ['contradicts', 'conflicts with', 'does not support', 'refutes', 'is inconsistent with'],
};

export function detectContradictoryEdgeConflicts(rows: ConflictEdgeRow[]): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];
  const grouped = new Map<string, ConflictEdgeRow[]>();

  for (const row of rows) {
    if (isRejectedOrInactive(row)) {
      continue;
    }

    const key = `${row.space_id}:${row.source_node_id}:${row.target_node_id}`;
    const group = grouped.get(key);
    if (group === undefined) {
      grouped.set(key, [row]);
    } else {
      group.push(row);
    }
  }

  for (const group of grouped.values()) {
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const left = group[leftIndex];
        const right = group[rightIndex];
        if (left === undefined || right === undefined || !areContradictoryRelations(left.relation_type, right.relation_type)) {
          continue;
        }

        const edgeIds = [left.edge_id, right.edge_id].sort();
        conflicts.push({
          space_id: left.space_id,
          conflict_type: 'contradictory_edges',
          entity_pair: toEntityPair(left),
          conflicting_items: [
            toEdgeConflictItem(left),
            toEdgeConflictItem(right),
          ],
          severity: assignSeverity([left.confidence_label, right.confidence_label]),
          fingerprint: createConflictFingerprint('contradictory_edges', [
            left.source_node_id,
            left.target_node_id,
            ...edgeIds,
          ]),
        });
      }
    }
  }

  return conflicts;
}

export function detectEdgeChunkMismatchConflicts(rows: EdgeChunkMismatchRow[]): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];

  for (const row of rows) {
    if (isRejectedOrInactive(row) || !hasEntityOverlap(row) || !chunkContradictsEdge(row.relation_type, row.chunk_content)) {
      continue;
    }

    conflicts.push({
      space_id: row.space_id,
      conflict_type: 'edge_chunk_mismatch',
      entity_pair: toEntityPair(row),
      conflicting_items: [
        toEdgeConflictItem(row),
        {
          chunk_id: row.chunk_id,
          content_excerpt: excerpt(row.chunk_content),
        },
      ],
      severity: assignSeverity([row.confidence_label]),
      fingerprint: createConflictFingerprint('edge_chunk_mismatch', [row.edge_id, row.chunk_id]),
    });
  }

  return dedupeConflicts(conflicts);
}

export function areContradictoryRelations(left: string, right: string): boolean {
  const normalizedLeft = normalizeRelation(left);
  const normalizedRight = normalizeRelation(right);
  if (!isRelationKey(normalizedLeft) || !isRelationKey(normalizedRight)) {
    return false;
  }

  return CONTRADICTION_MAP[normalizedLeft] === normalizedRight;
}

export function assignSeverity(confidenceLabels: string[]): ConflictSeverity {
  if (confidenceLabels.length >= 2 && confidenceLabels.every((label) => label === 'EXTRACTED')) {
    return 'high';
  }

  if (confidenceLabels.some((label) => label === 'AMBIGUOUS')) {
    return 'low';
  }

  return 'medium';
}

export function createConflictFingerprint(type: ConflictType, parts: string[]): string {
  return `${type}:${parts.map((part) => part.trim()).filter((part) => part.length > 0).join(':')}`;
}

function toEntityPair(row: ConflictEdgeRow): ConflictEntityPair {
  return {
    source_node_id: row.source_node_id,
    target_node_id: row.target_node_id,
    source_label: row.source_label,
    target_label: row.target_label,
  };
}

function toEdgeConflictItem(row: ConflictEdgeRow): Record<string, unknown> {
  return {
    edge_id: row.edge_id,
    relation_type: row.relation_type,
    confidence_label: row.confidence_label,
    effective_confidence_score: normalizeOptionalNumber(row.effective_confidence_score),
  };
}

function chunkContradictsEdge(relationType: string, content: string): boolean {
  const relation = normalizeRelation(relationType);
  if (!isRelationKey(relation)) {
    return false;
  }

  const opposite = CONTRADICTION_MAP[relation];
  const normalizedContent = normalizeSearchText(content);
  return CONTRADICTION_PHRASES[opposite].some((phrase) => normalizedContent.includes(phrase));
}

function hasEntityOverlap(row: EdgeChunkMismatchRow): boolean {
  const content = normalizeSearchText(row.chunk_content);
  return containsLabel(content, row.source_label) && containsLabel(content, row.target_label);
}

function containsLabel(normalizedContent: string, label: string): boolean {
  const normalizedLabel = normalizeSearchText(label);
  if (normalizedLabel.length === 0) {
    return false;
  }

  const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedLabel)}(\\s|$)`);
  return pattern.test(normalizedContent);
}

function normalizeRelation(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function isRelationKey(value: string): value is RelationKey {
  return Object.prototype.hasOwnProperty.call(CONTRADICTION_MAP, value);
}

function isRejectedOrInactive(row: ConflictEdgeRow): boolean {
  if (row.confidence_label === 'REJECTED') {
    return true;
  }

  const effectiveScore = normalizeOptionalNumber(row.effective_confidence_score);
  return effectiveScore !== null && effectiveScore <= 0;
}

function normalizeOptionalNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function dedupeConflicts(conflicts: DetectedConflict[]): DetectedConflict[] {
  const seen = new Set<string>();
  const deduped: DetectedConflict[] = [];
  for (const conflict of conflicts) {
    if (seen.has(conflict.fingerprint)) {
      continue;
    }
    seen.add(conflict.fingerprint);
    deduped.push(conflict);
  }

  return deduped;
}

function excerpt(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 237)}...`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
