import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAdminUploadContext,
  createUploadIntegrationContext,
} from './upload-integration-test-utils.js';

describe('upload reprocess integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets parse_failed uploads and creates a new ingestion job', async () => {
    const context = createUploadIntegrationContext();
    const blob = context.fileBlobs.seed();
    context.sourceDocuments.seed({ id: 'source-1', file_blob_id: blob.id, status: 'parse_failed' });

    const result = await context.service.reprocess('source-1', createAdminUploadContext());

    expect(result).toMatchObject({
      source_document_id: 'source-1',
      file_blob_id: blob.id,
      job_id: 'job-1',
      status: 'uploaded',
    });
    expect(context.sourceDocuments.rows[0]?.status).toBe('uploaded');
    expect(context.jobs.created[0]).toMatchObject({
      queue_name: 'ingestion',
      type: 'ingestion',
    });
  });
});
