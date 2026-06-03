import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { describe, expect, it } from 'vitest';

import { GraphService } from '../../apps/api/src/graph/graph.service.js';
import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createSpaceRow,
  ScriptedChatDb,
} from './chat-integration-test-utils.js';

describe('Graph search and path integration', () => {
  it('searches active graph nodes through the Graph API service', async () => {
    const db = new ScriptedChatDb();
    const service = new GraphService(db.asDrizzle());

    db.queueSelect([createSpaceRow({ active_graphify_run_id: 'run-1' })]);
    db.queueSelect([{ id: TEST_SPACE_ID, graphify_run_id: 'run-1' }]);
    db.queueExecute([
      graphNode({ id: 'node-sso', node_key: 'sso', stable_key: 'stable-sso', label: 'SSO', score: 1 }),
      graphNode({ id: 'node-session', node_key: 'session', stable_key: 'stable-session', label: 'Session', score: 0.72 }),
    ]);

    const result = await service.searchNodes(
      { q: 'SSO', space_id: TEST_SPACE_ID, top_k: 5 },
      graphContext(),
    );

    expect(result).toEqual({
      total: 2,
      nodes: [
        expect.objectContaining({ id: 'node-sso', label: 'SSO', score: 1 }),
        expect.objectContaining({ id: 'node-session', label: 'Session', score: 0.72 }),
      ],
    });
  });

  it('returns path results and filters any path with disallowed node or edge spaces', async () => {
    const db = new ScriptedChatDb();
    const service = new GraphService(db.asDrizzle());
    const allowedStart = graphNode({ id: 'node-a', label: 'Auth', space_id: TEST_SPACE_ID });
    const allowedEnd = graphNode({ id: 'node-b', label: 'Session', space_id: TEST_SPACE_ID });
    const forbiddenNode = graphNode({ id: 'node-c', label: 'Forbidden', space_id: 'space-hidden' });

    db.queueSelect([{ id: TEST_SPACE_ID, graphify_run_id: 'run-1' }]);
    db.queueExecute([
      {
        nodes_json: [allowedStart, allowedEnd],
        edges_json: [graphEdge({ id: 'edge-ok', source_node_id: 'node-a', target_node_id: 'node-b' })],
      },
      {
        nodes_json: [allowedStart, forbiddenNode],
        edges_json: [graphEdge({ id: 'edge-node-blocked', source_node_id: 'node-a', target_node_id: 'node-c' })],
      },
      {
        nodes_json: [allowedStart, allowedEnd],
        edges_json: [
          graphEdge({
            id: 'edge-space-blocked',
            source_node_id: 'node-a',
            target_node_id: 'node-b',
            space_id: 'space-hidden',
          }),
        ],
      },
    ]);

    const result = await service.findPath(
      { source_node_id: 'node-a', target_node_id: 'node-b', max_hops: 2 },
      graphContext(),
    );

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toMatchObject({
      nodes: [
        { id: 'node-a', space_id: TEST_SPACE_ID },
        { id: 'node-b', space_id: TEST_SPACE_ID },
      ],
      edges: [{ id: 'edge-ok', space_id: TEST_SPACE_ID }],
    });
    expect(result.paths[0]?.total_confidence).toBeCloseTo(0.9 * Math.log(3));
  });

  it('returns empty results when the caller has no readable graph spaces', async () => {
    const db = new ScriptedChatDb();
    const service = new GraphService(db.asDrizzle());

    await expect(
      service.findPath(
        { source_node_id: 'node-a', target_node_id: 'node-b', max_hops: 2 },
        {
          tenantId: TEST_TENANT_ID,
          actorUserId: TEST_USER_ID,
          userId: TEST_USER_ID,
          spacePermissions: {},
        },
      ),
    ).resolves.toEqual({ paths: [] });
    expect(db.executeQueries).toEqual([]);
  });
});

function graphContext() {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    userId: TEST_USER_ID,
    spacePermissions: { [TEST_SPACE_ID]: ['space:read'] },
  };
}

function graphNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'node-1',
    node_key: 'node_1',
    stable_key: 'stable-node-1',
    label: 'Node',
    node_type: 'concept',
    description: null,
    space_id: TEST_SPACE_ID,
    community_id: null,
    score: 1,
    ...overrides,
  };
}

function graphEdge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'edge-1',
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    relation_type: 'depends_on',
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.9,
    evidence_count: 2,
    space_id: TEST_SPACE_ID,
    ...overrides,
  };
}
