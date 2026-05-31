import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

let client: S3Client | undefined;

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function getMinioClient(): S3Client {
  if (client) return client;
  client = new S3Client({
    endpoint: env('MINIO_ENDPOINT', 'http://127.0.0.1:9000'),
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env('MINIO_ACCESS_KEY', 'minioadmin'),
      secretAccessKey: env('MINIO_SECRET_KEY', 'minioadmin_dev_secret'),
    },
  });
  return client;
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getMinioClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function getObjectText(bucket: string, key: string): Promise<string> {
  const res = await getMinioClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return res.Body?.transformToString('utf-8') ?? '';
}

export async function listObjects(bucket: string, prefix?: string): Promise<string[]> {
  const res = await getMinioClient().send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  return (res.Contents ?? []).map((o) => o.Key!).filter(Boolean);
}

export async function putObject(bucket: string, key: string, body: Buffer | string): Promise<void> {
  await getMinioClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: typeof body === 'string' ? Buffer.from(body) : body }),
  );
}
