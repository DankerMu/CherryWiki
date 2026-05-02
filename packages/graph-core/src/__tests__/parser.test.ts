import { describe, expect, it } from 'vitest';

import { parseGraphJson } from '../parser.js';

describe('parseGraphJson', () => {
  it('parses minimal valid graph.json with defaults', () => {
    const parsed = parseGraphJson(
      JSON.stringify({
        nodes: [{ id: 'n1', label: 'Node 1' }],
        edges: [],
        hyperedges: [],
      }),
    );

    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]).toEqual({
      id: 'n1',
      label: 'Node 1',
      norm_label: 'node 1',
      type: 'concept',
      community: null,
    });
    expect(parsed.edges).toEqual([]);
    expect(parsed.hyperedges).toEqual([]);
  });

  it('preserves all known node and edge fields', () => {
    const parsed = parseGraphJson(
      JSON.stringify({
        nodes: [
          {
            id: 'auth',
            label: 'Auth',
            norm_label: 'auth',
            type: 'module',
            community: 'auth_system',
            source_file: 'auth.md',
            source_location: 'L5',
          },
        ],
        edges: [
          {
            source: 'auth',
            target: 'session',
            relation: 'creates',
            confidence: 'EXTRACTED',
            confidence_score: 1,
          },
        ],
        hyperedges: [{ id: 'h1' }],
      }),
    );

    expect(parsed.nodes[0]).toEqual({
      id: 'auth',
      label: 'Auth',
      norm_label: 'auth',
      type: 'module',
      community: 'auth_system',
      source_file: 'auth.md',
      source_location: 'L5',
    });
    expect(parsed.edges[0]).toEqual({
      source: 'auth',
      target: 'session',
      relation: 'creates',
      confidence: 'EXTRACTED',
      confidence_score: 1,
    });
    expect(parsed.hyperedges).toEqual([{ id: 'h1' }]);
  });

  it('applies defaults for missing optional fields', () => {
    const parsed = parseGraphJson(
      JSON.stringify({
        nodes: [{ id: 'auth', label: 'Auth/SSO Service v2.0' }],
        edges: [{ source: 'auth', target: 'auth', relation: 'self' }],
      }),
    );

    expect(parsed.nodes[0]?.type).toBe('concept');
    expect(parsed.nodes[0]?.community).toBeNull();
    expect(parsed.nodes[0]?.norm_label).toBe('authsso service v20');
    expect(parsed.edges[0]?.confidence).toBe('AMBIGUOUS');
    expect(parsed.edges[0]?.confidence_score).toBe(0.2);
    expect(parsed.hyperedges).toEqual([]);
  });

  it('throws for invalid JSON', () => {
    expect(() => parseGraphJson('{')).toThrow(SyntaxError);
  });
});
