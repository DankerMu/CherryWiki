import { describe, expect, it } from 'vitest';

import {
  createBullMQConnection,
  JobStatus,
  QUEUE_GRAPHIFY_NOTIFY,
  QUEUE_INDEXING,
  QUEUE_INGESTION,
  QUEUE_URL_FETCH,
} from '@cherrygraph/job-core';

describe('@cherrygraph/job-core', () => {
  it('exports queue name constants', () => {
    expect(QUEUE_INGESTION).toBe('ingestion');
    expect(QUEUE_URL_FETCH).toBe('url-fetch');
    expect(QUEUE_INDEXING).toBe('indexer');
    expect(QUEUE_GRAPHIFY_NOTIFY).toBe('graphify-notify');
  });

  it('exports the canonical job statuses', () => {
    expect(Object.values(JobStatus)).toEqual(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
  });

  it('exports a BullMQ connection factory without creating a test connection', () => {
    expect(typeof createBullMQConnection).toBe('function');
  });
});
