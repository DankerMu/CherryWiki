import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
} from '../../users/__tests__/user-group-service-test-utils.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { GraphController } from '../graph.controller.js';
import { GraphService } from '../graph.service.js';

describe('GraphController path', () => {
  it('returns a direct path between two nodes', async () => {
    const { controller, db } = createGraphContext();
    db.queueExecute([
      {
        nodes_json: [
          createNode({ id: 'node-a', label: 'SSO' }),
          createNode({ id: 'node-b', label: 'Token Service' }),
        ],
        edges_json: [
          createEdge({
            id: 'edge-ab',
            source_node_id: 'node-a',
            target_node_id: 'node-b',
            effective_confidence_score: 0.95,
            evidence_count: 2,
          }),
        ],
      },
    ]);

    const result = await controller.findPath(
      { source_node_id: 'node-a', target_node_id: 'node-b', max_hops: 1 },
      createRequest(),
    );

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.nodes.map((node) => node.id)).toEqual(['node-a', 'node-b']);
    expect(result.paths[0]?.edges[0]).toMatchObject({ id: 'edge-ab', relation_type: 'relates_to' });
    expect(result.paths[0]?.total_confidence).toBeCloseTo(0.95 * Math.log(3));
  });

  it('returns a multi-hop path and no-path results without throwing', async () => {
    const { controller, db } = createGraphContext();
    db.queueExecute([
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
    db.queueExecute([]);

    const multiHop = await controller.findPath(
      { source_node_id: 'node-a', target_node_id: 'node-c', max_hops: 2 },
      createRequest(),
    );
    const missing = await controller.findPath(
      { source_node_id: 'node-a', target_node_id: 'node-missing', max_hops: 2 },
      createRequest(),
    );

    expect(multiHop.paths[0]?.edges.map((edge) => edge.id)).toEqual(['edge-ab', 'edge-bc']);
    expect(missing).toEqual({ paths: [] });
  });

  it('returns neighbors with hop distance from the center node', async () => {
    const { controller, db } = createGraphContext();
    db.queueExecute([
      {
        nodes_json: [
          createNode({ id: 'node-a', label: 'SSO' }),
          createNode({ id: 'node-b', label: 'Token' }),
          createNode({ id: 'node-c', label: 'Permissions' }),
        ],
        edges_json: [
          createEdge({ id: 'edge-ab', source_node_id: 'node-a', target_node_id: 'node-b' }),
          createEdge({ id: 'edge-bc', source_node_id: 'node-b', target_node_id: 'node-c' }),
        ],
      },
    ]);

    const result = await controller.getNeighbors('node-a', { hops: '2' }, createRequest());

    expect(result.center_node).toMatchObject({ id: 'node-a' });
    expect(result.neighbors.map((neighbor) => ({ id: neighbor.node.id, hop: neighbor.hop }))).toEqual([
      { id: 'node-b', hop: 1 },
      { id: 'node-c', hop: 2 },
    ]);
  });
});

function createGraphContext(): { controller: GraphController; db: ScriptedDb } {
  const db = new ScriptedDb();
  const service = new GraphService(db.asDrizzle() as unknown as DrizzleDatabase);
  return {
    controller: new GraphController(service),
    db,
  };
}

function createRequest(): {
  user: {
    sub: string;
    tenant_id: string;
    email: string;
    role: string;
    group_ids: string[];
    token_use: 'access';
    space_permissions: Record<string, string[]>;
  };
} {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: 'user@example.com',
      role: 'editor',
      group_ids: ['group-1'],
      token_use: 'access',
      space_permissions: {
        [TEST_SPACE_ID]: ['space:view'],
      },
    },
  };
}

function createNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'node-a',
    node_key: 'node',
    stable_key: 'stable-node',
    label: 'Node',
    node_type: 'concept',
    space_id: TEST_SPACE_ID,
    community_id: null,
    score: 1,
    ...overrides,
  };
}

function createEdge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'edge-1',
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    relation_type: 'relates_to',
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.8,
    evidence_count: 1,
    space_id: TEST_SPACE_ID,
    ...overrides,
  };
}
