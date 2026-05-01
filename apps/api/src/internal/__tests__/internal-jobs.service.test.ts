import {
  JobEventRepository,
  JobRepository,
  JobStateMachine,
  JobStatus,
  RedisJobLock,
  type JobRow,
} from '@cherrygraph/job-core';
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
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(false);

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

  it('completes upload validation when a validation job succeeds', async () => {
    const db = createDb();
    const redis = createRedisMock();
    const uploadsService = {
      completeValidation: vi.fn(async () => ({
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
