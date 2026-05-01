export const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
export const SMALL_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIUM_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const UPLOAD_BATCH_WINDOW_MS = 30_000;

export const UPLOAD_JOB_QUEUES = {
  INGESTION: 'ingestion',
  VALIDATION: 'validation',
  URL_FETCH: 'url-fetch',
  GRAPHIFY: 'graphify',
} as const;

export const UPLOAD_JOB_TYPES = {
  INGESTION: 'ingestion',
  VALIDATION: 'validation',
  URL_FETCH: 'url_fetch',
  GRAPHIFY: 'graphify',
} as const;
