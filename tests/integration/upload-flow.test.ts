import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UPLOAD_TEST_SPACE_ID,
  createAdminUploadContext,
  createUploadIntegrationContext,
  createUploadedFile,
} from './upload-integration-test-utils.js';

describe('upload flow integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads a small file through quarantine, creates a source_document, promotes to archive, and queues ingestion', async () => {
    const context = createUploadIntegrationContext();
    context.queueSpaceExists();

    const result = await context.service.uploadFile(
      {
        spaceId: UPLOAD_TEST_SPACE_ID,
        file: createUploadedFile(Buffer.from('hello world'), {
          originalname: 'report.pdf',
          mimetype: 'application/pdf',
        }),
        metadata: { processing_strategy: 'immediate', tags: 'stage3' },
      },
      createAdminUploadContext(),
    );

    expect(result).toMatchObject({
      source_document_id: 'source-1',
      file_blob_id: 'blob-1',
      job_id: 'job-1',
      status: 'archived',
      created: true,
    });
    expect(context.storage.quarantineUploads[0]?.key).toMatch(
      /^quarantine\/tenant-1\/space-1\/.+_report\.pdf$/,
    );
    expect(context.storage.archivePromotions[0]?.key).toMatch(
      /^archive\/tenant-1\/space-1\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]{8}_report\.pdf$/,
    );
    expect(context.sourceDocuments.rows[0]).toMatchObject({
      id: 'source-1',
      status: 'archived',
      file_blob_id: 'blob-1',
    });
    expect(context.sourceDocuments.rows[0]?.metadata_json).toMatchObject({
      tags: ['stage3'],
      quarantine_key: expect.stringContaining('quarantine/'),
      archive_key: expect.stringContaining('archive/'),
    });
    expect(context.jobs.created[0]).toMatchObject({
      queue_name: 'ingestion',
      type: 'ingestion',
      priority: 50,
    });
  });
});
