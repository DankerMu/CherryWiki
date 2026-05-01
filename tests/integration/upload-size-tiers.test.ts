import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UPLOAD_TEST_SPACE_ID,
  createAdminUploadContext,
  createUploadIntegrationContext,
  createUploadedFile,
} from './upload-integration-test-utils.js';

describe('upload size tier integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queues >50MB files as low-priority validation jobs', async () => {
    const context = createUploadIntegrationContext();
    context.queueSpaceExists();

    const result = await context.service.uploadFile(
      {
        spaceId: UPLOAD_TEST_SPACE_ID,
        file: createUploadedFile(Buffer.from('large file fixture'), {
          originalname: 'large.pdf',
          size: 75 * 1024 * 1024,
        }),
      },
      createAdminUploadContext(),
    );

    expect(result.status).toBe('validating');
    expect(context.sourceDocuments.rows[0]?.status).toBe('validating');
    expect(context.jobs.created[0]).toMatchObject({
      queue_name: 'validation',
      type: 'validation',
      priority: 200,
    });
  });
});
