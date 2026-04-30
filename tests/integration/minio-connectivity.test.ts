import { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '../../apps/api/node_modules/@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIMARY_STORAGE_BUCKET, REQUIRED_STORAGE_BUCKETS, getBucketName } from '../../apps/api/src/storage/storage.constants.js';

describe('Stage 2 MinIO connectivity integration', () => {
  const originalEnv = {
    MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
    MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
    S3_REGION: process.env.S3_REGION,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    STORAGE_BUCKET_PREFIX: process.env.STORAGE_BUCKET_PREFIX,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MINIO_ENDPOINT = 'http://localhost:9000';
    process.env.MINIO_ACCESS_KEY = 'minio-access';
    process.env.MINIO_SECRET_KEY = 'minio-secret';
    delete process.env.S3_REGION;
    delete process.env.S3_ENDPOINT;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.STORAGE_BUCKET_PREFIX;
  });

  afterEach(() => {
    restoreStorageEnv(originalEnv);
  });

  it('creates buckets, transfers objects, presigns URLs, and reports healthy storage', async () => {
    const { StorageService } = await import('../../apps/api/src/storage/storage.service.js');
    const client = new MemoryS3Client();
    const service = new StorageService(client.asClient());

    await service.ensureBuckets();

    expect([...client.bucketNames].sort()).toEqual(REQUIRED_STORAGE_BUCKETS.map((bucket) => getBucketName(bucket)).sort());

    const bucket = getBucketName(PRIMARY_STORAGE_BUCKET);
    await service.upload(bucket, 'docs/file.txt', Buffer.from('hello world'), 'text/plain');

    const downloaded = await service.download(bucket, 'docs/file.txt');
    expect(await readableToString(downloaded)).toBe('hello world');

    const downloadUrl = await service.getPresignedDownloadUrl(bucket, 'docs/file.txt', 120);
    const uploadUrl = await service.getPresignedUploadUrl(bucket, 'docs/file.txt', 'text/plain', 240);

    expect(downloadUrl).toContain(`/${bucket}/docs/file.txt`);
    expect(downloadUrl).toContain('X-Amz-Expires=120');
    expect(uploadUrl).toContain(`/${bucket}/docs/file.txt`);
    expect(uploadUrl).toContain('X-Amz-Expires=240');

    await expect(service.healthCheck()).resolves.toEqual(
      expect.objectContaining({
        status: 'healthy',
      }),
    );
  });
});

class MemoryS3Client {
  readonly bucketNames = new Set<string>();
  private readonly objects = new Map<string, { body: Buffer; contentType?: string }>();

  asClient(): S3Client {
    const client = new S3Client({
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'minio-access',
        secretAccessKey: 'minio-secret',
      },
    });
    client.send = this.send.bind(this) as typeof client.send;
    return client;
  }

  async send(command: object): Promise<unknown> {
    if (isCommand(command, HeadBucketCommand, 'HeadBucketCommand')) {
      const bucket = command.input.Bucket;
      if (bucket === undefined || !this.bucketNames.has(bucket)) {
        throw Object.assign(new Error('missing bucket'), { name: 'NotFound' });
      }

      return {};
    }

    if (isCommand(command, CreateBucketCommand, 'CreateBucketCommand')) {
      const bucket = command.input.Bucket;
      if (bucket === undefined) {
        throw new Error('Bucket is required');
      }

      this.bucketNames.add(bucket);
      return {};
    }

    if (isCommand(command, PutObjectCommand, 'PutObjectCommand')) {
      const bucket = command.input.Bucket;
      const key = command.input.Key;
      if (bucket === undefined || key === undefined || !this.bucketNames.has(bucket)) {
        throw new Error('Bucket must exist before upload');
      }

      this.objects.set(this.objectKey(bucket, key), {
        body: normalizeBody(command.input.Body),
        contentType: command.input.ContentType,
      });
      return {};
    }

    if (isCommand(command, GetObjectCommand, 'GetObjectCommand')) {
      const bucket = command.input.Bucket;
      const key = command.input.Key;
      if (bucket === undefined || key === undefined) {
        throw new Error('Bucket and key are required');
      }

      const object = this.objects.get(this.objectKey(bucket, key));
      if (object === undefined) {
        throw Object.assign(new Error('missing object'), { name: 'NoSuchKey' });
      }

      return {
        Body: Readable.from([object.body]),
      };
    }

    if (isCommand(command, DeleteObjectCommand, 'DeleteObjectCommand')) {
      const bucket = command.input.Bucket;
      const key = command.input.Key;
      if (bucket !== undefined && key !== undefined) {
        this.objects.delete(this.objectKey(bucket, key));
      }

      return {};
    }

    throw new Error('Unsupported S3 command in integration test');
  }

  private objectKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }
}

async function readableToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function normalizeBody(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === 'string') {
    return Buffer.from(body);
  }

  throw new Error('MemoryS3Client only supports Buffer or string bodies');
}

function isCommand<Input extends object>(
  value: object,
  commandClass: new (...args: any[]) => { input: Input },
  expectedName: string,
): value is { input: Input } {
  return value instanceof commandClass || value.constructor.name === expectedName;
}

function restoreStorageEnv(originalEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
