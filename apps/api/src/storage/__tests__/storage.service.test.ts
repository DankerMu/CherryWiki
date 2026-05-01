import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock, getSignedUrlMock, clientConfigs } = vi.hoisted(() => ({
  sendMock: vi.fn<(command: { input: unknown }, options?: unknown) => Promise<unknown>>(),
  getSignedUrlMock: vi.fn<
    (client: unknown, command: { input: unknown }, options: { expiresIn: number }) => Promise<string>
  >(),
  clientConfigs: [] as unknown[],
}));

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    readonly config: unknown;

    constructor(config: unknown) {
      this.config = config;
      clientConfigs.push(config);
    }

    send = sendMock;
  }

  class PutObjectCommand {
    constructor(readonly input: unknown) {}
  }

  class CopyObjectCommand {
    constructor(readonly input: unknown) {}
  }

  class GetObjectCommand {
    constructor(readonly input: unknown) {}
  }

  class DeleteObjectCommand {
    constructor(readonly input: unknown) {}
  }

  class HeadBucketCommand {
    constructor(readonly input: unknown) {}
  }

  class CreateBucketCommand {
    constructor(readonly input: unknown) {}
  }

  return {
    CopyObjectCommand,
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client: MockS3Client,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

import {
  CopyObjectCommand as AwsCopyObjectCommand,
  CreateBucketCommand as AwsCreateBucketCommand,
  DeleteObjectCommand as AwsDeleteObjectCommand,
  GetObjectCommand as AwsGetObjectCommand,
  HeadBucketCommand as AwsHeadBucketCommand,
  PutObjectCommand as AwsPutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  PRIMARY_STORAGE_BUCKET,
  REQUIRED_STORAGE_BUCKETS,
  STORAGE_BUCKET_NAMES,
  getBucketName,
} from '../storage.constants.js';
import { ArchivePathHelper, StorageService, createStorageClient } from '../storage.service.js';

const originalStorageEnv = {
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
  S3_REGION: process.env.S3_REGION,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  STORAGE_BUCKET_PREFIX: process.env.STORAGE_BUCKET_PREFIX,
  NODE_ENV: process.env.NODE_ENV,
};

describe('StorageService', () => {
  beforeEach(() => {
    clientConfigs.length = 0;
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    restoreStorageEnv();
  });

  it('uploads objects with the expected S3 params', async () => {
    const { service } = createConfiguredService();
    const bucket = getPrimaryBucketName();
    const body = Buffer.from('hello world');
    sendMock.mockResolvedValue({});

    await service.upload(bucket, 'docs/file.txt', body, 'text/plain');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [command] = sendMock.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(AwsPutObjectCommand);
    expect(command?.input).toEqual({
      Bucket: bucket,
      Key: 'docs/file.txt',
      Body: body,
      ContentType: 'text/plain',
    });
  });

  it('uploads files to the quarantine path in the uploads bucket', async () => {
    const { service } = createConfiguredService();
    sendMock.mockResolvedValue({});

    const result = await service.uploadToQuarantine({
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      uploadId: 'upload-1',
      filename: 'report.pdf',
      body: Buffer.from('pdf'),
      contentType: 'application/pdf',
    });

    expect(result).toEqual({
      bucket: getBucketName(STORAGE_BUCKET_NAMES.UPLOADS),
      key: 'quarantine/tenant-1/space-1/upload-1_report.pdf',
      uri: `s3://${getBucketName(STORAGE_BUCKET_NAMES.UPLOADS)}/quarantine/tenant-1/space-1/upload-1_report.pdf`,
    });
    const [command] = sendMock.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(AwsPutObjectCommand);
    expect(command?.input).toEqual({
      Bucket: getBucketName(STORAGE_BUCKET_NAMES.UPLOADS),
      Key: 'quarantine/tenant-1/space-1/upload-1_report.pdf',
      Body: Buffer.from('pdf'),
      ContentType: 'application/pdf',
    });
  });

  it('builds canonical archive paths with date partitions and sha prefix', () => {
    expect(
      ArchivePathHelper.originalFilePath({
        tenantId: 't1',
        spaceId: 'sp1',
        sha256: 'abc12345ffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        filename: 'report.pdf',
        archivedAt: new Date('2026-04-30T13:15:00.000Z'),
      }),
    ).toBe('archive/t1/sp1/2026/04/30/abc12345_report.pdf');
  });

  it('promotes quarantine files by copying to archives and deleting quarantine', async () => {
    const { service } = createConfiguredService();
    sendMock.mockResolvedValue({});

    const result = await service.promoteToArchive({
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      quarantineKey: 'quarantine/tenant-1/space-1/upload-1_report.pdf',
      sha256: 'abc12345ffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      filename: 'report.pdf',
      archivedAt: new Date('2026-04-30T13:15:00.000Z'),
    });

    expect(result).toEqual({
      bucket: getBucketName(STORAGE_BUCKET_NAMES.ARCHIVES),
      key: 'archive/tenant-1/space-1/2026/04/30/abc12345_report.pdf',
      uri: `s3://${getBucketName(STORAGE_BUCKET_NAMES.ARCHIVES)}/archive/tenant-1/space-1/2026/04/30/abc12345_report.pdf`,
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[0]).toBeInstanceOf(AwsCopyObjectCommand);
    expect(sendMock.mock.calls[0]?.[0].input).toEqual({
      Bucket: getBucketName(STORAGE_BUCKET_NAMES.ARCHIVES),
      Key: 'archive/tenant-1/space-1/2026/04/30/abc12345_report.pdf',
      CopySource: `${getBucketName(STORAGE_BUCKET_NAMES.UPLOADS)}/quarantine/tenant-1/space-1/upload-1_report.pdf`,
    });
    expect(sendMock.mock.calls[1]?.[0]).toBeInstanceOf(AwsDeleteObjectCommand);
    expect(sendMock.mock.calls[1]?.[0].input).toEqual({
      Bucket: getBucketName(STORAGE_BUCKET_NAMES.UPLOADS),
      Key: 'quarantine/tenant-1/space-1/upload-1_report.pdf',
    });
  });

  it('downloads objects as readable streams', async () => {
    const { service } = createConfiguredService();
    const bucket = getPrimaryBucketName();
    const stream = Readable.from(['payload']);
    sendMock.mockResolvedValue({ Body: stream });

    const result = await service.download(bucket, 'docs/file.txt');

    expect(result).toBe(stream);
    const [command] = sendMock.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(AwsGetObjectCommand);
    expect(command?.input).toEqual({
      Bucket: bucket,
      Key: 'docs/file.txt',
    });
  });

  it('throws STORAGE_NOT_FOUND when downloading a missing object', async () => {
    const { service } = createConfiguredService();
    const bucket = getPrimaryBucketName();
    sendMock.mockRejectedValue(Object.assign(new Error('missing object'), { name: 'NoSuchKey' }));

    await expect(service.download(bucket, 'docs/missing.txt')).rejects.toMatchObject({
      code: 'STORAGE_NOT_FOUND',
    });
  });

  it('deletes objects with the expected S3 params', async () => {
    const { service } = createConfiguredService();
    const bucket = getPrimaryBucketName();
    sendMock.mockResolvedValue({});

    await service.delete(bucket, 'docs/file.txt');

    const [command] = sendMock.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(AwsDeleteObjectCommand);
    expect(command?.input).toEqual({
      Bucket: bucket,
      Key: 'docs/file.txt',
    });
  });

  it('generates presigned upload and download URLs', async () => {
    const { service, client } = createConfiguredService();
    const bucket = getPrimaryBucketName();
    getSignedUrlMock.mockResolvedValueOnce('https://example.test/download');
    getSignedUrlMock.mockResolvedValueOnce('https://example.test/upload');

    const downloadUrl = await service.getPresignedDownloadUrl(bucket, 'docs/file.txt', 120);
    const uploadUrl = await service.getPresignedUploadUrl(bucket, 'docs/file.txt', 'text/plain', 240);

    expect(downloadUrl).toBe('https://example.test/download');
    expect(uploadUrl).toBe('https://example.test/upload');
    expect(getSignedUrl).toHaveBeenNthCalledWith(
      1,
      client,
      expect.any(AwsGetObjectCommand),
      { expiresIn: 120 },
    );
    expect(getSignedUrl).toHaveBeenNthCalledWith(
      2,
      client,
      expect.any(AwsPutObjectCommand),
      { expiresIn: 240 },
    );
  });

  it('returns prefixed bucket names from STORAGE_BUCKET_PREFIX', () => {
    process.env.STORAGE_BUCKET_PREFIX = 'tenant-a';

    expect(getBucketName(PRIMARY_STORAGE_BUCKET)).toBe('tenant-a-uploads');
  });

  it('creates missing buckets during ensureBuckets()', async () => {
    const { service } = createConfiguredService();
    const primaryBucket = getPrimaryBucketName();
    sendMock.mockImplementation((command) => {
      if (command instanceof AwsHeadBucketCommand && isBucketInput(command.input, primaryBucket)) {
        return Promise.reject(Object.assign(new Error('missing bucket'), { name: 'NotFound' }));
      }

      return Promise.resolve({});
    });

    await service.ensureBuckets();

    const createCalls = sendMock.mock.calls.filter(([command]) => command instanceof AwsCreateBucketCommand);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.[0].input).toEqual({ Bucket: primaryBucket });
  });

  it('skips bucket creation when buckets already exist', async () => {
    const { service } = createConfiguredService();
    sendMock.mockResolvedValue({});

    await service.ensureBuckets();

    expect(sendMock).toHaveBeenCalledTimes(REQUIRED_STORAGE_BUCKETS.length);
    const createCalls = sendMock.mock.calls.filter(([command]) => command instanceof AwsCreateBucketCommand);
    expect(createCalls).toHaveLength(0);
  });

  it.each(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'])(
    'treats %s bucket creation races as success',
    async (errorName) => {
      const { service } = createConfiguredService();
      const primaryBucket = getPrimaryBucketName();
      sendMock.mockImplementation((command) => {
        if (command instanceof AwsHeadBucketCommand && isBucketInput(command.input, primaryBucket)) {
          return Promise.reject(Object.assign(new Error('missing bucket'), { name: 'NotFound' }));
        }

        if (command instanceof AwsCreateBucketCommand && isBucketInput(command.input, primaryBucket)) {
          return Promise.reject(Object.assign(new Error('created elsewhere'), { name: errorName }));
        }

        return Promise.resolve({});
      });

      await expect(service.ensureBuckets()).resolves.toBeUndefined();
    },
  );

  it('returns healthy storage health with latency', async () => {
    const { service } = createConfiguredService();
    sendMock.mockResolvedValue({});

    const result = await service.healthCheck();

    expect(result.status).toBe('healthy');
    expect(result.latency_ms).toBeGreaterThanOrEqual(1);
    const [command, options] = sendMock.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(AwsHeadBucketCommand);
    expect(command?.input).toEqual({ Bucket: getPrimaryBucketName() });
    expect(hasAbortSignal(options)).toBe(true);
  });

  it.each([
    {
      description: 'timeouts',
      error: Object.assign(new Error('timed out'), { name: 'AbortError' }),
      expected: 'timeout',
    },
    {
      description: 'network failures',
      error: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9000'), { code: 'ECONNREFUSED' }),
      expected: 'unreachable',
    },
    {
      description: 'credential failures',
      error: Object.assign(new Error('invalid access key'), { name: 'InvalidAccessKeyId' }),
      expected: 'auth_failed',
    },
    {
      description: 'unexpected failures',
      error: new Error('mystery'),
      expected: 'unknown',
    },
  ])('sanitizes storage health errors for $description', async ({ error, expected }) => {
    const { service } = createConfiguredService();
    sendMock.mockRejectedValue(error);

    const result = await service.healthCheck();

    expect(result).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: expected,
      }),
    );
    expect(result.latency_ms).toBeGreaterThanOrEqual(1);
  });

  it('rejects uploads larger than maxBytes', async () => {
    const { service } = createConfiguredService();

    await expect(
      service.upload(getPrimaryBucketName(), 'docs/file.txt', Buffer.alloc(6), 'application/octet-stream', 5),
    ).rejects.toThrow('Storage upload exceeds the maximum allowed size');

    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each(['', '/docs/file.txt', '../docs/file.txt', 'docs/../file.txt'])(
    'rejects invalid upload keys: %j',
    async (key) => {
      const { service } = createConfiguredService();

      await expect(service.upload(getPrimaryBucketName(), key, Buffer.from('hello'), 'text/plain')).rejects.toThrow(
        'Invalid storage key',
      );

      expect(sendMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      description: 'download',
      run: (service: StorageService) => service.download(getPrimaryBucketName(), '../docs/file.txt'),
    },
    {
      description: 'delete',
      run: (service: StorageService) => service.delete(getPrimaryBucketName(), '../docs/file.txt'),
    },
    {
      description: 'presigned download',
      run: (service: StorageService) => service.getPresignedDownloadUrl(getPrimaryBucketName(), '../docs/file.txt'),
    },
    {
      description: 'presigned upload',
      run: (service: StorageService) =>
        service.getPresignedUploadUrl(getPrimaryBucketName(), '../docs/file.txt', 'text/plain'),
    },
  ])('rejects invalid keys for $description', async ({ run }) => {
    const { service } = createConfiguredService();

    await expect(run(service)).rejects.toThrow('Invalid storage key');

    expect(sendMock).not.toHaveBeenCalled();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('throws STORAGE_NOT_CONFIGURED when storage env vars are absent', async () => {
    clearStorageEnv();
    const service = new StorageService();

    await expect(
      service.upload(getPrimaryBucketName(), 'docs/file.txt', Buffer.from('hello'), 'text/plain'),
    ).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    await expect(service.download(getPrimaryBucketName(), 'docs/file.txt')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    await expect(service.delete(getPrimaryBucketName(), 'docs/file.txt')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    await expect(service.getPresignedDownloadUrl(getPrimaryBucketName(), 'docs/file.txt')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    await expect(
      service.getPresignedUploadUrl(getPrimaryBucketName(), 'docs/file.txt', 'text/plain'),
    ).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    await expect(service.ensureBuckets()).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    await expect(service.healthCheck()).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
  });

  it('creates a path-style S3 client for MinIO config', () => {
    configureMinioEnv();

    const client = createStorageClient();

    expect(client).toBeInstanceOf(S3Client);
    expect(clientConfigs).toEqual([
      {
        region: 'us-east-1',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        credentials: {
          accessKeyId: 'minio-access',
          secretAccessKey: 'minio-secret',
        },
      },
    ]);
  });
});

function createConfiguredService(): { service: StorageService; client: S3Client } {
  configureMinioEnv();
  const client = new S3Client({ region: 'us-east-1' });
  return {
    service: new StorageService(client),
    client,
  };
}

function configureMinioEnv(): void {
  process.env.MINIO_ENDPOINT = 'http://localhost:9000';
  process.env.MINIO_ACCESS_KEY = 'minio-access';
  process.env.MINIO_SECRET_KEY = 'minio-secret';
  delete process.env.S3_REGION;
  delete process.env.S3_ENDPOINT;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.STORAGE_BUCKET_PREFIX;
}

function clearStorageEnv(): void {
  delete process.env.MINIO_ENDPOINT;
  delete process.env.MINIO_ACCESS_KEY;
  delete process.env.MINIO_SECRET_KEY;
  delete process.env.S3_REGION;
  delete process.env.S3_ENDPOINT;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.STORAGE_BUCKET_PREFIX;
}

function restoreStorageEnv(): void {
  restoreEnvVar('MINIO_ENDPOINT', originalStorageEnv.MINIO_ENDPOINT);
  restoreEnvVar('MINIO_ACCESS_KEY', originalStorageEnv.MINIO_ACCESS_KEY);
  restoreEnvVar('MINIO_SECRET_KEY', originalStorageEnv.MINIO_SECRET_KEY);
  restoreEnvVar('S3_REGION', originalStorageEnv.S3_REGION);
  restoreEnvVar('S3_ENDPOINT', originalStorageEnv.S3_ENDPOINT);
  restoreEnvVar('AWS_ACCESS_KEY_ID', originalStorageEnv.AWS_ACCESS_KEY_ID);
  restoreEnvVar('AWS_SECRET_ACCESS_KEY', originalStorageEnv.AWS_SECRET_ACCESS_KEY);
  restoreEnvVar('STORAGE_BUCKET_PREFIX', originalStorageEnv.STORAGE_BUCKET_PREFIX);
  restoreEnvVar('NODE_ENV', originalStorageEnv.NODE_ENV);
}

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function isBucketInput(value: unknown, bucket: string): boolean {
  return typeof value === 'object' && value !== null && 'Bucket' in value && value.Bucket === bucket;
}

function hasAbortSignal(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'abortSignal' in value;
}

function getPrimaryBucketName(): string {
  return getBucketName(PRIMARY_STORAGE_BUCKET);
}
