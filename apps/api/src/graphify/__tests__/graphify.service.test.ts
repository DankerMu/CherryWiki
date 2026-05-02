import { JobStatus, jobs, type JobRow } from '@cherrygraph/job-core';
import { ErrorCode, graphReports, graphifyRuns } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import type { AuditEntry } from '../../audit/audit.service.js';
import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  createAuditMock,
  createSpaceRow,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { GraphifyService } from '../graphify.service.js';

type GraphifyRunRow = typeof graphifyRuns.$inferSelect;
type GraphReportRow = typeof graphReports.$inferSelect;

describe('GraphifyService', () => {
  it('createRun creates a pending run, enqueues a graphify job, and writes audit', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([]);
    db.queueSelect([{ parsed_uri: 's3://parsed/doc-1.md' }, { parsed_uri: 's3://parsed/doc-2.md' }]);
    db.queueInsert([createRunRow({ id: 'run-new', job_id: null })]);
    db.queueInsert([createJobRow({ id: 'job-new' })]);
    db.queueUpdate([createRunRow({ id: 'run-new', job_id: 'job-new' })]);

    const result = await service.createRun(
      TEST_SPACE_ID,
      { mode: 'full', trigger_type: 'manual' },
      createAdminContext(),
    );

    expect(result).toMatchObject({
      run_id: 'run-new',
      space_id: TEST_SPACE_ID,
      status: 'pending',
    });
    expect(db.inserts[0]?.table).toBe(graphifyRuns);
    expect(db.inserts[1]?.table).toBe(jobs);
    const runInsert = requireRecord(db.inserts[0]?.value);
    const jobInsert = requireRecord(db.inserts[1]?.value);
    expect(jobInsert).toMatchObject({
      queue_name: 'graphify',
      type: 'graphify',
      payload_json: expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        space_id: TEST_SPACE_ID,
        run_id: runInsert.id,
        input_uris: ['s3://parsed/doc-1.md', 's3://parsed/doc-2.md'],
      }) as Record<string, unknown>,
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'graphify.run.create',
        resource_type: 'graphify_run',
        resource_id: 'run-new',
        space_id: TEST_SPACE_ID,
      }) as AuditEntry,
    );
  });

  it('createRun rejects concurrent pending or running runs', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([{ id: 'run-existing' }]);

    const err = await getRejectedHttpException(
      service.createRun(TEST_SPACE_ID, { mode: 'full', trigger_type: 'manual' }, createAdminContext()),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.GRAPHIFY_RUN_IN_PROGRESS);
    expect(db.inserts).toHaveLength(0);
  });

  it('listRuns returns a paginated response with status filters', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createRunRow({ status: 'succeeded' })]);
    db.queueSelect([{ total: 1 }]);

    const result = await service.listRuns(
      { status: 'succeeded', page: 1, per_page: 10 },
      createAdminContext(),
    );

    expect(result.data).toEqual([
      expect.objectContaining({
        run_id: 'run-1',
        status: 'succeeded',
      }),
    ]);
    expect(result.pagination).toEqual({ page: 1, per_page: 10, total: 1, has_next: false });
    expect(db.limitCalls).toContain(10);
  });

  it('getRun returns GRAPHIFY_RUN_NOT_FOUND for missing runs', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.getRun('missing', createAdminContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.GRAPHIFY_RUN_NOT_FOUND);
  });

  it('cancelRun cancels the run, marks a pending job cancelled, and writes audit', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createRunRow({ status: 'pending', job_id: 'job-1' })]);
    db.queueSelect([createSpaceRow()]);
    db.queueUpdate([createRunRow({ status: 'cancelled', completed_at: new Date('2026-05-01T01:00:00.000Z') })]);
    db.queueSelect([createJobRow({ status: JobStatus.PENDING })]);
    db.queueUpdate([createJobRow({ status: JobStatus.CANCELLED })]);

    const result = await service.cancelRun('run-1', createAdminContext());

    expect(result).toEqual({ run_id: 'run-1', status: 'cancelling' });
    expect(requireRecord(db.updates[0]?.value)).toMatchObject({
      status: 'cancelled',
    });
    expect(requireRecord(db.updates[1]?.value)).toMatchObject({
      status: JobStatus.CANCELLED,
      cancel_requested_at: expect.any(Date) as Date,
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'graphify.run.cancel',
        resource_id: 'run-1',
      }) as AuditEntry,
    );
  });

  it('cancelRun rejects terminal runs', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createRunRow({ status: 'succeeded' })]);
    db.queueSelect([createSpaceRow()]);

    const err = await getRejectedHttpException(service.cancelRun('run-1', createAdminContext()));

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.GRAPHIFY_RUN_NOT_CANCELLABLE);
    expect(db.updates).toHaveLength(0);
  });

  it('retryRun creates a new run with the failed run parameters', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createRunRow({ status: 'failed', job_id: 'job-1' })]);
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([]);
    db.queueSelect([
      createJobRow({
        payload_json: {
          input_scope: { source_document_ids: ['source-1'] },
          options: { wiki: true, directed: true },
        },
      }),
    ]);
    db.queueSelect([{ parsed_uri: 's3://parsed/source-1.md' }]);
    db.queueInsert([createRunRow({ id: 'run-retry', job_id: null })]);
    db.queueInsert([createJobRow({ id: 'job-retry' })]);
    db.queueUpdate([createRunRow({ id: 'run-retry', job_id: 'job-retry' })]);

    const result = await service.retryRun('run-1', createAdminContext());

    expect(result.run_id).toBe('run-retry');
    const jobInsert = requireRecord(db.inserts[1]?.value);
    expect(jobInsert.payload_json).toMatchObject({
      input_scope: { source_document_ids: ['source-1'] },
      options: { wiki: true, directed: true },
      input_uris: ['s3://parsed/source-1.md'],
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'graphify.run.retry',
        resource_id: 'run-retry',
        metadata_json: { original_run_id: 'run-1' },
      }) as AuditEntry,
    );
  });

  it('retryRun rejects non-failed runs', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createRunRow({ status: 'succeeded' })]);
    db.queueSelect([createSpaceRow()]);

    const err = await getRejectedHttpException(service.retryRun('run-1', createAdminContext()));

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.GRAPHIFY_RUN_NOT_RETRYABLE);
  });

  it('getReport returns markdown report content', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createRunRow({ status: 'succeeded' })]);
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([createReportRow()]);

    const result = await service.getReport('run-1', createAdminContext());

    expect(result).toEqual({
      run_id: 'run-1',
      report_format: 'markdown',
      content: '# Graph report',
      generated_at: new Date('2026-05-01T00:05:00.000Z'),
    });
  });

  it('getGraphSummary aggregates graph table counts', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createRunRow({ status: 'succeeded' })]);
    db.queueSelect([{ total: 3 }]);
    db.queueSelect([{ total: 4 }]);
    db.queueSelect([{ total: 2 }]);

    const result = await service.getGraphSummary('run-1', createAdminContext());

    expect(result).toEqual({
      run_id: 'run-1',
      summary: {
        node_count: 3,
        edge_count: 4,
        community_count: 2,
      },
      top_entities: [],
      schema_version: 'v1',
    });
  });

  it('handleRunCompletion stores output URIs, stats, and succeeded status', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createRunRow({ stats_json: { input_scope: { source_document_ids: ['source-1'] } } })]);
    db.queueUpdate([
      createRunRow({
        status: 'succeeded',
        graph_json_uri: 's3://out/graph.json',
        report_uri: 's3://out/GRAPH_REPORT.md',
        stats_json: {
          input_scope: { source_document_ids: ['source-1'] },
          node_count: 5,
          edge_count: 7,
        },
        completed_at: new Date('2026-05-01T01:00:00.000Z'),
      }),
    ]);

    const result = await service.handleRunCompletion('run-1', {
      graph_json_uri: 's3://out/graph.json',
      report_uri: 's3://out/GRAPH_REPORT.md',
      stats_json: { node_count: 5, edge_count: 7 },
    });

    expect(result).toMatchObject({
      run_id: 'run-1',
      status: 'succeeded',
      result: {
        nodes_created: 5,
        edges_created: 7,
        graph_json_uri: 's3://out/graph.json',
        report_uri: 's3://out/GRAPH_REPORT.md',
      },
    });
    expect(requireRecord(db.updates[0]?.value)).toMatchObject({
      status: 'succeeded',
      graph_json_uri: 's3://out/graph.json',
      report_uri: 's3://out/GRAPH_REPORT.md',
      error_json: null,
    });
  });

  it('handleRunCompletion skips already-cancelled runs', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([
      createRunRow({
        status: 'cancelled',
        completed_at: new Date('2026-05-01T00:30:00.000Z'),
      }),
    ]);
    db.queueUpdate([]);

    const result = await service.handleRunCompletion('run-1', {
      graph_json_uri: 's3://out/graph.json',
      stats_json: { node_count: 5 },
    });

    expect(result).toMatchObject({
      run_id: 'run-1',
      status: 'cancelled',
      result: {
        graph_json_uri: null,
      },
    });
    expect(db.updates).toHaveLength(1);
    expect(requireRecord(db.updates[0]?.value)).toMatchObject({
      status: 'succeeded',
      graph_json_uri: 's3://out/graph.json',
    });
  });

  it('handleRunFailure marks an active run failed with error_json', async () => {
    const { service, db } = createServiceContext();

    await service.handleRunFailure('run-1', {
      error_json: { code: 'WORKER_FAILURE', message: 'worker crashed' },
    });

    expect(db.updates).toHaveLength(1);
    expect(requireRecord(db.updates[0]?.value)).toMatchObject({
      status: 'failed',
      error_json: { code: 'WORKER_FAILURE', message: 'worker crashed' },
      completed_at: expect.any(Date) as Date,
    });
  });

  it('throws 403 when graphify view permission is missing', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createRunRow()]);
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.getRun('run-1', {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        actorUserId: TEST_USER_ID,
        actorRole: 'editor',
      }),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
  });
});

function createServiceContext(): {
  service: GraphifyService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const service = new GraphifyService(db.asDrizzle(), audit.service);
  return { service, db, audit };
}

function createAdminContext(): {
  tenantId: string;
  actorUserId: string;
  actorRole: string;
  userId: string;
} {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    actorRole: 'admin',
    userId: TEST_USER_ID,
  };
}

function createRunRow(overrides: Partial<GraphifyRunRow> = {}): GraphifyRunRow {
  return {
    id: 'run-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    job_id: 'job-1',
    trigger_type: 'manual',
    mode: 'full',
    status: 'pending',
    input_version: null,
    output_version: null,
    graphify_ref: null,
    graph_json_uri: null,
    wiki_output_uri: null,
    report_uri: null,
    graph_html_uri: null,
    schema_version: 'v1',
    stats_json: {},
    error_json: null,
    created_by: TEST_USER_ID,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    queue_name: 'graphify',
    type: 'graphify',
    priority: 100,
    status: JobStatus.PENDING,
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: 3600,
    locked_by: null,
    locked_at: null,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: {},
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: TEST_USER_ID,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function createReportRow(overrides: Partial<GraphReportRow> = {}): GraphReportRow {
  return {
    id: 'report-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    graphify_run_id: 'run-1',
    report_markdown: '# Graph report',
    stats_json: {},
    created_at: new Date('2026-05-01T00:05:00.000Z'),
    ...overrides,
  };
}
