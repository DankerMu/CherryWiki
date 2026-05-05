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
    expect(getMetadata('getCommunities')).toEqual(['space:read']);
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
  return createSpaceRow({ active_graphify_run_id: 'run-1' });
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
