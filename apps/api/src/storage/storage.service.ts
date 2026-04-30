import { Readable } from 'node:stream';
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type BucketLocationConstraint,
  type CreateBucketCommandInput,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getApiLogger } from '../common/logger/logger.module.js';
import {
  DEFAULT_PRESIGNED_URL_EXPIRES_IN_SECONDS,
  PRIMARY_STORAGE_BUCKET,
  REQUIRED_STORAGE_BUCKETS,
  STORAGE_CLIENT,
  STORAGE_HEALTH_TIMEOUT_MS,
} from './storage.constants.js';

type StorageProvider = 'minio' | 's3';
type StorageErrorCode = 'STORAGE_NOT_CONFIGURED' | 'STORAGE_NOT_FOUND';
type StorageHealthStatus = 'healthy' | 'unhealthy';
type StorageCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
};
type StorageResolvedConfig = {
  provider: StorageProvider;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  credentials: StorageCredentials;
};
type StorageHealthComponent = {
  status: StorageHealthStatus;
  latency_ms: number;
  error?: string;
};

const DEFAULT_MINIO_REGION = 'us-east-1';

export class StorageServiceError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StorageServiceError';
    this.code = code;
  }
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly config = resolveStorageConfig();

  constructor(@Optional() @Inject(STORAGE_CLIENT) private readonly client?: S3Client) {}

  isConfigured(): boolean {
    return this.client !== undefined && this.config !== undefined;
  }

  async onModuleInit(): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }

    await this.ensureBuckets();
  }

  async upload(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async download(bucket: string, key: string): Promise<Readable> {
    try {
      const output = await this.getClient().send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      if (!isReadableStream(output.Body)) {
        throw new Error(`Storage object ${bucket}/${key} did not return a readable stream`);
      }

      return output.Body;
    } catch (err) {
      if (isObjectNotFoundError(err)) {
        throw new StorageServiceError('STORAGE_NOT_FOUND', `Storage object ${bucket}/${key} was not found`, err);
      }

      throw err;
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  }

  async getPresignedDownloadUrl(
    bucket: string,
    key: string,
    expiresInSeconds = DEFAULT_PRESIGNED_URL_EXPIRES_IN_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async getPresignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    expiresInSeconds = DEFAULT_PRESIGNED_URL_EXPIRES_IN_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.getClient(),
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async ensureBuckets(): Promise<void> {
    const client = this.getClient();
    const config = this.getConfig();

    for (const bucket of REQUIRED_STORAGE_BUCKETS) {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (err) {
        if (!isBucketMissingError(err)) {
          throw err;
        }

        await client.send(new CreateBucketCommand(createBucketInput(bucket, config)));
        getApiLogger().info({ bucket, storage_provider: config.provider }, 'Storage bucket created');
      }
    }
  }

  async healthCheck(): Promise<StorageHealthComponent> {
    const client = this.getClient();
    const startedAt = performance.now();

    try {
      await client.send(new HeadBucketCommand({ Bucket: PRIMARY_STORAGE_BUCKET }), {
        abortSignal: AbortSignal.timeout(STORAGE_HEALTH_TIMEOUT_MS),
      });

      return {
        status: 'healthy',
        latency_ms: elapsedMs(startedAt),
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        latency_ms: elapsedMs(startedAt),
        error: toSafeErrorMessage(err),
      };
    }
  }

  private getClient(): S3Client {
    if (this.client === undefined || this.config === undefined) {
      throw new StorageServiceError('STORAGE_NOT_CONFIGURED', 'Storage service is not configured');
    }

    return this.client;
  }

  private getConfig(): StorageResolvedConfig {
    if (this.config === undefined) {
      throw new StorageServiceError('STORAGE_NOT_CONFIGURED', 'Storage service is not configured');
    }

    return this.config;
  }
}

export function createStorageClient(): S3Client | undefined {
  const config = resolveStorageConfig();
  if (config === undefined) {
    logIncompleteStorageConfiguration();
    return undefined;
  }

  return new S3Client(createS3ClientConfig(config));
}

function resolveStorageConfig(env: Record<string, string | undefined> = process.env): StorageResolvedConfig | undefined {
  const minioEndpoint = readEnvVar(env.MINIO_ENDPOINT);
  if (minioEndpoint !== undefined) {
    const accessKeyId = readEnvVar(env.MINIO_ACCESS_KEY);
    const secretAccessKey = readEnvVar(env.MINIO_SECRET_KEY);
    if (accessKeyId === undefined || secretAccessKey === undefined) {
      return undefined;
    }

    return {
      provider: 'minio',
      region: readEnvVar(env.S3_REGION) ?? DEFAULT_MINIO_REGION,
      endpoint: minioEndpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    };
  }

  const region = readEnvVar(env.S3_REGION);
  if (region === undefined) {
    return undefined;
  }

  const accessKeyId = readEnvVar(env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = readEnvVar(env.AWS_SECRET_ACCESS_KEY);
  if (accessKeyId === undefined || secretAccessKey === undefined) {
    return undefined;
  }

  const endpoint = readEnvVar(env.S3_ENDPOINT);
  return endpoint === undefined
    ? {
        provider: 's3',
        region,
        forcePathStyle: false,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      }
    : {
        provider: 's3',
        region,
        endpoint,
        forcePathStyle: false,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      };
}

function createS3ClientConfig(config: StorageResolvedConfig): S3ClientConfig {
  return config.endpoint === undefined
    ? {
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: config.credentials,
      }
    : {
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials: config.credentials,
      };
}

function createBucketInput(bucket: string, config: StorageResolvedConfig): CreateBucketCommandInput {
  if (config.provider === 'minio' || config.region === DEFAULT_MINIO_REGION) {
    return { Bucket: bucket };
  }

  return {
    Bucket: bucket,
    CreateBucketConfiguration: {
      LocationConstraint: config.region as BucketLocationConstraint,
    },
  };
}

function logIncompleteStorageConfiguration(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const hasStorageInputs =
    readEnvVar(process.env.MINIO_ENDPOINT) !== undefined ||
    readEnvVar(process.env.S3_REGION) !== undefined ||
    readEnvVar(process.env.S3_ENDPOINT) !== undefined;

  if (!hasStorageInputs) {
    return;
  }

  getApiLogger().warn({ storage_configured: false }, 'Storage disabled because configuration is incomplete');
}

function readEnvVar(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function isReadableStream(value: unknown): value is Readable {
  return typeof value === 'object' && value !== null && 'pipe' in value && typeof value.pipe === 'function';
}

function isBucketMissingError(err: unknown): boolean {
  return hasStorageErrorCode(err, 'NotFound') || hasStorageErrorCode(err, 'NoSuchBucket') || hasHttpStatusCode(err, 404);
}

function isObjectNotFoundError(err: unknown): boolean {
  return hasStorageErrorCode(err, 'NoSuchKey') || hasStorageErrorCode(err, 'NotFound') || hasHttpStatusCode(err, 404);
}

function hasStorageErrorCode(err: unknown, code: string): boolean {
  if (!isRecord(err)) {
    return false;
  }

  return err.code === code || err.Code === code || err.name === code;
}

function hasHttpStatusCode(err: unknown, statusCode: number): boolean {
  if (!isRecord(err) || !isRecord(err.$metadata)) {
    return false;
  }

  return err.$metadata.httpStatusCode === statusCode;
}

function elapsedMs(startedAt: number): number {
  return Math.max(1, Math.round(performance.now() - startedAt));
}

function toSafeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
