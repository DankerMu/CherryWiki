import { ErrorCode, model_configs } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { ModelConfigService } from '../model-config.service.js';
import {
  TEST_ACTOR_ID,
  TEST_GROUP_ID,
  TEST_TENANT_ID,
  ScriptedDb,
  createAuditMock,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';

type ModelConfigRow = typeof model_configs.$inferSelect;

const TEST_MODEL_ID = 'model-1';

describe('ModelConfigService', () => {
  it('lists models with API field mapping', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([
      createModelConfigRow({
        display_name: 'GPT-4.1',
        enabled: true,
        base_url: 'https://api.openai.com/v1',
        max_tokens: 8192,
        visible_group_ids: [TEST_GROUP_ID],
      }),
      createModelConfigRow({
        id: 'model-2',
        model_id: 'text-embedding-3-large',
        model_type: 'embedding',
        display_name: 'Embedding',
        enabled: false,
        embedding_dim: 3072,
      }),
    ]);
    db.queueSelect([{ total: 2 }]);

    const result = await service.listModels({ page: 1, per_page: 20 }, createContext());

    expect(result.data).toEqual([
      expect.objectContaining({
        id: TEST_MODEL_ID,
        name: 'GPT-4.1',
        provider: 'openai',
        model_id: 'gpt-4.1',
        model_type: 'chat',
        status: 'active',
        config: {
          base_url: 'https://api.openai.com/v1',
          embedding_dim: null,
          max_tokens: 8192,
          rate_limit_rpm: null,
        },
        visible_group_ids: [TEST_GROUP_ID],
      }),
      expect.objectContaining({
        id: 'model-2',
        name: 'Embedding',
        status: 'disabled',
      }),
    ]);
    expect(result.data[1]?.config.embedding_dim).toBe(3072);
    expect(result.pagination.total).toBe(2);
  });

  it('creates a model and records admin.model.create', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([]);

    const result = await service.createModel(
      {
        provider: ' openai ',
        model_id: 'gpt-4.1',
        model_type: 'chat',
        display_name: 'GPT-4.1',
        base_url: 'https://api.openai.com/v1',
        encrypted_api_key_ref: 'secret:openai_key',
        max_tokens: 8192,
        enabled: true,
        visible_group_ids: [TEST_GROUP_ID],
      },
      createContext(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        name: 'GPT-4.1',
        provider: 'openai',
        model_id: 'gpt-4.1',
        status: 'active',
        visible_group_ids: [TEST_GROUP_ID],
      }),
    );
    expect(requireRecord(db.inserts[0]?.value)).toEqual(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        provider: 'openai',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        actor_user_id: TEST_ACTOR_ID,
        action: AUDIT_EVENTS.ADMIN_MODEL_CREATE,
        resource_type: 'model_config',
      }),
    );
  });

  it('maps duplicate provider and model_id to MODEL_NAME_CONFLICT', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createModelConfigRow()]);

    const err = await getRejectedHttpException(
      service.createModel(
        {
          provider: 'openai',
          model_id: 'gpt-4.1',
          model_type: 'chat',
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.MODEL_NAME_CONFLICT);
    expect(db.inserts).toHaveLength(0);
  });

  it('rejects creating a second enabled embedding model', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);
    db.queueSelect([{ total: 1 }]);

    const err = await getRejectedHttpException(
      service.createModel(
        {
          provider: 'openai',
          model_id: 'text-embedding-3-large',
          model_type: 'embedding',
          enabled: true,
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.EMBEDDING_LIMIT_EXCEEDED);
    expect(db.inserts).toHaveLength(0);
  });

  it('updates a model and records admin.model.update', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createModelConfigRow({ max_tokens: 8192 })]);
    db.queueUpdate([createModelConfigRow({ max_tokens: 16384 })]);

    const result = await service.updateModel(TEST_MODEL_ID, { max_tokens: 16384 }, createContext());

    expect(result.config.max_tokens).toBe(16384);
    expect(requireRecord(db.updates[0]?.value)).toEqual(expect.objectContaining({ max_tokens: 16384 }));
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_MODEL_UPDATE,
        resource_id: TEST_MODEL_ID,
      }),
    );
  });

  it('returns MODEL_NOT_FOUND when updating a missing model', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.updateModel('missing-model', { enabled: false }, createContext()),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.MODEL_NOT_FOUND);
  });

  it('rejects enabling a second embedding model through update', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createModelConfigRow({ model_type: 'embedding', enabled: false })]);
    db.queueSelect([{ total: 1 }]);

    const err = await getRejectedHttpException(
      service.updateModel(TEST_MODEL_ID, { enabled: true }, createContext()),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.EMBEDDING_LIMIT_EXCEEDED);
    expect(db.updates).toHaveLength(0);
  });

  it('returns reachable when connectivity test resolves the secret', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(
        TEST_MODEL_ID,
        { test_prompt: 'Hello' },
        createContext(),
      );

      expect(result.reachable).toBe(true);
      expect(result.latency_ms).toBeGreaterThanOrEqual(1);
      expect(result.error).toBeUndefined();
    });
  });

  it('returns SECRET_NOT_FOUND when connectivity secret cannot be resolved', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:missing_key' })]);

    await withEnv('MISSING_KEY', undefined, async () => {
      const err = await getRejectedHttpException(
        service.testConnectivity(TEST_MODEL_ID, {}, createContext()),
      );

      expect(err.getStatus()).toBe(422);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.SECRET_NOT_FOUND);
    });
  });

  it('returns MODEL_NOT_FOUND when connectivity test target is missing', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.testConnectivity('missing-model', {}, createContext()),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.MODEL_NOT_FOUND);
  });

  it('records admin.model.test audit for connectivity tests', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      await service.testConnectivity(TEST_MODEL_ID, {}, createContext());
    });

    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_MODEL_TEST,
        tenant_id: TEST_TENANT_ID,
        actor_user_id: TEST_ACTOR_ID,
        resource_type: 'model_config',
        resource_id: TEST_MODEL_ID,
      }),
    );
    expect(findAuditMetadata(audit, AUDIT_EVENTS.ADMIN_MODEL_TEST, TEST_MODEL_ID)).toMatchObject({
      model_id: 'gpt-4.1',
      reachable: true,
    });
  });
});

function createServiceContext(): {
  service: ModelConfigService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const service = new ModelConfigService(db.asDrizzle(), audit.service);

  return { service, db, audit };
}

function createContext(
  overrides: Partial<{ tenantId: string; actorUserId: string }> = {},
): { tenantId: string; actorUserId: string } {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
    ...overrides,
  };
}

function createModelConfigRow(overrides: Partial<ModelConfigRow> = {}): ModelConfigRow {
  return {
    id: TEST_MODEL_ID,
    tenant_id: TEST_TENANT_ID,
    provider: 'openai',
    model_id: 'gpt-4.1',
    model_type: 'chat',
    display_name: 'GPT-4.1',
    base_url: 'https://api.openai.com/v1',
    encrypted_api_key_ref: 'secret:openai_key',
    embedding_dim: null,
    max_tokens: null,
    rate_limit_rpm: null,
    enabled: true,
    visible_group_ids: [],
    created_at: new Date('2026-04-04T00:00:00.000Z'),
    updated_at: new Date('2026-04-04T00:00:00.000Z'),
    ...overrides,
  };
}

function findAuditMetadata(
  audit: ReturnType<typeof createAuditMock>,
  action: string,
  resourceId: string,
): Record<string, unknown> | undefined {
  const entry = audit.push.mock.calls
    .map(([auditEntry]) => auditEntry)
    .find((auditEntry) => auditEntry.action === action && auditEntry.resource_id === resourceId);
  return entry?.metadata_json;
}

async function withEnv(name: string, value: string | undefined, callback: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    await callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}
