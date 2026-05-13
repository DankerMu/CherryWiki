import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '../../apps/api/node_modules/@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

describe('MinIO live-stack smoke', () => {
  it('uploads, reads back, and cleans up an object', async () => {
    const bucket = `cherrywiki-smoke-${randomUUID()}`;
    const key = 'smoke.txt';
    const body = `live-stack-smoke-${Date.now()}`;
    const client = new S3Client({
      region: 'us-east-1',
      endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin_dev_secret',
      },
    });

    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'text/plain',
        }),
      );

      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

      await expect(readBody(response.Body)).resolves.toBe(body);
    } finally {
      await ignoreMissing(() => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })));
      await ignoreMissing(() => client.send(new DeleteBucketCommand({ Bucket: bucket })));
      client.destroy();
    }
  });
});

async function readBody(body: unknown): Promise<string> {
  if (body !== null && typeof body === 'object' && 'transformToString' in body) {
    const transformToString = body.transformToString;
    if (typeof transformToString === 'function') {
      return transformToString.call(body);
    }
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  throw new Error('Unsupported S3 response body');
}

async function ignoreMissing(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (!['NoSuchBucket', 'NoSuchKey', 'NotFound'].includes(name)) {
      throw error;
    }
  }
}
