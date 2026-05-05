import 'reflect-metadata';

import { retrievalTraces } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import {
  ScriptedDb,
  TEST_TENANT_ID,
  TEST_USER_ID,
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { AdminIndexController } from '../admin-index.controller.js';
import { AdminIndexService } from '../admin-index.service.js';

describe('admin retrieval traces', () => {
  it('GET /api/admin/retrieval-traces/:id returns full trace payloads', async () => {
    const { controller, db } = createContext();
    const trace = createTraceRow();
    db.queueSelect([trace]);

    const result = await controller.getRetrievalTrace('trace-1', createRequest());

    expect(result.data).toMatchObject({
      id: 'trace-1',
      candidates_json: { vector: [{ chunkId: 'chunk-1' }], bm25: [], graph: [{ id: 'node-1' }] },
      acl_filtered_json: { wiki: [{ chunkId: 'chunk-1' }], graph: [{ id: 'node-1' }] },
      final_context_json: { wiki: [{ chunkId: 'chunk-1' }], graph_hints: [{ id: 'node-1' }] },
    });
  });

  it('returns 404 when the trace does not exist', async () => {
    const { service, db } = createContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.getRetrievalTrace('missing', { tenantId: TEST_TENANT_ID, actorUserId: TEST_USER_ID }),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe('RETRIEVAL_TRACE_NOT_FOUND');
  });
});

describe('admin model usage', () => {
  it('GET /api/admin/model-usage returns model/request_type aggregates with filters', async () => {
    const { controller, db } = createContext();
    db.queueSelect([
      {
        model_config_id: 'chat-model',
        request_type: 'static_rag',
        request_count: '2',
        input_tokens: '30',
        output_tokens: '10',
        total_tokens: '40',
        avg_latency_ms: '125',
      },
    ]);

    const result = await controller.getModelUsage(
      {
        start_time: '2026-05-01T00:00:00.000Z',
        end_time: '2026-05-05T00:00:00.000Z',
        request_type: 'static_rag',
        model_config_id: 'chat-model',
      },
      createRequest(),
    );

    expect(result.data).toEqual([
      {
        model_config_id: 'chat-model',
        request_type: 'static_rag',
        request_count: 2,
        input_tokens: 30,
        output_tokens: 10,
        total_tokens: 40,
        avg_latency_ms: 125,
      },
    ]);
  });

  it('rejects invalid time filters', async () => {
    const { service } = createContext();

    const err = await getRejectedHttpException(
      service.getModelUsage(
        { start_time: 'not-a-date' },
        { tenantId: TEST_TENANT_ID, actorUserId: TEST_USER_ID },
      ),
    );

    expect(err.getStatus()).toBe(422);
    expect(getHttpExceptionCode(err)).toBe('VALIDATION_ERROR');
  });
});

function createContext(): {
  controller: AdminIndexController;
  service: AdminIndexService;
  db: ScriptedDb;
} {
  const db = new ScriptedDb();
  const service = new AdminIndexService(db.asDrizzle(), { push: () => undefined } as never, {} as never);
  return {
    controller: new AdminIndexController(service),
    service,
    db,
  };
}

function createTraceRow(): typeof retrievalTraces.$inferSelect {
  return {
    id: 'trace-1',
    tenant_id: TEST_TENANT_ID,
    user_id: TEST_USER_ID,
    conversation_id: 'session-1',
    space_ids: ['space-1'],
    query: 'what is SSO?',
    retrieval_mode: 'wiki_only',
    candidates_json: { vector: [{ chunkId: 'chunk-1' }], bm25: [], graph: [{ id: 'node-1' }] },
    acl_filtered_json: { wiki: [{ chunkId: 'chunk-1' }], graph: [{ id: 'node-1' }] },
    final_context_json: { wiki: [{ chunkId: 'chunk-1' }], graph_hints: [{ id: 'node-1' }] },
    created_at: new Date('2026-05-01T00:00:00.000Z'),
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
  };
  headers: Record<string, string>;
} {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: 'admin@example.com',
      role: 'admin',
      group_ids: [],
      token_use: 'access',
    },
    headers: {},
  };
}
