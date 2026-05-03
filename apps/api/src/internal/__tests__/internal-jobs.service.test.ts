import {
  JobEventRepository,
  JobRepository,
  JobStateMachine,
  JobStatus,
  QueueFactory,
  QUEUE_INDEXING,
  RedisJobLock,
  type JobRow,
} from '@cherrygraph/job-core';
import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalJobsService } from '../internal-jobs.service.js';

describe('InternalJobsService', () => {
  const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

  afterEach(() => {
    if (originalDefaultTenantId === undefined) {
      delete process.env.DEFAULT_TENANT_ID;
    } else {
      process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
    }

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls pending jobs by type and returns an empty array when none exist', async () => {
    delete process.env.DEFAULT_TENANT_ID;
    const service = createService();
    const findPendingByTypeSpy = vi.spyOn(JobRepository, 'findPendingByType').mockResolvedValueOnce([createJobRow()]);

    await expect(service.pollPendingJobs('graphify', 2)).resolves.toEqual([
      expect.objectContaining({
        job_id: 'job-1',
        type: 'graphify',
        status: JobStatus.PENDING,
      }),
    ]);
    expect(findPendingByTypeSpy).toHaveBeenCalledWith(expect.anything(), 'default', 'graphify', 2);

    findPendingByTypeSpy.mockResolvedValueOnce([]);
    await expect(service.pollPendingJobs('graphify', 1)).resolves.toEqual([]);
  });

  it('records progress for the worker that owns the running job', async () => {
    const service = createService();
    vi.spyOn(JobRepository, 'findById').mockResolvedValue(
      createJobRow({
        status: JobStatus.RUNNING,
        locked_by: 'worker-1',
        locked_at: new Date('2026-04-30T11:55:00.000Z'),
        started_at: new Date('2026-04-30T11:55:00.000Z'),
      }),
    );
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);

    const result = await service.reportProgress('job-1', {
      worker_id: 'worker-1',
      percent: 45,
      stage: 'chunking',
    });

    expect(result).toMatchObject({
      job_id: 'job-1',
      status: JobStatus.RUNNING,
      progress: {
        percent: 45,
        stage: 'chunking',
      },
    });
    expect(eventSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        job_id: 'job-1',
        event_type: 'progress_updated',
        detail_json: {
          percent: 45,
          stage: 'chunking',
        },
      }),
    );
  });

  it('rejects progress reports when the worker does not own the job lock', async () => {
    const service = createService();
    vi.spyOn(JobRepository, 'findById').mockResolvedValue(
      createJobRow({
        status: JobStatus.RUNNING,
        locked_by: 'worker-2',
        locked_at: new Date('2026-04-30T11:55:00.000Z'),
        started_at: new Date('2026-04-30T11:55:00.000Z'),
      }),
    );

    await expect(
      service.reportProgress('job-1', {
        worker_id: 'worker-1',
        percent: 50,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rolls back pending job activation when the worker loses the Redis lock before commit', async () => {
    const service = createService();
    const runningJob = createJobRow({
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(createJobRow());
    const transitionSpy = vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(runningJob);
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'acquire').mockResolvedValue(false);

    await expect(
      service.reportProgress('job-1', {
        worker_id: 'worker-1',
        percent: 10,
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(transitionSpy).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      JobStatus.PENDING,
      JobStatus.RUNNING,
      expect.objectContaining({
        locked_by: 'worker-1',
      }),
    );
    expect(eventSpy).not.toHaveBeenCalled();
  });

  it('releases a Redis lock when pending job activation fails after acquiring it', async () => {
    const service = createService();
    const runningJob = createJobRow({
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
    });
    const eventError = new Error('event insert failed');

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(createJobRow());
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'acquire').mockResolvedValue(true);
    vi.spyOn(JobEventRepository, 'create').mockRejectedValue(eventError);
    const releaseSpy = vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(
      service.reportProgress('job-1', {
        worker_id: 'worker-1',
        percent: 10,
      }),
    ).rejects.toBe(eventError);

    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1');
  });

  it('transitions a running job to succeeded, releases the lock, and writes an event', async () => {
    const service = createService();
    const runningJob = createJobRow({
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
    });
    const completedJob = createJobRow({
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      locked_at: null,
      result_json: { output: 'done' },
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    const transitionSpy = vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    const releaseSpy = vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    const result = await service.reportComplete('job-1', {
      worker_id: 'worker-1',
      result_json: { output: 'done' },
    });

    expect(result).toMatchObject({
      job_id: 'job-1',
      status: JobStatus.SUCCEEDED,
      result_json: { output: 'done' },
    });
    expect(transitionSpy).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      JobStatus.RUNNING,
      JobStatus.SUCCEEDED,
      expect.objectContaining({
        result_json: { output: 'done' },
        locked_by: null,
        locked_at: null,
      }),
    );
    expect(eventSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        job_id: 'job-1',
        event_type: 'status_changed',
      }),
    );
    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1');
  });

  it('creates and enqueues an indexing job when graphify completion succeeds', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const graphifyService = {
      handleRunCompletion: vi.fn(() => Promise.resolve({ status: 'succeeded' })),
    };
    const service = new InternalJobsService(
      db.asDb() as never,
      redis.asClient() as never,
      undefined,
      undefined,
      graphifyService as never,
    );
    const runningJob = createJobRow({
      id: 'graphify-job-1',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      type: 'graphify',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: { run_id: 'run-1' },
    });
    const completedJob = createJobRow({
      ...runningJob,
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      locked_at: null,
      result_json: { graph_json_uri: 's3://bucket/graph.json' },
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });
    const indexingJob = createJobRow({
      id: 'index-job-1',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      queue_name: QUEUE_INDEXING,
      type: 'reindex',
    });
    const queue = createQueueMock();

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(indexingJob);
    const createQueueSpy = vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);

    await service.reportComplete('graphify-job-1', {
      worker_id: 'worker-1',
      result_json: { graph_json_uri: 's3://bucket/graph.json' },
    });

    expect(graphifyService.handleRunCompletion).toHaveBeenCalledWith('run-1', {
      graph_json_uri: 's3://bucket/graph.json',
    });
    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant_id: 'tenant-1',
        space_id: 'space-1',
        queue_name: QUEUE_INDEXING,
        type: 'reindex',
        payload_json: {
          tenant_id: 'tenant-1',
          space_id: 'space-1',
          graphify_run_id: 'run-1',
          trigger: 'graphify_completion',
          scope: 'full',
        },
        created_by: 'user-1',
      }),
    );
    expect(createQueueSpy).toHaveBeenCalledWith(QUEUE_INDEXING, expect.anything());
    expect(queue.add).toHaveBeenCalledWith('reindex', { jobId: 'index-job-1' });
    expect(queue.close).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue indexing when graphify completion handling fails before import finishes', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const graphifyService = {
      handleRunCompletion: vi.fn(() => Promise.reject(new Error('quarantined output'))),
    };
    const service = new InternalJobsService(
      db.asDb() as never,
      redis.asClient() as never,
      undefined,
      undefined,
      graphifyService as never,
    );
    const runningJob = createJobRow({
      id: 'graphify-job-1',
      type: 'graphify',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: { run_id: 'run-1' },
    });
    const completedJob = createJobRow({
      ...runningJob,
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      locked_at: null,
      result_json: { graph_json_uri: 's3://bucket/graph.json' },
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);
    const createJobSpy = vi.spyOn(JobRepository, 'create');
    const createQueueSpy = vi.spyOn(QueueFactory, 'createQueue');

    await service.reportComplete('graphify-job-1', {
      worker_id: 'worker-1',
      result_json: { graph_json_uri: 's3://bucket/graph.json' },
    });

    expect(createJobSpy).not.toHaveBeenCalled();
    expect(createQueueSpy).not.toHaveBeenCalled();
  });

  it('completes upload validation when a validation job succeeds', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const uploadsService = {
      validateQuarantinedUpload: vi.fn(() => Promise.resolve({ pass: true })),
      completeValidation: vi.fn(() => Promise.resolve({
        source_document_id: 'source-1',
        file_blob_id: 'blob-1',
        job_id: 'job-ingestion',
        status: 'archived',
        created: true,
      })),
    };
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never, uploadsService as never);
    const runningJob = createJobRow({
      tenant_id: 'tenant-1',
      type: 'validation',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: {
        source_document_id: 'source-1',
        quarantine_uri: 's3://cherrywiki-uploads/quarantine/tenant-1/space-1/upload-1.pdf',
        quarantine_key: 'quarantine/tenant-1/space-1/upload-1.pdf',
      },
      created_by: 'user-1',
    });
    const completedJob = createJobRow({
      ...runningJob,
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      locked_at: null,
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(
      service.reportComplete('job-1', {
        worker_id: 'worker-1',
        result_json: { clean: true },
      }),
    ).resolves.toMatchObject({
      job_id: 'job-1',
      status: JobStatus.SUCCEEDED,
    });
    expect(uploadsService.validateQuarantinedUpload).toHaveBeenCalledWith(
      {
        sourceDocumentId: 'source-1',
        quarantineKey: 'quarantine/tenant-1/space-1/upload-1.pdf',
      },
      {
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        userId: 'user-1',
      },
    );
    expect(uploadsService.completeValidation).toHaveBeenCalledWith(
      {
        sourceDocumentId: 'source-1',
        quarantineKey: 'quarantine/tenant-1/space-1/upload-1.pdf',
      },
      {
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        userId: 'user-1',
      },
    );
  });

  it('does not archive the upload when validation completion rejects the file', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const uploadsService = {
      validateQuarantinedUpload: vi.fn(() => Promise.resolve({
        pass: false,
        code: ErrorCode.MIME_MISMATCH,
        reason: 'bad mime',
        details: {},
        sourceDocument: { id: 'source-1', status: 'security_rejected' },
      })),
      completeValidation: vi.fn(),
    };
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never, uploadsService as never);
    const runningJob = createJobRow({
      tenant_id: 'tenant-1',
      type: 'validation',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: {
        source_document_id: 'source-1',
        quarantine_key: 'quarantine/tenant-1/space-1/upload-1.pdf',
      },
      created_by: 'user-1',
    });
    const completedJob = createJobRow({
      ...runningJob,
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      locked_at: null,
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(
      service.reportComplete('job-1', {
        worker_id: 'worker-1',
        result_json: { clean: false },
      }),
    ).resolves.toMatchObject({
      job_id: 'job-1',
      status: JobStatus.SUCCEEDED,
    });
    expect(uploadsService.validateQuarantinedUpload).toHaveBeenCalledTimes(1);
    expect(uploadsService.completeValidation).not.toHaveBeenCalled();
  });

  it('links fetched URL snapshots and queues ingestion when a url_fetch job succeeds', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const uploadsService = {
      linkBlob: vi.fn(() => Promise.resolve({
        id: 'source-url',
        status: 'archived',
        sha256: 'a'.repeat(64),
      })),
    };
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never, uploadsService as never);
    const runningJob = createJobRow({
      tenant_id: 'tenant-1',
      type: 'url_fetch',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: {
        source_document_id: 'source-url',
        url: 'https://example.com/docs',
      },
      created_by: 'user-1',
    });
    const completedJob = createJobRow({
      ...runningJob,
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      locked_at: null,
      result_json: {
        sha256: 'a'.repeat(64),
        snapshot_uri: 's3://cherrywiki-archives/archive/tenant-1/space-1/2026/05/01/a_example.com.snapshot',
        content_type: 'text/html',
        size_bytes: 42,
        hostname: 'example.com',
      },
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(
      service.reportComplete('job-1', {
        worker_id: 'worker-1',
        result_json: completedJob.result_json as Record<string, unknown>,
      }),
    ).resolves.toMatchObject({
      job_id: 'job-1',
      status: JobStatus.SUCCEEDED,
    });
    expect(uploadsService.linkBlob).toHaveBeenCalledWith(
      {
        sourceDocumentId: 'source-url',
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
        mimeType: 'text/html',
        storageUri: 's3://cherrywiki-archives/archive/tenant-1/space-1/2026/05/01/a_example.com.snapshot',
        filename: 'example.com',
      },
      {
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        userId: 'user-1',
      },
    );
  });

  it('marks ingestion complete and triggers graphify handoff when an ingestion job succeeds', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const uploadsService = {
      markIngestionComplete: vi.fn(() => Promise.resolve()),
      handleGraphifyHandoff: vi.fn(() => Promise.resolve(null)),
    };
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never, uploadsService as never);
    const runningJob = createJobRow({
      tenant_id: 'tenant-1',
      type: 'ingestion',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: {
        source_document_id: 'source-1',
      },
    });
    const completedJob = createJobRow({
      ...runningJob,
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      locked_at: null,
      result_json: {
        parsed_uri: 's3://cherrywiki-parsed/source-1.md',
        preview_uri: 's3://cherrywiki-previews/source-1.json',
      },
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(
      service.reportComplete('job-1', {
        worker_id: 'worker-1',
        result_json: completedJob.result_json as Record<string, unknown>,
      }),
    ).resolves.toMatchObject({
      job_id: 'job-1',
      status: JobStatus.SUCCEEDED,
    });
    expect(uploadsService.markIngestionComplete).toHaveBeenCalledWith(
      'source-1',
      {
        parsedUri: 's3://cherrywiki-parsed/source-1.md',
        previewUri: 's3://cherrywiki-previews/source-1.json',
      },
      { tenantId: 'tenant-1' },
    );
    expect(uploadsService.handleGraphifyHandoff).toHaveBeenCalledWith('source-1', { tenantId: 'tenant-1' });
  });

  it('logs but does not throw when graphify handoff fails after ingestion completion', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const uploadsService = {
      markIngestionComplete: vi.fn(() => Promise.resolve()),
      handleGraphifyHandoff: vi.fn(() => Promise.reject(new Error('graphify queue full'))),
    };
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never, uploadsService as never);
    const runningJob = createJobRow({
      tenant_id: 'tenant-1',
      type: 'ingestion',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: { source_document_id: 'source-1' },
    });
    const completedJob = createJobRow({
      ...runningJob,
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      locked_at: null,
      result_json: { parsed_uri: 's3://parsed/source-1.md' },
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(
      service.reportComplete('job-1', {
        worker_id: 'worker-1',
        result_json: completedJob.result_json as Record<string, unknown>,
      }),
    ).resolves.toMatchObject({
      job_id: 'job-1',
      status: JobStatus.SUCCEEDED,
    });
    expect(uploadsService.markIngestionComplete).toHaveBeenCalled();
    expect(uploadsService.handleGraphifyHandoff).toHaveBeenCalled();
  });

  it('records an audit event when a url_fetch job fails with ssrf_blocked', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const auditService = { push: vi.fn() };
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never, undefined, auditService as never);
    const runningJob = createJobRow({
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      type: 'url_fetch',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: {
        source_document_id: 'source-url',
        url: 'http://localhost/admin',
      },
      created_by: 'user-1',
    });
    const failedJob = createJobRow({
      ...runningJob,
      status: JobStatus.FAILED,
      locked_by: null,
      locked_at: null,
      attempt_count: 1,
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });
    const errorJson = {
      error_type: 'ssrf_blocked',
      target_url: 'http://localhost/admin',
      resolved_ip: '127.0.0.1',
      block_reason: 'private_ip_localhost',
      redirect_chain: [],
    };

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(failedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await service.reportFailure('job-1', {
      worker_id: 'worker-1',
      error_json: errorJson,
      retryable: false,
    });

    expect(auditService.push).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        actor_user_id: 'user-1',
        action: 'upload.ssrf_blocked',
        resource_type: 'source_document',
        resource_id: 'source-url',
        space_id: 'space-1',
        metadata_json: {
          source_document_id: 'source-url',
          target_url: 'http://localhost/admin',
          resolved_ip: '127.0.0.1',
          block_reason: 'private_ip_localhost',
          redirect_chain: [],
        },
      }),
    );
  });

  it('marks a graphify run failed when a graphify job reaches terminal failure', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const graphifyService = {
      handleRunFailure: vi.fn(() => Promise.resolve()),
    };
    const service = new InternalJobsService(
      db.asDb() as never,
      redis.asClient() as never,
      undefined,
      undefined,
      graphifyService as never,
    );
    const runningJob = createJobRow({
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      type: 'graphify',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: {
        run_id: 'run-1',
      },
    });
    const failedJob = createJobRow({
      ...runningJob,
      status: JobStatus.FAILED,
      locked_by: null,
      locked_at: null,
      attempt_count: 1,
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });
    const errorJson = { code: 'GRAPHIFY_ERROR', message: 'worker crashed' };

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(failedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);
    const createJobSpy = vi.spyOn(JobRepository, 'create');
    const createQueueSpy = vi.spyOn(QueueFactory, 'createQueue');

    const result = await service.reportFailure('job-1', {
      worker_id: 'worker-1',
      error_json: errorJson,
      retryable: false,
    });

    expect(result.will_retry).toBe(false);
    expect(graphifyService.handleRunFailure).toHaveBeenCalledWith('run-1', {
      error_json: errorJson,
    });
    expect(createJobSpy).not.toHaveBeenCalled();
    expect(createQueueSpy).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'non-retryable failures',
      attemptCount: 0,
      maxAttempts: 3,
      retryable: false,
    },
    {
      label: 'the last allowed attempt',
      attemptCount: 2,
      maxAttempts: 3,
      retryable: true,
    },
  ])('marks ingestion failed for $label', async ({ attemptCount, maxAttempts, retryable }) => {
    const db = createDb();
    const redis = createRedisMock();
    const uploadsService = {
      markIngestionFailed: vi.fn(() => Promise.resolve()),
    };
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never, uploadsService as never);
    const runningJob = createJobRow({
      tenant_id: 'tenant-1',
      type: 'ingestion',
      status: JobStatus.RUNNING,
      attempt_count: attemptCount,
      max_attempts: maxAttempts,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
      payload_json: {
        source_document_id: 'source-1',
      },
    });
    const failedJob = createJobRow({
      ...runningJob,
      status: JobStatus.FAILED,
      attempt_count: attemptCount + 1,
      locked_by: null,
      locked_at: null,
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(failedJob);
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    const result = await service.reportFailure('job-1', {
      worker_id: 'worker-1',
      error_json: { code: 'PARSE_ERROR', message: 'boom' },
      retryable,
    });

    expect(result.will_retry).toBe(false);
    expect(uploadsService.markIngestionFailed).toHaveBeenCalledWith('source-1', { tenantId: 'tenant-1' });
  });

  it('fails a running job and schedules a retry when attempts remain', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const service = createService();
    const runningJob = createJobRow({
      status: JobStatus.RUNNING,
      attempt_count: 0,
      max_attempts: 3,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:55:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
    });
    const failedJob = createJobRow({
      status: JobStatus.FAILED,
      attempt_count: 1,
      locked_by: null,
      locked_at: null,
      error_json: { code: 'PARSE_ERROR', message: 'boom' },
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
    });
    const retriedJob = createJobRow({
      status: JobStatus.PENDING,
      attempt_count: 1,
      locked_by: null,
      locked_at: null,
      next_run_at: new Date('2026-04-30T12:01:00.000Z'),
      error_json: { code: 'PARSE_ERROR', message: 'boom' },
      completed_at: null,
      started_at: null,
    });

    vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    const transitionSpy = vi
      .spyOn(JobStateMachine, 'transition')
      .mockResolvedValueOnce(failedJob)
      .mockResolvedValueOnce(retriedJob);
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    const result = await service.reportFailure('job-1', {
      worker_id: 'worker-1',
      error_json: { code: 'PARSE_ERROR', message: 'boom' },
      retryable: true,
    });

    expect(result.job).toMatchObject({
      job_id: 'job-1',
      status: JobStatus.PENDING,
    });
    expect(result.will_retry).toBe(true);
    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'job-1',
      JobStatus.RUNNING,
      JobStatus.FAILED,
      expect.objectContaining({
        attempt_count: 1,
        error_json: { code: 'PARSE_ERROR', message: 'boom' },
      }),
    );
    expect(transitionSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'job-1',
      JobStatus.FAILED,
      JobStatus.PENDING,
      expect.objectContaining({
        next_run_at: retriedJob.next_run_at,
      }),
    );
    expect(eventSpy).toHaveBeenCalledTimes(2);
  });

  it('returns cancel_requested jobs on heartbeat', async () => {
    const db = createDb([{ job_id: 'job-1' }, { job_id: 'job-2' }]);
    const redis = createRedisMock();
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never);
    const renewSpy = vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);

    const result = await service.recordHeartbeat({
      worker_id: 'worker-1',
      active_jobs: ['job-1', 'job-2'],
      system_info: { cpu_percent: 10 },
    });

    expect(result).toEqual({
      ack: true,
      cancel_requested: ['job-1', 'job-2'],
      lost_locks: [],
    });
    expect(redis.values.get('worker:heartbeat:worker-1')).toContain('"seen_at"');
    expect(renewSpy).toHaveBeenCalledTimes(2);
  });

  it('returns lost_locks when heartbeat renewals fail', async () => {
    const db = createDb([{ job_id: 'job-1' }, { job_id: 'job-2' }]);
    const service = new InternalJobsService(db.asDb() as never, createRedisMock().asClient() as never);
    const renewSpy = vi.spyOn(RedisJobLock, 'renew').mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await service.recordHeartbeat({
      worker_id: 'worker-1',
      active_jobs: ['job-1', 'job-2', 'job-2'],
    });

    expect(result).toEqual({
      ack: true,
      cancel_requested: ['job-1', 'job-2'],
      lost_locks: ['job-2'],
    });
    expect(renewSpy).toHaveBeenCalledTimes(2);
  });

  it('scanDeadWorkers finds stale workers and fails their jobs in a transaction', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const db = createDb([
      createJobRow({
        status: JobStatus.RUNNING,
        locked_by: 'worker-1',
        locked_at: new Date('2026-04-30T11:55:00.000Z'),
        started_at: new Date('2026-04-30T11:55:00.000Z'),
        max_attempts: 1,
      }),
    ]);
    const transactionSpy = vi.spyOn(db, 'transaction');
    const redis = createRedisMock();
    redis.values.set('worker:heartbeat:worker-1', JSON.stringify({ seen_at: '2026-04-30T11:58:00.000Z' }));
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never);
    const transitionSpy = vi
      .spyOn(JobStateMachine, 'transition')
      .mockResolvedValue(createJobRow({ status: JobStatus.FAILED, attempt_count: 1 }));
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    const releaseSpy = vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(service.scanDeadWorkers()).resolves.toBe(1);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(transitionSpy).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      JobStatus.RUNNING,
      JobStatus.FAILED,
      expect.objectContaining({
        attempt_count: 1,
        locked_by: null,
        locked_at: null,
      }),
    );
    expect(eventSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        job_id: 'job-1',
        event_type: 'timeout_detected',
        detail_json: {
          worker_id: 'worker-1',
          locked_at: '2026-04-30T11:55:00.000Z',
          last_heartbeat_at: '2026-04-30T11:58:00.000Z',
          reason: 'worker_missed_heartbeat',
        },
      }),
    );
    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1');
  });

  it('marks ingestion failed when a dead worker exhausts retries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const db = createDb([
      createJobRow({
        type: 'ingestion',
        status: JobStatus.RUNNING,
        locked_by: 'worker-1',
        locked_at: new Date('2026-04-30T11:55:00.000Z'),
        started_at: new Date('2026-04-30T11:55:00.000Z'),
        max_attempts: 1,
        payload_json: {
          source_document_id: 'source-1',
        },
      }),
    ]);
    const redis = createRedisMock();
    redis.values.set('worker:heartbeat:worker-1', JSON.stringify({ seen_at: '2026-04-30T11:58:00.000Z' }));
    const uploadsService = {
      markIngestionFailed: vi.fn(() => Promise.resolve()),
    };
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never, uploadsService as never);
    vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(createJobRow({ status: JobStatus.FAILED, attempt_count: 1 }));
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(service.scanDeadWorkers()).resolves.toBe(1);

    expect(uploadsService.markIngestionFailed).toHaveBeenCalledWith('source-1', { tenantId: 'tenant-1' });
  });

  it('scanDeadWorkers skips workers with recent heartbeats', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const db = createDb([
      createJobRow({
        status: JobStatus.RUNNING,
        locked_by: 'worker-1',
        locked_at: new Date('2026-04-30T11:50:00.000Z'),
        started_at: new Date('2026-04-30T11:50:00.000Z'),
      }),
    ]);
    const transactionSpy = vi.spyOn(db, 'transaction');
    const redis = createRedisMock();
    redis.values.set('worker:heartbeat:worker-1', JSON.stringify({ seen_at: '2026-04-30T11:59:30.000Z' }));
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never);
    const transitionSpy = vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(createJobRow());

    await expect(service.scanDeadWorkers()).resolves.toBe(0);

    expect(transactionSpy).not.toHaveBeenCalled();
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it('scanDeadWorkers retries eligible jobs for dead workers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const db = createDb([
      createJobRow({
        status: JobStatus.RUNNING,
        locked_by: 'worker-1',
        locked_at: new Date('2026-04-30T11:55:00.000Z'),
        started_at: new Date('2026-04-30T11:55:00.000Z'),
        attempt_count: 0,
        max_attempts: 3,
      }),
    ]);
    const transactionSpy = vi.spyOn(db, 'transaction');
    const redis = createRedisMock();
    redis.values.set('worker:heartbeat:worker-1', JSON.stringify({ seen_at: '2026-04-30T11:58:00.000Z' }));
    const service = new InternalJobsService(db.asDb() as never, redis.asClient() as never);
    const failedJob = createJobRow({
      status: JobStatus.FAILED,
      attempt_count: 1,
      locked_by: null,
      locked_at: null,
      error_json: { code: 'WORKER_TIMEOUT', message: 'Worker heartbeat timed out' },
      completed_at: new Date('2026-04-30T12:00:00.000Z'),
      started_at: new Date('2026-04-30T11:55:00.000Z'),
    });
    const retriedJob = createJobRow({
      status: JobStatus.PENDING,
      attempt_count: 1,
      locked_by: null,
      locked_at: null,
      next_run_at: new Date('2026-04-30T12:01:00.000Z'),
      error_json: { code: 'WORKER_TIMEOUT', message: 'Worker heartbeat timed out' },
      completed_at: null,
      started_at: null,
    });
    const transitionSpy = vi
      .spyOn(JobStateMachine, 'transition')
      .mockResolvedValueOnce(failedJob)
      .mockResolvedValueOnce(retriedJob);
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(service.scanDeadWorkers()).resolves.toBe(1);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'job-1',
      JobStatus.RUNNING,
      JobStatus.FAILED,
      expect.objectContaining({
        attempt_count: 1,
      }),
    );
    expect(transitionSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'job-1',
      JobStatus.FAILED,
      JobStatus.PENDING,
      expect.objectContaining({
        next_run_at: new Date('2026-04-30T12:01:00.000Z'),
      }),
    );
    expect(eventSpy).toHaveBeenCalledTimes(3);
    expect(eventSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        job_id: 'job-1',
        event_type: 'status_changed',
        detail_json: {
          from: JobStatus.FAILED,
          to: JobStatus.PENDING,
          worker_id: 'worker-1',
          reason: 'worker_timeout_retry',
          next_run_at: '2026-04-30T12:01:00.000Z',
        },
      }),
    );
  });
});

function createService(): InternalJobsService {
  return new InternalJobsService(createDb().asDb() as never, createRedisMock().asClient() as never);
}

function createDb<Row = unknown>(rows: Row[] = []): TestDb<Row> {
  return new TestDb(rows);
}

function createQueueMock(): {
  add: ReturnType<typeof vi.fn<(name: string, data: { jobId: string }) => Promise<void>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    add: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

class TestDb<Row = unknown> {
  constructor(private readonly rows: Row[]) {}

  async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    return callback(this);
  }

  select(): this {
    return this;
  }

  from(): this {
    return this;
  }

  where(): Promise<Row[]> {
    return Promise.resolve(this.rows);
  }

  asDb(): unknown {
    return this;
  }
}

class RedisMemoryStore {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  eval(): Promise<number> {
    return Promise.resolve(1);
  }

  asClient(): {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, ...args: Array<string | number>) => Promise<string | null>;
    eval: (script: string, numKeys: number, ...args: Array<string | number>) => Promise<number>;
  } {
    return {
      get: this.get.bind(this),
      set: async (key: string, value: string): Promise<string | null> => this.set(key, value),
      eval: this.eval.bind(this),
    };
  }
}

function createRedisMock(): RedisMemoryStore {
  return new RedisMemoryStore();
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    queue_name: 'graphify',
    type: 'graphify',
    priority: 100,
    status: JobStatus.PENDING,
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: 600,
    locked_by: null,
    locked_at: null,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: { source_id: 'source-1' },
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: 'user-1',
    created_at: new Date('2026-04-30T11:50:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}
