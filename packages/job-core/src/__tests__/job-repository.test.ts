import { describe, expect, it } from 'vitest';

import { JobRepository } from '../repository.js';
import { JobStatus } from '../status.js';
import { createJobRow, renderSqlFragment, ScriptedDb } from './test-utils.js';

describe('JobRepository', () => {
  it('creates a job record', async () => {
    const db = new ScriptedDb();
    const created = createJobRow({ id: 'job-created', type: 'ingestion' });
    db.queueInsert([created]);

    await expect(
      JobRepository.create(db.asDb(), {
        tenant_id: 'tenant-1',
        type: 'ingestion',
        payload_json: { source: 'upload' },
      }),
    ).resolves.toEqual(created);

    expect(db.insertOperations).toHaveLength(1);
    expect(db.insertOperations[0]?.value).toMatchObject({
      tenant_id: 'tenant-1',
      type: 'ingestion',
      payload_json: { source: 'upload' },
    });
  });

  it('returns the existing job when idempotency_key conflicts', async () => {
    const db = new ScriptedDb();
    const existing = createJobRow({ id: 'job-existing', idempotency_key: 'idem-1' });
    db.queueInsert([]);
    db.queueSelect([existing]);

    await expect(
      JobRepository.create(db.asDb(), {
        tenant_id: 'tenant-1',
        type: 'graphify',
        idempotency_key: 'idem-1',
      }),
    ).resolves.toEqual(existing);

    expect(db.insertOperations[0]?.conflictTarget).toEqual(expect.any(Array));
    expect(db.selectOperations).toHaveLength(1);
  });

  it('returns filtered, paginated results', async () => {
    const db = new ScriptedDb();
    const items = [
      createJobRow({ id: 'job-1', status: JobStatus.PENDING }),
      createJobRow({ id: 'job-2', status: JobStatus.PENDING }),
    ];

    db.queueSelect(items);
    db.queueSelect([{ total: 5 }]);

    const result = await JobRepository.findByFilter(db.asDb(), {
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      type: 'graphify',
      status: JobStatus.PENDING,
      page: 2,
      perPage: 2,
      sort: {
        field: 'created_at',
        direction: 'desc',
      },
    });

    expect(result).toEqual({
      items,
      total: 5,
      page: 2,
      perPage: 2,
    });
    expect(db.selectOperations[0]?.offset).toBe(2);
    expect(db.selectOperations[0]?.limit).toBe(2);
    expect(db.selectOperations[0]?.where).toHaveLength(1);
    expect(db.selectOperations[0]?.orderBy).toHaveLength(2);
  });

  it('clamps perPage to max 100', async () => {
    const db = new ScriptedDb();
    const items = [createJobRow({ id: 'job-1' })];

    db.queueSelect(items);
    db.queueSelect([{ total: 1 }]);

    const result = await JobRepository.findByFilter(db.asDb(), {
      page: 1,
      perPage: 999,
    });

    expect(result.perPage).toBe(100);
    expect(db.selectOperations[0]?.limit).toBe(100);
  });

  it('queries pending jobs by type in priority and creation order', async () => {
    const db = new ScriptedDb();
    const orderedJobs = [
      createJobRow({ id: 'job-high', priority: 10, created_at: new Date('2026-04-01T00:00:00.000Z') }),
      createJobRow({ id: 'job-low', priority: 20, created_at: new Date('2026-04-01T01:00:00.000Z') }),
    ];

    db.queueSelect(orderedJobs);

    const result = await JobRepository.findPendingByType(db.asDb(), 'tenant-1', 'graphify', 5);

    expect(result).toEqual(orderedJobs);
    expect(db.selectOperations[0]?.limit).toBe(5);
    expect(db.selectOperations[0]?.orderBy).toHaveLength(2);
    expect(db.selectOperations[0]?.where).toHaveLength(1);
  });

  it('excludes pending jobs with future next_run_at', async () => {
    const db = new ScriptedDb();
    const readyJob = createJobRow({
      id: 'job-ready',
      next_run_at: new Date('2026-04-01T00:00:00.000Z'),
    });
    const futureJob = createJobRow({
      id: 'job-future',
      next_run_at: new Date('2026-05-01T00:00:00.000Z'),
    });

    db.queueSelect([readyJob]);

    const result = await JobRepository.findPendingByType(db.asDb(), 'tenant-1', 'graphify', 5);
    const whereSql = renderSqlFragment(db.selectOperations[0]?.where?.[0]).toLowerCase();

    expect(result).toEqual([readyJob]);
    expect(result).not.toContainEqual(futureJob);
    expect(whereSql).toContain('next_run_at');
    expect(whereSql).toContain('is null');
    expect(whereSql).toContain('<= now()');
  });

  it('clamps pending poll limit to max 10', async () => {
    const db = new ScriptedDb();
    db.queueSelect([]);

    await JobRepository.findPendingByType(db.asDb(), 'tenant-1', 'graphify', 99);

    expect(db.selectOperations[0]?.limit).toBe(10);
  });
});
