import { Queue } from '../../packages/job-core/node_modules/bullmq';
import { describe, expect, it } from 'vitest';

import { createBullMQConnection } from '@cherrygraph/job-core';

describe('Redis and BullMQ live-stack smoke', () => {
  it('pings Redis and persists a queued BullMQ job', async () => {
    const connection = createBullMQConnection(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const queueName = `cherrywiki-smoke-${process.pid}-${Date.now()}`;
    const queue = new Queue(queueName, { connection });

    try {
      await expect(connection.ping()).resolves.toBe('PONG');

      const job = await queue.add('connectivity', { source: 'live-stack-smoke' });
      const stored = await queue.getJob(job.id ?? '');

      expect(stored).not.toBeNull();
      expect(stored?.name).toBe('connectivity');
      expect(stored?.data).toEqual({ source: 'live-stack-smoke' });
    } finally {
      await queue.drain(true);
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    }
  });
});
