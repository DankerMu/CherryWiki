import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  createSpaceRow,
} from '../../users/__tests__/user-group-service-test-utils.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { GraphController } from '../graph.controller.js';
import { GraphService } from '../graph.service.js';

describe('GraphController path ACL', () => {
  it('excludes paths containing an unauthorized node space', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createActiveSpaceRow()]);
    db.queueExecute([
      {
        nodes_json: [
          createNode({ id: 'node-a', space_id: TEST_SPACE_ID }),
          createNode({ id: 'node-b', space_id: 'space-denied' }),
        ],
        edges_json: [createEdge({ id: 'edge-ab', space_id: TEST_SPACE_ID })],
      },
    ]);

    const result = await controller.findPath(
      { source_node_id: 'node-a', target_node_id: 'node-b', max_hops: 2 },
      createRequest(),
    );

    expect(result).toEqual({ paths: [] });
  });

  it('excludes paths containing an unauthorized edge space while keeping allowed paths', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createActiveSpaceRow()]);
    db.queueExecute([
      {
        nodes_json: [createNode({ id: 'node-a' }), createNode({ id: 'node-b' })],
        edges_json: [createEdge({ id: 'edge-denied', space_id: 'space-denied' })],
      },
      {
        nodes_json: [createNode({ id: 'node-a' }), createNode({ id: 'node-c' })],
        edges_json: [createEdge({ id: 'edge-allowed', target_node_id: 'node-c', space_id: TEST_SPACE_ID })],
      },
    ]);

    const result = await controller.findPath(
      { source_node_id: 'node-a', target_node_id: 'node-c', max_hops: 2 },
      createRequest(),
    );

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.edges[0]?.id).toBe('edge-allowed');
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

function createActiveSpaceRow() {
  return createSpaceRow({ active_graphify_run_id: 'run-1' });
}
