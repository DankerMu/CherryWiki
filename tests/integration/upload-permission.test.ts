import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import {
  UPLOAD_TEST_SPACE_ID,
  createUploadedFile,
  createUploadIntegrationContext,
  createViewerUploadContext,
} from './upload-integration-test-utils.js';

describe('upload permission integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 403 without upload:create permission and allows viewer upload:read', async () => {
    const context = createUploadIntegrationContext();
    context.queueSpaceExists();
    context.db.queueSelect([]);

    const denied = await getRejectedHttpException(
      context.service.uploadFile(
        {
          spaceId: UPLOAD_TEST_SPACE_ID,
          file: createUploadedFile(Buffer.from('hello')),
        },
        createViewerUploadContext({ actorPermissions: [] }),
      ),
    );

    expect(denied.getStatus()).toBe(403);
    expect(getHttpExceptionCode(denied)).toBe(ErrorCode.PERMISSION_DENIED);

    const blob = context.fileBlobs.seed({ id: 'blob-readable' });
    context.sourceDocuments.seed({ id: 'source-readable', file_blob_id: blob.id, status: 'archived' });
    const detail = await context.service.getUpload(
      'source-readable',
      createViewerUploadContext({ actorPermissions: ['upload:read'] }),
    );

    expect(detail).toMatchObject({
      id: 'source-readable',
      status: 'archived',
      sha256: blob.sha256,
    });
  });
});
