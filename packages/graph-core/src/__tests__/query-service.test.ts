import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  GraphQueryService,
  type GraphPath,
  type GraphQueryEdge,
  type GraphQueryNode,
} from '../query-service.js';

describe('GraphQueryService', () => {
  it('searches nodes from raw SQL rows and preserves trigram scores', async () => {
    const { db, execute } = createDb([
      {
        id: 'node-1',
        node_key: 'sso',
        stable_key: 'space-1:concept:sso',
        label: 'SSO Authentication',
        node_type: 'concept',
        space_id: 'space-1',
        community_id: 'community-1',
        score: '0.92',
      },
    ]);
    const service = new GraphQueryService(db);

    const result = await service.searchNodes('SSO', ['space-1'], activeRunIds(), 10);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'node-1',
        label: 'SSO Authentication',
        score: 0.92,
      }),
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('searches exact norm_label matches and returns empty search results', async () => {
    const exact = createDb([
      createNode({ id: 'node-exact', label: 'Token Service', score: 1 }),
    ]);
    await expect(new GraphQueryService(exact.db).searchNodes('token service', ['space-1'], activeRunIds())).resolves.toEqual([
      expect.objectContaining({ id: 'node-exact', score: 1 }),
    ]);

    const empty = createDb([]);
    await expect(new GraphQueryService(empty.db).searchNodes('missing', ['space-1'], activeRunIds())).resolves.toEqual([]);
  });

  it('short-circuits node search when the ACL space set is empty', async () => {
    const { db, execute } = createDb([createNode()]);

    await expect(new GraphQueryService(db).searchNodes('SSO', [], activeRunIds())).resolves.toEqual([]);

    expect(execute).not.toHaveBeenCalled();
  });

  it('short-circuits node search when no allowed spaces have an active graphify run', async () => {
    const { db, execute } = createDb([createNode()]);

    await expect(new GraphQueryService(db).searchNodes('SSO', ['space-1'], new Map())).resolves.toEqual([]);

    expect(execute).not.toHaveBeenCalled();
  });

  it('maps a direct path and scores confidence with evidence weighting', async () => {
    const edge = createEdge({ effective_confidence_score: 0.9, evidence_count: 2 });
    const { db } = createDb([
      {
        nodes_json: [createNode({ id: 'node-a' }), createNode({ id: 'node-b' })],
        edges_json: [edge],
      },
    ]);

    const [path] = await new GraphQueryService(db).findPath('node-a', 'node-b', 1, ['space-1'], activeRunIds());

    expect(path?.nodes.map((node) => node.id)).toEqual(['node-a', 'node-b']);
    expect(path?.edges).toEqual([edge]);
    expect(path?.total_confidence).toBeCloseTo(0.9 * Math.log(3));
  });

  it('maps multi-hop paths, handles no-path results, and honors empty ACL inputs', async () => {
    const multiHop = createDb([
      {
        nodes_json: [
          createNode({ id: 'node-a' }),
          createNode({ id: 'node-b' }),
          createNode({ id: 'node-c' }),
        ],
        edges_json: [
          createEdge({ id: 'edge-ab', source_node_id: 'node-a', target_node_id: 'node-b' }),
          createEdge({ id: 'edge-bc', source_node_id: 'node-b', target_node_id: 'node-c' }),
        ],
      },
    ]);

    await expect(new GraphQueryService(multiHop.db).findPath('node-a', 'node-c', 2, ['space-1'], activeRunIds())).resolves.toEqual([
      expect.objectContaining({
        nodes: [
          expect.objectContaining({ id: 'node-a' }),
          expect.objectContaining({ id: 'node-b' }),
          expect.objectContaining({ id: 'node-c' }),
        ],
        edges: [
          expect.objectContaining({ id: 'edge-ab' }),
          expect.objectContaining({ id: 'edge-bc' }),
        ],
      }) as GraphPath,
    ]);

    await expect(new GraphQueryService(createDb([]).db).findPath('node-a', 'node-c', 2, ['space-1'], activeRunIds())).resolves.toEqual([]);
    await expect(new GraphQueryService(createDb([]).db).findPath('node-a', 'node-c', 2, [], activeRunIds())).resolves.toEqual([]);
  });

  it('filters paths when any node or edge falls outside the allowed spaces', () => {
    const service = new GraphQueryService(createDb([]).db);
    const allowedPath = createPath();
    const excludedNodePath = createPath({
      nodes: [createNode({ id: 'node-a' }), createNode({ id: 'node-b', space_id: 'space-2' })],
    });
    const excludedEdgePath = createPath({
      edges: [createEdge({ id: 'edge-ab', space_id: 'space-2' })],
    });
    const mixedPath = createPath({
      nodes: [createNode({ id: 'node-a', space_id: 'space-1' }), createNode({ id: 'node-b', space_id: 'space-2' })],
      edges: [createEdge({ id: 'edge-ab', space_id: 'space-1' })],
    });

    expect(service.filterPathsByACL([allowedPath, excludedNodePath, excludedEdgePath, mixedPath], ['space-1'])).toEqual([
      allowedPath,
    ]);
  });

  it('returns neighbors from recursively expanded node and edge sets', async () => {
    const { db } = createDb([
      {
        nodes_json: [createNode({ id: 'node-a' }), createNode({ id: 'node-b' })],
        edges_json: [createEdge({ id: 'edge-ab', source_node_id: 'node-a', target_node_id: 'node-b' })],
      },
    ]);

    const result = await new GraphQueryService(db).getNeighbors('node-a', 2, ['space-1'], activeRunIds());

    expect(result.nodes.map((node) => node.id)).toEqual(['node-a', 'node-b']);
    expect(result.edges.map((edge) => edge.id)).toEqual(['edge-ab']);
  });

  it('lists communities and community nodes', async () => {
    const service = new GraphQueryService(
      createQueuedDb([
        [{ id: 'community-1', community_key: 'auth', label: 'Auth', summary: 'Authentication', node_count: '3' }],
        [
          {
            nodes_json: [createNode({ id: 'node-a', community_id: 'community-1' })],
            edges_json: [createEdge({ id: 'edge-aa', source_node_id: 'node-a', target_node_id: 'node-a' })],
            truncated: true,
          },
        ],
      ]).db,
    );

    await expect(service.getCommunities(['space-1'], activeRunIds())).resolves.toEqual([
      { id: 'community-1', community_key: 'auth', label: 'Auth', summary: 'Authentication', node_count: 3 },
    ]);
    await expect(service.getCommunityNodes('community-1', ['space-1'], activeRunIds())).resolves.toEqual({
      nodes: [expect.objectContaining({ community_id: 'community-1' })],
      edges: [expect.objectContaining({ id: 'edge-aa' })],
      truncated: true,
    });
  });

  it('returns evidence refs for the edge to page to source document chain', async () => {
    const { db } = createDb([
      {
        id: 'evidence-1',
        page_id: 'page-1',
        page_version_id: 'version-1',
        source_document_id: 'source-1',
        quote_text: 'Evidence quote',
        confidence_contribution: '0.4',
      },
    ]);

    await expect(new GraphQueryService(db).getEvidenceRefs('edge-1', ['space-1'])).resolves.toEqual([
      {
        id: 'evidence-1',
        page_id: 'page-1',
        page_version_id: 'version-1',
        source_document_id: 'source-1',
        quote_text: 'Evidence quote',
        confidence_contribution: 0.4,
      },
    ]);
  });

  it('returns no evidence refs when the edge is outside the allowed spaces', async () => {
    const { db } = createDb([]);

    await expect(new GraphQueryService(db).getEvidenceRefs('edge-1', ['space-denied'])).resolves.toEqual([]);
  });

  it('parses source files from node source_refs_json during search', async () => {
    const { db } = createDb([
      {
        id: 'node-1',
        node_key: 'sso',
        stable_key: 'space-1:concept:sso',
        label: 'SSO',
        node_type: 'concept',
        source_refs_json: [{ file: 'auth.md' }, { file: 'auth.md' }, { wrong: 'x' }, { file: 'sso.md' }],
        space_id: 'space-1',
        community_id: null,
        score: '1',
      },
    ]);

    const [node] = await new GraphQueryService(db).searchNodes('SSO', ['space-1'], activeRunIds());

    expect(node?.source_files).toEqual(['auth.md', 'sso.md']);
  });

  it('returns node detail with source files, relations, evidence, and wiki page', async () => {
    const { db } = createDb([
      {
        node_json: {
          id: 'node-a',
          node_key: 'sso',
          stable_key: 'space-1:concept:sso',
          label: 'SSO',
          type: 'concept',
          source_refs_json: [{ file: 'auth.md' }],
          space_id: 'space-1',
          community_id: 'community-1',
        },
        relations_json: [
          {
            direction: 'out',
            relation_type: 'relates_to',
            confidence_label: 'EXTRACTED',
            effective_confidence_score: '0.8',
            neighbor_id: 'node-b',
            neighbor_label: 'OAuth',
          },
        ],
        evidence_json: [
          {
            id: 'evidence-1',
            page_id: 'page-1',
            page_version_id: 'version-1',
            source_document_id: 'source-1',
            quote_text: 'A quote',
            confidence_contribution: '0.4',
          },
        ],
        wiki_page_json: { title: 'SSO Page', content_markdown: '# SSO' },
      },
    ]);

    const detail = await new GraphQueryService(db).getNodeDetail('node-a', ['space-1'], activeRunIds());

    expect(detail).toEqual({
      id: 'node-a',
      node_key: 'sso',
      stable_key: 'space-1:concept:sso',
      label: 'SSO',
      node_type: 'concept',
      space_id: 'space-1',
      community_id: 'community-1',
      score: 1,
      source_files: ['auth.md'],
      relations: [
        {
          direction: 'out',
          relation_type: 'relates_to',
          confidence_label: 'EXTRACTED',
          effective_confidence_score: 0.8,
          neighbor_id: 'node-b',
          neighbor_label: 'OAuth',
        },
      ],
      evidence: [
        {
          id: 'evidence-1',
          page_id: 'page-1',
          page_version_id: 'version-1',
          source_document_id: 'source-1',
          quote_text: 'A quote',
          confidence_contribution: 0.4,
        },
      ],
      wiki_page: { title: 'SSO Page', content_markdown: '# SSO' },
    });
  });

  it('returns null node detail when the node is outside the active run or readable spaces', async () => {
    const { db, execute } = createDb([]);

    await expect(new GraphQueryService(db).getNodeDetail('node-a', ['space-1'], activeRunIds())).resolves.toBeNull();
    await expect(new GraphQueryService(db).getNodeDetail('node-a', [], activeRunIds())).resolves.toBeNull();
    await expect(new GraphQueryService(db).getNodeDetail('node-a', ['space-1'], new Map())).resolves.toBeNull();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('orders paths by shortest depth before effective confidence score', async () => {
    const lowConfidenceEdge = createEdge({ id: 'edge-low', effective_confidence_score: 0.5, evidence_count: 1 });
    const highConfidenceEdgeA = createEdge({ id: 'edge-high-a', effective_confidence_score: 0.9, evidence_count: 4 });
    const highConfidenceEdgeB = createEdge({
      id: 'edge-high-b',
      source_node_id: 'node-mid',
      target_node_id: 'node-target',
      effective_confidence_score: 0.9,
      evidence_count: 4,
    });
    const { db } = createDb([
      {
        nodes_json: [createNode({ id: 'node-a' }), createNode({ id: 'node-mid' }), createNode({ id: 'node-target' })],
        edges_json: [highConfidenceEdgeA, highConfidenceEdgeB],
      },
      {
        nodes_json: [createNode({ id: 'node-a' }), createNode({ id: 'node-target' })],
        edges_json: [lowConfidenceEdge],
      },
    ]);

    const result = await new GraphQueryService(db).findPath('node-a', 'node-target', 2, ['space-1'], activeRunIds());

    expect(result[0]?.edges.map((edge) => edge.id)).toEqual(['edge-low']);
    expect(result[1]?.total_confidence).toBeGreaterThan(result[0]?.total_confidence ?? 0);
  });
});

function createDb(result: unknown[] | { rows: unknown[] }): {
  db: NodePgDatabase;
  execute: ReturnType<typeof vi.fn<(query: unknown) => Promise<unknown[] | { rows: unknown[] }>>>;
} {
  return createQueuedDb([result]);
}

function createQueuedDb(results: Array<unknown[] | { rows: unknown[] }>): {
  db: NodePgDatabase;
  execute: ReturnType<typeof vi.fn<(query: unknown) => Promise<unknown[] | { rows: unknown[] }>>>;
} {
  const execute = vi.fn<(query: unknown) => Promise<unknown[] | { rows: unknown[] }>>(() =>
    Promise.resolve(results.shift() ?? []),
  );
  return {
    db: { execute } as unknown as NodePgDatabase,
    execute,
  };
}

function createNode(overrides: Partial<GraphQueryNode> = {}): GraphQueryNode {
  return {
    id: 'node-1',
    node_key: 'sso',
    stable_key: 'space-1:concept:sso',
    label: 'SSO',
    node_type: 'concept',
    description: null,
    space_id: 'space-1',
    community_id: null,
    score: 1,
    source_files: [],
    ...overrides,
  };
}

function activeRunIds(entries: Record<string, string> = { 'space-1': 'run-1' }): Map<string, string> {
  return new Map(Object.entries(entries));
}

function createEdge(overrides: Partial<GraphQueryEdge> = {}): GraphQueryEdge {
  return {
    id: 'edge-1',
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    relation_type: 'relates_to',
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.8,
    evidence_count: 1,
    space_id: 'space-1',
    ...overrides,
  };
}

function createPath(overrides: Partial<GraphPath> = {}): GraphPath {
  return {
    nodes: [createNode({ id: 'node-a' }), createNode({ id: 'node-b' })],
    edges: [createEdge({ id: 'edge-ab' })],
    total_confidence: 1,
    ...overrides,
  };
}
