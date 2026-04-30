import { describe, expect, it } from 'vitest';

import { JobRepository } from '@cherrygraph/job-core';

import { InMemoryJobDb, TEST_TENANT_ID, TEST_USER_ID } from './stage2-integration-test-utils.js';

describe('Stage 2 job idempotency integration', () => {
  it('deduplicates by tenant and idempotency key while allowing the same key in another tenant', async () => {
    const db = new InMemoryJobDb();

    const first = await JobRepository.create(db.asDb(), {
      id: 'job-1',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      idempotency_key: 'idem-1',
      created_by: TEST_USER_ID,
      payload_json: { source_id: 'source-1' },
    });
    const duplicate = await JobRepository.create(db.asDb(), {
      id: 'job-2',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      idempotency_key: 'idem-1',
      created_by: TEST_USER_ID,
      payload_json: { source_id: 'source-2' },
    });
    const otherTenant = await JobRepository.create(db.asDb(), {
      id: 'job-3',
      tenant_id: 'tenant-2',
      type: 'graphify',
      idempotency_key: 'idem-1',
      created_by: TEST_USER_ID,
    });

    expect(duplicate).toEqual(first);
    expect(otherTenant.id).toBe('job-3');
    expect(db.getJobs().map((job) => ({ id: job.id, tenant_id: job.tenant_id }))).toEqual([
      { id: 'job-1', tenant_id: TEST_TENANT_ID },
      { id: 'job-3', tenant_id: 'tenant-2' },
    ]);
  });
});
