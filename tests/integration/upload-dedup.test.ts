import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UPLOAD_TEST_SPACE_ID,
  createAdminUploadContext,
  createUploadIntegrationContext,
  createUploadedFile,
} from './upload-integration-test-utils.js';

describe('upload dedup integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the existing source_document_id when the same file is uploaded twice to one space', async () => {
    const context = createUploadIntegrationContext();
    const file = createUploadedFile(Buffer.from('same bytes'), { originalname: 'same.pdf' });
    context.queueSpaceExists();
    const first = await context.service.uploadFile({ spaceId: UPLOAD_TEST_SPACE_ID, file }, createAdminUploadContext());

    context.queueSpaceExists();
    const second = await context.service.uploadFile({ spaceId: UPLOAD_TEST_SPACE_ID, file }, createAdminUploadContext());

    expect(second).toMatchObject({
      source_document_id: first.source_document_id,
      file_blob_id: first.file_blob_id,
      job_id: null,
      created: false,
    });
    expect(context.fileBlobs.rows).toHaveLength(1);
    expect(context.sourceDocuments.rows).toHaveLength(1);
    expect(context.storage.quarantineUploads).toHaveLength(1);
    expect(context.jobs.created).toHaveLength(1);
  });
});
