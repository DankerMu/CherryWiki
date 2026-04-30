import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { WorkerHeartbeatDto } from '../internal.dto.js';

describe('WorkerHeartbeatDto', () => {
  it('accepts bounded active_jobs and system_info payloads', async () => {
    const dto = plainToInstance(WorkerHeartbeatDto, {
      worker_id: 'worker-1',
      active_jobs: Array.from({ length: 50 }, (_, index) => `job-${index + 1}`),
      system_info: {
        hostname: 'worker-host-1',
        stats: {
          cpu_percent: 12,
          memory_percent: 34,
        },
      },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects heartbeats with too many active jobs', async () => {
    const dto = plainToInstance(WorkerHeartbeatDto, {
      worker_id: 'worker-1',
      active_jobs: Array.from({ length: 51 }, (_, index) => `job-${index + 1}`),
    });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('rejects overly deep system_info payloads', async () => {
    const dto = plainToInstance(WorkerHeartbeatDto, {
      worker_id: 'worker-1',
      system_info: {
        level1: {
          level2: {
            level3: {
              level4: {
                cpu_percent: 10,
              },
            },
          },
        },
      },
    });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
