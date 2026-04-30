export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');
export const STORAGE_CLIENT = Symbol('STORAGE_CLIENT');

export const STORAGE_BUCKET_NAMES = {
  UPLOADS: 'uploads',
  ARCHIVES: 'archives',
  GRAPHIFY_OUTPUT: 'graphify-output',
  WIKI_REPO: 'wiki-repo',
} as const;

export const REQUIRED_STORAGE_BUCKETS = [
  STORAGE_BUCKET_NAMES.UPLOADS,
  STORAGE_BUCKET_NAMES.ARCHIVES,
  STORAGE_BUCKET_NAMES.GRAPHIFY_OUTPUT,
  STORAGE_BUCKET_NAMES.WIKI_REPO,
] as const;

export const PRIMARY_STORAGE_BUCKET = STORAGE_BUCKET_NAMES.UPLOADS;
export const DEFAULT_STORAGE_BUCKET_PREFIX = 'cherrywiki';
export const DEFAULT_STORAGE_MAX_UPLOAD_BYTES = 104_857_600;
export const DEFAULT_PRESIGNED_URL_EXPIRES_IN_SECONDS = 3_600;
export const STORAGE_BUCKET_INIT_TIMEOUT_MS = 10_000;
export const STORAGE_HEALTH_TIMEOUT_MS = 5_000;

export type StorageBucketPurpose = (typeof REQUIRED_STORAGE_BUCKETS)[number];
export type StorageBucketName = StorageBucketPurpose;

export function getBucketName(
  purpose: StorageBucketPurpose,
  env: Record<string, string | undefined> = process.env,
): string {
  const prefix = readEnvVar(env.STORAGE_BUCKET_PREFIX) ?? DEFAULT_STORAGE_BUCKET_PREFIX;
  return `${prefix}-${purpose}`;
}

function readEnvVar(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
