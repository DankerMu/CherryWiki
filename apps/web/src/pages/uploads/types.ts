import { ApiError } from '../../lib/api';

export const UPLOAD_PAGE_SIZE = 20;
export const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024;

export const SUPPORTED_UPLOAD_EXTENSIONS = [
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.zip',
] as const;

export const UPLOAD_STATUS_OPTIONS = [
  'uploaded',
  'validating',
  'archived',
  'parsing',
  'parsed',
  'graphify_pending',
  'graphify_running',
  'parse_failed',
  'security_rejected',
] as const;

export const UPLOAD_SOURCE_TYPE_OPTIONS = ['upload', 'url'] as const;
export const UPLOAD_SORT_OPTIONS = [
  '-created_at',
  '-updated_at',
  'filename',
  'status',
] as const;
export const DEFAULT_UPLOAD_SORT = '-created_at';

export type UploadSourceType = (typeof UPLOAD_SOURCE_TYPE_OPTIONS)[number];
export type UploadSortOption = (typeof UPLOAD_SORT_OPTIONS)[number];

export type UploadResponse = {
  source_document_id: string;
  file_blob_id: string | null;
  job_id: string | null;
  status: string;
  created: boolean;
  duplicate?: boolean;
  error_code?: string;
};

export type UploadItem = {
  id: string;
  filename: string;
  mime_type: string | null;
  sha256: string | null;
  size_bytes: number | null;
  source_type: string;
  classification: string | null;
  status: string;
  uploader_id: string | null;
  space_id: string;
  metadata_json: unknown;
  created_at: string;
  updated_at: string;
  progress_percent?: number | null;
  job_id?: string | null;
  job_status?: string | null;
  error_json?: unknown;
};

export type UploadStatus = {
  source_document_id: string;
  status: string;
  job_id: string | null;
  job_status: string | null;
  progress_percent: number | null;
  error_json: unknown;
};

export type UploadFailureDetails = {
  errorType: string | null;
  errorMessage: string | null;
};

export function getUploadExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : '';
}

export function isSupportedUploadFile(filename: string): boolean {
  return SUPPORTED_UPLOAD_EXTENSIONS.includes(
    getUploadExtension(filename) as (typeof SUPPORTED_UPLOAD_EXTENSIONS)[number],
  );
}

export function normalizeUploadStatusFilter(value: string): string {
  return UPLOAD_STATUS_OPTIONS.includes(value as (typeof UPLOAD_STATUS_OPTIONS)[number]) ? value : '';
}

export function normalizeUploadSourceTypeFilter(value: string): UploadSourceType | '' {
  return UPLOAD_SOURCE_TYPE_OPTIONS.includes(value as UploadSourceType) ? (value as UploadSourceType) : '';
}

export function normalizeUploadSort(value: string): UploadSortOption {
  return UPLOAD_SORT_OPTIONS.includes(value as UploadSortOption) ? (value as UploadSortOption) : DEFAULT_UPLOAD_SORT;
}

export function formatFileSize(sizeBytes: number | null | undefined): string {
  if (sizeBytes === null || sizeBytes === undefined) {
    return 'Unknown';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let size = sizeBytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex] ?? 'GB'}`;
}

export function isUploadProcessing(status: string): boolean {
  return !isUploadTerminal(status);
}

export function isUploadTerminal(status: string): boolean {
  return (
    status === 'parsed' ||
    status === 'completed' ||
    status === 'published' ||
    status === 'indexed' ||
    status === 'wiki_proposed' ||
    status === 'parse_failed' ||
    status === 'security_rejected' ||
    status === 'failed' ||
    status === 'rejected'
  );
}

export function getUploadStatusClass(status: string): string {
  if (
    status === 'parsed' ||
    status === 'completed' ||
    status === 'published' ||
    status === 'indexed' ||
    status === 'wiki_proposed'
  ) {
    return 'healthy';
  }

  if (status === 'parse_failed' || status === 'security_rejected' || status === 'failed' || status === 'rejected') {
    return 'unhealthy';
  }

  return 'info';
}

export function getUploadProgressPercent(upload: UploadItem, status?: UploadStatus | null): number {
  if (status?.progress_percent !== null && status?.progress_percent !== undefined) {
    return status.progress_percent;
  }

  if (upload.progress_percent !== null && upload.progress_percent !== undefined) {
    return upload.progress_percent;
  }

  switch (upload.status) {
    case 'uploaded':
      return 10;
    case 'validating':
      return 30;
    case 'archived':
      return 45;
    case 'parsing':
      return 70;
    case 'graphify_pending':
      return 90;
    case 'graphify_running':
      return 95;
    case 'parsed':
    case 'completed':
    case 'published':
    case 'indexed':
    case 'wiki_proposed':
      return 100;
    default:
      return 0;
  }
}

export function getUploadStageLabel(upload: UploadItem, status?: UploadStatus | null): string {
  const activeStatus = status?.status ?? upload.status;
  const jobStatus = status?.job_status ?? upload.job_status;

  switch (activeStatus) {
    case 'uploaded':
      return 'Uploaded';
    case 'validating':
      return 'Validating';
    case 'archived':
      return 'Queued for parsing';
    case 'parsing':
      return 'Parsing';
    case 'graphify_pending':
      return 'Waiting for graphify';
    case 'graphify_running':
      return 'Building graph';
    case 'parsed':
      return 'Parsed';
    case 'parse_failed':
      return 'Parse failed';
    case 'security_rejected':
      return 'Security rejected';
    default:
      return jobStatus !== null && jobStatus !== undefined ? jobStatus : activeStatus;
  }
}

export function readUploadFailureDetails(status?: UploadStatus | null, upload?: UploadItem | null): UploadFailureDetails {
  const source = status?.error_json ?? upload?.error_json ?? upload?.metadata_json;
  if (!isRecord(source)) {
    return { errorType: null, errorMessage: null };
  }

  const error = isRecord(source.error) ? source.error : source;
  const errorType =
    readString(error.error_type) ??
    readString(error.type) ??
    readString(error.code) ??
    readString(source.rejection_reason) ??
    null;
  const errorMessage =
    readString(error.error_message) ??
    readString(error.message) ??
    readString(source.rejection_message) ??
    readString(source.rejection_reason) ??
    null;

  return { errorType, errorMessage };
}

export function getUploadErrorCode(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code;
  }

  if (isRecord(error) && typeof error.code === 'string') {
    return error.code;
  }

  return 'UPLOAD_ERROR';
}

export function getUploadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return 'Upload failed';
}

export function unwrapApiBody<T>(body: unknown): T {
  if (isRecord(body) && 'data' in body) {
    return body.data as T;
  }

  return body as T;
}

export function readApiErrorBody(body: unknown): { code: string; message: string } {
  if (isRecord(body)) {
    if (isRecord(body.error)) {
      return {
        code: readString(body.error.code) ?? 'UPLOAD_ERROR',
        message: readString(body.error.message) ?? 'Upload failed',
      };
    }

    return {
      code: readString(body.code) ?? 'UPLOAD_ERROR',
      message: readString(body.message) ?? 'Upload failed',
    };
  }

  return { code: 'UPLOAD_ERROR', message: 'Upload failed' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
