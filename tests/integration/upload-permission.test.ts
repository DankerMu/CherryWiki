import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import {
  UPLOAD_TEST_SPACE_ID,
  createAdminUploadContext,
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

  it('allows an editor to read an upload in their space', async () => {
    const context = createUploadIntegrationContext();
    const blob = context.fileBlobs.seed({ id: 'blob-editor-readable' });
    context.sourceDocuments.seed({ id: 'source-editor-readable', file_blob_id: blob.id, status: 'archived' });

    const detail = await context.service.getUpload(
      'source-editor-readable',
      createViewerUploadContext({ actorRole: 'editor', actorPermissions: ['upload:read'] }),
    );

    expect(detail).toMatchObject({
      id: 'source-editor-readable',
      status: 'archived',
      sha256: blob.sha256,
    });
  });

  it('allows an editor to check upload status in their space', async () => {
    const context = createUploadIntegrationContext();
    const blob = context.fileBlobs.seed({ id: 'blob-editor-status' });
    context.sourceDocuments.seed({ id: 'source-editor-status', file_blob_id: blob.id, status: 'uploaded' });
    context.db.queueSelect([]);

    const status = await context.service.getUploadStatus(
      'source-editor-status',
      createViewerUploadContext({ actorRole: 'editor', actorPermissions: ['upload:read'] }),
    );

    expect(status).toMatchObject({
      source_document_id: 'source-editor-status',
      status: 'uploaded',
      job_id: null,
      job_status: null,
    });
  });

  it('allows a space-admin to reprocess a parse_failed upload in their space', async () => {
    const context = createUploadIntegrationContext();
    const blob = context.fileBlobs.seed({ id: 'blob-reprocessable' });
    context.sourceDocuments.seed({
      id: 'source-reprocessable',
      file_blob_id: blob.id,
      status: 'parse_failed',
    });

    const result = await context.service.reprocess(
      'source-reprocessable',
      createAdminUploadContext({ actorRole: 'space_admin', actorPermissions: ['upload:create'] }),
    );

    expect(result).toMatchObject({
      source_document_id: 'source-reprocessable',
      file_blob_id: blob.id,
      job_id: 'job-1',
      status: 'uploaded',
    });
    expect(context.jobs.created[0]).toMatchObject({
      space_id: UPLOAD_TEST_SPACE_ID,
      queue_name: 'ingestion',
      type: 'ingestion',
    });
  });

  it('returns 404 when a user lacks upload read permission for getUpload', async () => {
    const context = createUploadIntegrationContext();
    const blob = context.fileBlobs.seed({ id: 'blob-denied' });
    context.sourceDocuments.seed({ id: 'source-denied', file_blob_id: blob.id, status: 'archived' });
    context.db.queueSelect([]);

    const denied = await getRejectedHttpException(
      context.service.getUpload('source-denied', createViewerUploadContext({ actorPermissions: [] })),
    );

    expect(denied.getStatus()).toBe(404);
    expect(getHttpExceptionCode(denied)).toBe(ErrorCode.UPLOAD_NOT_FOUND);
  });

  it('returns 404 for a non-existent upload before permission disclosure', async () => {
    const context = createUploadIntegrationContext();

    const missing = await getRejectedHttpException(
      context.service.getUpload('source-missing', createViewerUploadContext({ actorPermissions: [] })),
    );

    expect(missing.getStatus()).toBe(404);
    expect(getHttpExceptionCode(missing)).toBe(ErrorCode.UPLOAD_NOT_FOUND);
  });

  it('returns the same status for inaccessible and missing uploads', async () => {
    const inaccessibleContext = createUploadIntegrationContext();
    const blob = inaccessibleContext.fileBlobs.seed({ id: 'blob-inaccessible' });
    inaccessibleContext.sourceDocuments.seed({ id: 'source-inaccessible', file_blob_id: blob.id, status: 'archived' });
    inaccessibleContext.db.queueSelect([]);

    const inaccessible = await getRejectedHttpException(
      inaccessibleContext.service.getUpload('source-inaccessible', createViewerUploadContext({ actorPermissions: [] })),
    );

    const missingContext = createUploadIntegrationContext();
    const missing = await getRejectedHttpException(
      missingContext.service.getUpload('source-missing', createViewerUploadContext({ actorPermissions: [] })),
    );

    expect(inaccessible.getStatus()).toBe(404);
    expect(missing.getStatus()).toBe(404);
  });
});
