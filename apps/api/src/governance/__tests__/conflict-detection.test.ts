import { describe, expect, it } from 'vitest';

import {
  areContradictoryRelations,
  assignSeverity,
  detectContradictoryEdgeConflicts,
  detectEdgeChunkMismatchConflicts,
  type ConflictEdgeRow,
  type EdgeChunkMismatchRow,
} from '../conflict-detection.js';

describe('governance conflict detection', () => {
  it('matches the contradiction map bidirectionally', () => {
    expect(areContradictoryRelations('depends_on', 'independent_of')).toBe(true);
    expect(areContradictoryRelations('independent_of', 'depends_on')).toBe(true);
    expect(areContradictoryRelations('enables', 'blocks')).toBe(true);
    expect(areContradictoryRelations('depends_on', 'supports')).toBe(false);
  });

  it('detects contradictory edges for the same entity pair', () => {
    const conflicts = detectContradictoryEdgeConflicts([
      createEdge({ edge_id: 'edge-1', relation_type: 'depends_on', confidence_label: 'EXTRACTED' }),
      createEdge({ edge_id: 'edge-2', relation_type: 'independent_of', confidence_label: 'EXTRACTED' }),
      createEdge({ edge_id: 'edge-3', target_node_id: 'node-c', relation_type: 'independent_of' }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      conflict_type: 'contradictory_edges',
      severity: 'high',
      entity_pair: {
        source_node_id: 'node-a',
        target_node_id: 'node-b',
      },
    });
    expect(conflicts[0]?.conflicting_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ edge_id: 'edge-1' }),
        expect.objectContaining({ edge_id: 'edge-2' }),
      ]),
    );
  });

  it('detects edge-chunk mismatch using entity overlap and negated relation phrases', () => {
    const conflicts = detectEdgeChunkMismatchConflicts([
      createMismatchRow({
        relation_type: 'depends_on',
        chunk_content: 'Service A is independent of Service B and has no dependency on it.',
      }),
      createMismatchRow({
        chunk_id: 'chunk-2',
        chunk_content: 'Service A depends on Service B during boot.',
      }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      conflict_type: 'edge_chunk_mismatch',
      fingerprint: 'edge_chunk_mismatch:edge-1:chunk-1',
      conflicting_items: expect.arrayContaining([
        expect.objectContaining({ edge_id: 'edge-1' }),
        expect.objectContaining({ chunk_id: 'chunk-1' }),
      ]) as unknown,
    });
  });

  it('assigns severity from confidence labels', () => {
    expect(assignSeverity(['EXTRACTED', 'EXTRACTED'])).toBe('high');
    expect(assignSeverity(['EXTRACTED', 'AMBIGUOUS'])).toBe('low');
    expect(assignSeverity(['EXTRACTED', 'INFERRED'])).toBe('medium');
    expect(assignSeverity(['EXTRACTED'])).toBe('medium');
  });
});

function createEdge(overrides: Partial<ConflictEdgeRow> = {}): ConflictEdgeRow {
  return {
    edge_id: 'edge-1',
    space_id: 'space-1',
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    source_label: 'Service A',
    target_label: 'Service B',
    relation_type: 'depends_on',
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.9,
    ...overrides,
  };
}

function createMismatchRow(overrides: Partial<EdgeChunkMismatchRow> = {}): EdgeChunkMismatchRow {
  return {
    ...createEdge(),
    chunk_id: 'chunk-1',
    chunk_content: 'Service A is independent of Service B.',
    ...overrides,
  };
}
