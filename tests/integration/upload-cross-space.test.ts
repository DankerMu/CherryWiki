import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UPLOAD_TEST_ALT_SPACE_ID,
  UPLOAD_TEST_SPACE_ID,
  createAdminUploadContext,
  createUploadIntegrationContext,
  createUploadedFile,
} from './upload-integration-test-utils.js';

describe('upload cross-space dedup integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares one file_blob across spaces while creating independent source_documents', async () => {
    const context = createUploadIntegrationContext();
    const file = createUploadedFile(Buffer.from('shared content'), { originalname: 'shared.pdf' });
    context.queueSpaceExists(UPLOAD_TEST_SPACE_ID);
    const first = await context.service.uploadFile({ spaceId: UPLOAD_TEST_SPACE_ID, file }, createAdminUploadContext());

    context.queueSpaceExists(UPLOAD_TEST_ALT_SPACE_ID);
    const second = await context.service.uploadFile(
      { spaceId: UPLOAD_TEST_ALT_SPACE_ID, file },
      createAdminUploadContext(),
    );

    expect(first.file_blob_id).toBe(second.file_blob_id);
    expect(first.source_document_id).not.toBe(second.source_document_id);
    expect(context.fileBlobs.rows).toHaveLength(1);
    expect(context.sourceDocuments.rows.map((row) => row.space_id).sort()).toEqual([
      UPLOAD_TEST_SPACE_ID,
      UPLOAD_TEST_ALT_SPACE_ID,
    ].sort());
    expect(context.jobs.created).toHaveLength(2);
  });
});
