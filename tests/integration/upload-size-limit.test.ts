import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import { UPLOAD_MAX_BYTES } from '../../apps/api/src/uploads/uploads.constants.js';
import {
  UPLOAD_TEST_SPACE_ID,
  createAdminUploadContext,
  createUploadIntegrationContext,
  createUploadedFile,
} from './upload-integration-test-utils.js';

describe('upload size limit integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects files larger than 200MB with 413 before storage writes', async () => {
    const context = createUploadIntegrationContext();
    context.queueSpaceExists();

    const error = await getRejectedHttpException(
      context.service.uploadFile(
        {
          spaceId: UPLOAD_TEST_SPACE_ID,
          file: createUploadedFile(Buffer.from('oversized fixture'), { size: UPLOAD_MAX_BYTES + 1 }),
        },
        createAdminUploadContext(),
      ),
    );

    expect(error.getStatus()).toBe(413);
    expect(getHttpExceptionCode(error)).toBe(ErrorCode.FILE_TOO_LARGE);
    expect(context.storage.quarantineUploads).toHaveLength(0);
    expect(context.sourceDocuments.rows).toHaveLength(0);
    expect(context.jobs.created).toHaveLength(0);
  });
});
