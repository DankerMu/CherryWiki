import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UPLOAD_TEST_SPACE_ID,
  createAdminUploadContext,
  createUploadIntegrationContext,
} from './upload-integration-test-utils.js';

describe('URL upload integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a URL source_document without a file_blob and queues url_fetch', async () => {
    const context = createUploadIntegrationContext();
    context.queueSpaceExists();

    const result = await context.service.uploadUrl(
      {
        spaceId: UPLOAD_TEST_SPACE_ID,
        url: 'https://example.com/docs/report',
        metadata: { source_type: 'url', processing_strategy: 'stash' },
      },
      createAdminUploadContext(),
    );

    expect(result).toMatchObject({
      source_document_id: 'source-1',
      file_blob_id: null,
      job_id: 'job-1',
      status: 'uploaded',
    });
    expect(context.sourceDocuments.rows[0]).toMatchObject({
      source_type: 'url',
      file_blob_id: null,
      filename: 'report',
    });
    expect(context.jobs.created[0]).toMatchObject({
      queue_name: 'url-fetch',
      type: 'url_fetch',
    });
  });
});
