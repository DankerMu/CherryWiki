import 'reflect-metadata';

import { HttpException } from '@nestjs/common';
import { PERMISSIONS_METADATA_KEY } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

import { TEST_SPACE_ID, TEST_TENANT_ID, TEST_USER_ID, getHttpExceptionCode } from '../../users/__tests__/user-group-service-test-utils.js';
import { UploadsController } from '../uploads.controller.js';
import type { UploadsService } from '../uploads.service.js';

describe('UploadsController', () => {
  it('applies upload permissions on upload routes', () => {
    expect(getMetadata('createUpload')).toEqual(['upload:create']);
    expect(getMetadata('getUpload')).toEqual(['upload:read']);
    expect(getMetadata('getUploadStatus')).toEqual(['upload:read']);
    expect(getMetadata('reprocess')).toEqual(['upload:create']);
    expect(getMetadata('listUploads')).toEqual(['upload:read']);
  });

  it('dispatches multipart file uploads to the service', async () => {
    const { controller, service } = createControllerContext();
    service.uploadFile.mockResolvedValue({
      source_document_id: 'source-1',
      file_blob_id: 'blob-1',
      job_id: 'job-1',
      status: 'archived',
      created: true,
    });
    const response = createResponse();

    const result = await controller.createUpload(
      TEST_SPACE_ID,
      { processing_strategy: 'immediate' },
      createMultipartRequest(Buffer.from('hello'), {
        filename: 'report.pdf',
        mimetype: 'application/pdf',
        fields: { processing_strategy: 'immediate' },
      }),
      response,
    );

    expect(result.job_id).toBe('job-1');
    expect(response.status).toHaveBeenCalledWith(201);
    expect(service.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: TEST_SPACE_ID,
        file: expect.objectContaining({ originalname: 'report.pdf' }) as Record<string, unknown>,
      }),
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      }),
    );
  });

  it('dispatches URL uploads to the service', async () => {
    const { controller, service } = createControllerContext();
    service.uploadUrl.mockResolvedValue({
      source_document_id: 'source-url',
      file_blob_id: null,
      job_id: 'job-url',
      status: 'uploaded',
      created: true,
    });
    const response = createResponse();

    const result = await controller.createUpload(
      TEST_SPACE_ID,
      { source_type: 'url', url: 'https://example.com/doc' },
      createRequest(),
      response,
    );

    expect(result.source_document_id).toBe('source-url');
    expect(service.uploadUrl).toHaveBeenCalledWith(
      {
        spaceId: TEST_SPACE_ID,
        url: 'https://example.com/doc',
        metadata: { source_type: 'url', url: 'https://example.com/doc' },
      },
      expect.any(Object),
    );
  });

  it('sets 200 for same-space duplicate upload responses', async () => {
    const { controller, service } = createControllerContext();
    service.uploadFile.mockResolvedValue({
      source_document_id: 'source-existing',
      file_blob_id: 'blob-1',
      job_id: null,
      status: 'archived',
      created: false,
    });
    const response = createResponse();

    await controller.createUpload(
      TEST_SPACE_ID,
      {},
      createMultipartRequest(Buffer.from('hello'), {
        filename: 'report.pdf',
        mimetype: 'application/pdf',
      }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when neither file nor URL is provided', async () => {
    const { controller } = createControllerContext();

    try {
      await controller.createUpload(TEST_SPACE_ID, {}, createRequest(), createResponse());
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(400);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.VALIDATION_ERROR);
      return;
    }

    throw new Error('Expected controller to reject invalid upload request');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const { controller } = createControllerContext();

    try {
      await controller.getUpload('source-1', {});
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(401);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.UNAUTHENTICATED);
      return;
    }

    throw new Error('Expected controller to reject unauthenticated request');
  });
});

function createControllerContext(): {
  controller: UploadsController;
  service: {
    uploadFile: ReturnType<typeof vi.fn<UploadsService['uploadFile']>>;
    uploadUrl: ReturnType<typeof vi.fn<UploadsService['uploadUrl']>>;
    getUpload: ReturnType<typeof vi.fn<UploadsService['getUpload']>>;
    getUploadStatus: ReturnType<typeof vi.fn<UploadsService['getUploadStatus']>>;
    reprocess: ReturnType<typeof vi.fn<UploadsService['reprocess']>>;
    listUploads: ReturnType<typeof vi.fn<UploadsService['listUploads']>>;
  };
} {
  const service = {
    uploadFile: vi.fn<UploadsService['uploadFile']>(),
    uploadUrl: vi.fn<UploadsService['uploadUrl']>(),
    getUpload: vi.fn<UploadsService['getUpload']>(),
    getUploadStatus: vi.fn<UploadsService['getUploadStatus']>(),
    reprocess: vi.fn<UploadsService['reprocess']>(),
    listUploads: vi.fn<UploadsService['listUploads']>(),
  };

  return {
    controller: new UploadsController(service as unknown as UploadsService),
    service,
  };
}

function createRequest(): {
  user: {
    sub: string;
    tenant_id: string;
    email: string;
    role: string;
    group_ids: string[];
    token_use: 'access';
  };
} {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: 'user@example.com',
      role: 'editor',
      group_ids: ['group-1'],
      token_use: 'access',
    },
  };
}

function createMultipartRequest(
  buffer: Buffer,
  options: {
    filename: string;
    mimetype: string;
    fields?: Record<string, string>;
  },
): ReturnType<typeof createRequest> & {
  isMultipart: () => boolean;
  file: (requestOptions?: {
    throwFileSizeLimit?: boolean;
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
      parts?: number;
    };
  }) => Promise<{
    type: 'file';
    fieldname: string;
    filename: string;
    mimetype: string;
    file: AsyncIterable<Buffer>;
    fields: Record<string, { type: 'field'; value: string }>;
  }>;
} {
  const fields: Record<string, { type: 'field'; value: string }> = {};
  for (const [key, value] of Object.entries(options.fields ?? {})) {
    fields[key] = { type: 'field', value };
  }

  return {
    ...createRequest(),
    isMultipart: vi.fn(() => true),
    file: vi.fn(() => Promise.resolve({
      type: 'file' as const,
      fieldname: 'file',
      filename: options.filename,
      mimetype: options.mimetype,
      file: toAsyncChunks(buffer),
      fields,
    })),
  };
}

async function* toAsyncChunks(buffer: Buffer): AsyncGenerator<Buffer> {
  yield await Promise.resolve(buffer);
}

function createResponse(): {
  status: ReturnType<typeof vi.fn<(code: number) => void>>;
} {
  return {
    status: vi.fn<(code: number) => void>(),
  };
}

function getMetadata(methodName: keyof UploadsController): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(UploadsController.prototype, methodName);
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, descriptor?.value as object);
}
