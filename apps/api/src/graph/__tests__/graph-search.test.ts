import 'reflect-metadata';

import { PERMISSIONS_METADATA_KEY } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  createSpaceRow,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { GraphController } from '../graph.controller.js';
import { GraphService } from '../graph.service.js';

describe('GraphController search', () => {
  it('applies the space read permission metadata to graph routes', () => {
    expect(getMetadata('searchNodes')).toEqual(['space:read']);
    expect(getMetadata('findPath')).toEqual(['space:read']);
    expect(getMetadata('getNeighbors')).toEqual(['space:read']);
    expect(getMetadata('getNodeDetail')).toEqual(['space:read']);
    expect(getMetadata('getCommunities')).toEqual(['space:read']);
    expect(getMetadata('getCommunityNodes')).toEqual(['space:read']);
  });

  it('searches nodes with trigram score and requested space ACL', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([createActiveSpaceRow()]);
    db.queueExecute([
      {
        id: 'node-1',
        node_key: 'sso',
        stable_key: 'space-1:concept:sso',
        label: 'SSO Authentication',
        node_type: 'concept',
        space_id: TEST_SPACE_ID,
        community_id: 'community-1',
        score: '0.94',
      },
    ]);

    const result = await controller.searchNodes(
      { q: 'SSO', space_id: TEST_SPACE_ID, top_k: '5' },
      createRequest(),
    );

    expect(result).toEqual({
      nodes: [
        expect.objectContaining({
          id: 'node-1',
          label: 'SSO Authentication',
          score: 0.94,
          space_id: TEST_SPACE_ID,
        }),
      ],
      total: 1,
    });
    expect(db.executedQueries).toHaveLength(1);
  });

  it('returns space not found for an explicit unreadable space', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([]);

    const error = await getRejectedHttpException(
      controller.searchNodes({ q: 'SSO', space_id: TEST_SPACE_ID }, createRequest({})),
    );

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      code: ErrorCode.SPACE_NOT_FOUND,
      message: 'Space not found',
    });
  });

  it('returns an empty result when the user has no readable spaces', async () => {
    const { controller, db } = createGraphContext();

    const result = await controller.searchNodes({ q: 'SSO' }, createRequest({}));

    expect(result).toEqual({ nodes: [], total: 0 });
    expect(db.executedQueries).toHaveLength(0);
  });

  it('returns node detail with sources, relations, evidence, and wiki page', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([createActiveSpaceRow()]);
    db.queueExecute([
      {
        node_json: {
          id: 'node-a',
          node_key: 'sso',
          stable_key: `${TEST_SPACE_ID}:concept:sso`,
          label: 'SSO',
          type: 'concept',
          source_refs_json: [{ file: 'auth.md' }],
          space_id: TEST_SPACE_ID,
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

    const result = await controller.getNodeDetail('node-a', { space_id: TEST_SPACE_ID }, createRequest());

    expect(result).toEqual({
      id: 'node-a',
      node_key: 'sso',
      stable_key: `${TEST_SPACE_ID}:concept:sso`,
      label: 'SSO',
      node_type: 'concept',
      space_id: TEST_SPACE_ID,
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
          source_document_id: 'source-1',
          quote_text: 'A quote',
        },
      ],
      wiki_page: { title: 'SSO Page', content_markdown: '# SSO' },
    });
  });

  it('returns 404 when the node is not in the active run for a readable space', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([createActiveSpaceRow()]);
    db.queueExecute([]);

    const error = await getRejectedHttpException(
      controller.getNodeDetail('missing-node', { space_id: TEST_SPACE_ID }, createRequest()),
    );

    expect(error.getStatus()).toBe(404);
  });

  it('lists communities within readable spaces', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createActiveSpaceRow()]);
    db.queueExecute([
      {
        id: 'community-1',
        community_key: 'auth',
        label: 'Auth',
        summary: 'Authentication subsystem',
        node_count: '7',
      },
    ]);

    const result = await controller.getCommunities({}, createRequest());

    expect(result).toEqual({
      communities: [
        {
          id: 'community-1',
          community_key: 'auth',
          label: 'Auth',
          summary: 'Authentication subsystem',
          node_count: 7,
        },
      ],
    });
  });

  it('returns community nodes and edges within a requested readable space', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([createActiveSpaceRow()]);
    db.queueExecute([
      {
        nodes_json: [
          createGraphNode({ id: 'node-a', label: 'Alpha', community_id: 'community-1' }),
          createGraphNode({ id: 'node-b', label: 'Beta', community_id: 'community-1' }),
        ],
        edges_json: [
          {
            id: 'edge-ab',
            source_node_id: 'node-a',
            target_node_id: 'node-b',
            relation_type: 'relates_to',
            confidence_label: 'EXTRACTED',
            effective_confidence_score: '0.81',
            evidence_count: '2',
            space_id: TEST_SPACE_ID,
          },
        ],
        truncated: false,
      },
    ]);

    const result = await controller.getCommunityNodes(
      'community-1',
      { space_id: TEST_SPACE_ID },
      createRequest(),
    );

    expect(result).toEqual({
      nodes: [
        expect.objectContaining({ id: 'node-a', label: 'Alpha', community_id: 'community-1' }),
        expect.objectContaining({ id: 'node-b', label: 'Beta', community_id: 'community-1' }),
      ],
      edges: [
        {
          id: 'edge-ab',
          source_node_id: 'node-a',
          target_node_id: 'node-b',
          relationship: 'relates_to',
          confidence_label: 'EXTRACTED',
          effective_confidence_score: 0.81,
          evidence_count: 2,
          space_id: TEST_SPACE_ID,
        },
      ],
      truncated: false,
    });
  });

  it('returns an empty community node response when no active graph is available', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([]);

    await expect(
      controller.getCommunityNodes('community-1', { space_id: TEST_SPACE_ID }, createRequest()),
    ).resolves.toEqual({ nodes: [], edges: [], truncated: false });
    expect(db.executedQueries).toHaveLength(0);
  });

  it('passes the community truncation flag through the endpoint response', async () => {
    const { controller, db } = createGraphContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([createActiveSpaceRow()]);
    db.queueExecute([
      {
        nodes_json: [createGraphNode({ id: 'node-a', community_id: 'community-1' })],
        edges_json: [],
        truncated: true,
      },
    ]);

    await expect(
      controller.getCommunityNodes('community-1', { space_id: TEST_SPACE_ID }, createRequest()),
    ).resolves.toEqual({
      nodes: [expect.objectContaining({ id: 'node-a', community_id: 'community-1' })],
      edges: [],
      truncated: true,
    });
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

function createRequest(spacePermissions: Record<string, string[]> = { [TEST_SPACE_ID]: ['space:view'] }): RequestShape {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: 'user@example.com',
      role: 'editor',
      group_ids: ['group-1'],
      token_use: 'access',
      space_permissions: spacePermissions,
    },
  };
}

function createActiveSpaceRow() {
  // graph.service 现从激活快照推导 run，mock 返回投影后的形状（id + graphify_run_id）。
  return { ...createSpaceRow(), graphify_run_id: 'run-1' };
}

function createGraphNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'node-1',
    node_key: 'node-key',
    stable_key: `${TEST_SPACE_ID}:concept:node`,
    label: 'Node',
    node_type: 'concept',
    description: null,
    source_refs_json: [],
    space_id: TEST_SPACE_ID,
    community_id: null,
    score: 1,
    ...overrides,
  };
}

type RequestShape = {
  user: {
    sub: string;
    tenant_id: string;
    email: string;
    role: string;
    group_ids: string[];
    token_use: 'access';
    space_permissions?: Record<string, string[]>;
  };
};

function getMetadata(methodName: keyof GraphController): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(GraphController.prototype, methodName);
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, descriptor?.value as object);
}
