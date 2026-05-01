import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { ErrorCode } from '@cherrygraph/shared';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';

export const UPLOAD_SORT_FIELDS = ['created_at', 'updated_at', 'filename', 'status'] as const;
export const UPLOAD_SOURCE_TYPES = ['upload', 'url'] as const;
export const UPLOAD_PROCESSING_STRATEGIES = ['immediate', 'stash', 'archive_only'] as const;

export class CreateUploadDto {
  @IsOptional()
  @IsIn(UPLOAD_SOURCE_TYPES)
  source_type?: (typeof UPLOAD_SOURCE_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  classification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  tags?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @IsOptional()
  @IsIn(UPLOAD_PROCESSING_STRATEGIES)
  processing_strategy?: (typeof UPLOAD_PROCESSING_STRATEGIES)[number];
}

export class UploadListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(UPLOAD_SOURCE_TYPES)
  source_type?: (typeof UPLOAD_SOURCE_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class UploadStatusQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  include_history = 0;
}

export type UploadedFileLike = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type UploadResponseDto = {
  source_document_id: string;
  file_blob_id: string | null;
  job_id: string | null;
  status: string;
  created: boolean;
  error_code?: ErrorCode;
};

export type UploadDetailDto = {
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
  created_at: Date;
  updated_at: Date;
};

export type UploadStatusDto = {
  source_document_id: string;
  status: string;
  job_id: string | null;
  job_status: string | null;
  progress_percent: number | null;
  error_json: unknown;
};
