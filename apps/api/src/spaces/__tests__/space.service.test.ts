import { ErrorCode, space_permissions } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import {
  TEST_ACTOR_ID,
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  createAuditMock,
  createRedisMock,
  createSpaceRow,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { SpaceService, type SpaceContext } from '../space.service.js';

describe('SpaceService', () => {
  it('lists only spaces the user has view permission for', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ space_id: TEST_SPACE_ID }, { space_id: 'space-2' }]);
    db.queueSelect([createSpaceRow(), createSpaceRow({ id: 'space-2', slug: 'product' })]);
    db.queueSelect([{ total: 2 }]);

    const result = await service.listSpaces({ page: 1, per_page: 20 }, createViewerContext());

    expect(result.data.map((space) => space.id)).toEqual([TEST_SPACE_ID, 'space-2']);
    expect(result.data[0]?.stats).toEqual({
      page_count: 0,
      source_count: 0,
      node_count: 0,
    });
    expect(result.pagination.total).toBe(2);
  });

  it.each(['owner', 'admin'] as const)('lists all spaces for %s role', async (role) => {
    const { service, db } = createServiceContext();
    db.queueSelect([createSpaceRow(), createSpaceRow({ id: 'space-2', slug: 'product' })]);
    db.queueSelect([{ total: 2 }]);

    const result = await service.listSpaces(
      { page: 1, per_page: 20 },
      createViewerContext({ actorRole: role }),
    );

    expect(result.data.map((space) => space.id)).toEqual([TEST_SPACE_ID, 'space-2']);
    expect(result.pagination.total).toBe(2);
  });

  it('lists spaces with search filter', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ space_id: TEST_SPACE_ID }]);
    db.queueSelect([createSpaceRow({ name: 'Research Knowledge' })]);
    db.queueSelect([{ total: 1 }]);

    const result = await service.listSpaces(
      { page: 1, per_page: 20, search: 'Research' },
      createViewerContext(),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.name).toBe('Research Knowledge');
  });

  it('creates a space with auto wiki repo path and audit event', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([]);

    const result = await service.createSpace(
      { name: 'Product', slug: 'product', description: 'Product knowledge' },
      createAdminContext(),
    );

    const inserted = getInsertValue(db, 0);
    expect(result.id).toBe(inserted.id);
    expect(result.status).toBe('active');
    expect(result.strict_knowledge_only).toBe(true);
    expect(result.graphify_config).toEqual({});
    expect(result.wiki_repo_path).toBe(`/data/wiki/${result.id}`);
    expect(inserted.wiki_repo_path).toBe(`/data/wiki/${String(inserted.id)}`);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.SPACE_CREATE,
        resource_type: 'space',
        resource_id: result.id,
        space_id: result.id,
      }),
    );
  });

  it('maps create slug conflict to SPACE_SLUG_CONFLICT', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const err = await getRejectedHttpException(
      service.createSpace({ name: 'Knowledge', slug: 'knowledge' }, createAdminContext()),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.SPACE_SLUG_CONFLICT);
  });

  it('gets space details when user has view permission', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([{ space_id: TEST_SPACE_ID }]);

    const result = await service.getSpace(TEST_SPACE_ID, createViewerContext());

    expect(result).toMatchObject({
      id: TEST_SPACE_ID,
      name: 'Knowledge',
      wiki_repo_path: '/data/wiki/space-1',
      index_consistency_status: 'healthy',
      stats: {
        page_count: 0,
        source_count: 0,
        node_count: 0,
      },
    });
  });

  it('returns 404 for get space without permission', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.getSpace(TEST_SPACE_ID, createViewerContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.SPACE_NOT_FOUND);
  });

  it('returns 404 for nonexistent space', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.getSpace('missing-space', createViewerContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.SPACE_NOT_FOUND);
  });

  it('updates a space and ignores wiki_repo_path from input', async () => {
    const { service, db } = createServiceContext();
    const updatedRow = createSpaceRow({
      name: 'Updated Knowledge',
      wiki_repo_path: '/data/wiki/space-1',
    });
    db.queueSelect([createSpaceRow()]);
    db.queueUpdate([updatedRow]);

    const result = await service.updateSpace(
      TEST_SPACE_ID,
      { name: 'Updated Knowledge', wiki_repo_path: '/custom/path' },
      createAdminContext(),
    );

    const updateValue = getUpdateValue(db, 0);
    expect(updateValue.name).toBe('Updated Knowledge');
    expect(updateValue).not.toHaveProperty('wiki_repo_path');
    expect(result.wiki_repo_path).toBe('/data/wiki/space-1');
  });

  it('maps update slug conflict to SPACE_SLUG_CONFLICT', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([{ id: 'space-2' }]);

    const err = await getRejectedHttpException(
      service.updateSpace(TEST_SPACE_ID, { slug: 'product' }, createAdminContext()),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.SPACE_SLUG_CONFLICT);
    expect(db.updates).toHaveLength(0);
  });

  it('records audit event for updates', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createSpaceRow()]);
    db.queueUpdate([createSpaceRow({ strict_knowledge_only: false })]);

    await service.updateSpace(TEST_SPACE_ID, { strict_knowledge_only: false }, createAdminContext());

    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.SPACE_UPDATE,
        resource_type: 'space',
        resource_id: TEST_SPACE_ID,
        space_id: TEST_SPACE_ID,
        metadata_json: {
          changed_fields: ['strict_knowledge_only'],
        },
      }),
    );
  });

  it('archives a space, clears space permissions, publishes Redis event, and records audit', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([
      { group_id: TEST_GROUP_ID, permission: 'space:admin' },
      { group_id: TEST_GROUP_ID, permission: 'space:view' },
      { group_id: 'group-2', permission: 'space:view' },
    ]);
    db.queueUpdate([createSpaceRow({ status: 'archived' })]);

    await service.archiveSpace(TEST_SPACE_ID, createAdminContext());

    const updateValue = getUpdateValue(db, 0);
    expect(updateValue.status).toBe('archived');
    expect(hasPermissionVersionIncrement(updateValue)).toBe(true);
    expect(db.deletes.map((operation) => operation.table)).toEqual([space_permissions]);
    expect(findInsertedPermissionVersions(db)).toEqual([
      expect.objectContaining({
        change_type: 'space_archived',
        space_id: TEST_SPACE_ID,
        subject_id: TEST_GROUP_ID,
        old_permissions_json: ['space:admin', 'space:view'],
        new_permissions_json: [],
      }),
      expect.objectContaining({
        change_type: 'space_archived',
        space_id: TEST_SPACE_ID,
        subject_id: 'group-2',
        old_permissions_json: ['space:view'],
        new_permissions_json: [],
      }),
    ]);
    expect(redis.publish).toHaveBeenCalledWith(
      `permission_changed:${TEST_SPACE_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.SPACE_ARCHIVE,
        resource_type: 'space',
        resource_id: TEST_SPACE_ID,
        space_id: TEST_SPACE_ID,
        metadata_json: {
          space_id: TEST_SPACE_ID,
          space_name: 'Knowledge',
        },
      }),
    );
  });

  it('archives a space with 0 permissions', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([]);
    db.queueUpdate([createSpaceRow({ status: 'archived' })]);

    await service.archiveSpace(TEST_SPACE_ID, createAdminContext());

    expect(getUpdateValue(db, 0).status).toBe('archived');
    expect(db.deletes.map((operation) => operation.table)).toEqual([space_permissions]);
    expect(findInsertedPermissionVersions(db)).toEqual([]);
    expect(redis.publish).toHaveBeenCalledWith(
      `permission_changed:${TEST_SPACE_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.SPACE_ARCHIVE,
        resource_id: TEST_SPACE_ID,
      }),
    );
  });

  it('throws 404 when archiving a space that does not exist', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.archiveSpace('missing-space', createAdminContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.SPACE_NOT_FOUND);
    expect(db.updates).toHaveLength(0);
    expect(db.deletes).toHaveLength(0);
    expect(audit.push).not.toHaveBeenCalled();
  });

  it('throws 409 when archiving a space that is already archived', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createSpaceRow({ status: 'archived' })]);

    const err = await getRejectedHttpException(service.archiveSpace(TEST_SPACE_ID, createAdminContext()));

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.CONFLICT);
    expect(db.updates).toHaveLength(0);
    expect(db.deletes).toHaveLength(0);
    expect(audit.push).not.toHaveBeenCalled();
  });

  it('gets placeholder stats', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createSpaceRow({ index_consistency_status: 'stale' })]);
    db.queueSelect([{ space_id: TEST_SPACE_ID }]);

    await expect(service.getStats(TEST_SPACE_ID, createViewerContext())).resolves.toEqual({
      space_id: TEST_SPACE_ID,
      page_count: 0,
      source_count: 0,
      node_count: 0,
      edge_count: 0,
      index_consistency: 'stale',
    });
  });
});

function createServiceContext(): {
  service: SpaceService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
  redis: ReturnType<typeof createRedisMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const redis = createRedisMock();
  const service = new SpaceService(db.asDrizzle(), audit.service, redis);

  return { service, db, audit, redis };
}

function createViewerContext(overrides: Partial<SpaceContext> = {}): SpaceContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    userId: TEST_USER_ID,
    actorRole: 'viewer',
    ...overrides,
  };
}

function createAdminContext(): SpaceContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
    userId: TEST_ACTOR_ID,
    actorRole: 'admin',
  };
}

function getInsertValue(db: ScriptedDb, index: number): Record<string, unknown> {
  const operation = db.inserts[index];
  if (operation === undefined) {
    throw new Error(`Missing insert at index ${index}`);
  }

  return requireRecord(operation.value);
}

function getUpdateValue(db: ScriptedDb, index: number): Record<string, unknown> {
  const operation = db.updates[index];
  if (operation === undefined) {
    throw new Error(`Missing update at index ${index}`);
  }

  return requireRecord(operation.value);
}

function hasPermissionVersionIncrement(value: unknown): boolean {
  return 'permission_version' in requireRecord(value);
}

function findInsertedPermissionVersions(db: ScriptedDb): Record<string, unknown>[] {
  return db.inserts
    .map((operation) => operation.value)
    .filter((value): value is Record<string, unknown> => (
      isRecord(value) && typeof value.change_type === 'string'
    ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
