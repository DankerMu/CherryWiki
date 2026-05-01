import { Type } from 'class-transformer';
import { JobStatus } from '@cherrygraph/job-core';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';

export const JOB_TYPES = ['ingestion', 'validation', 'url_fetch', 'graphify', 'reindex', 'rebuild', 'wiki_sync'] as const;
export const JOB_SORT_FIELDS = ['created_at', 'priority', 'next_run_at'] as const;

export type JobType = (typeof JOB_TYPES)[number];

export class AdminJobListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(JOB_TYPES)
  type?: JobType;

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  space_id?: string;
}

export class JobEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 100;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class JobProgressDto {
  percent?: number;
  stage?: string;
}

export class JobDto {
  job_id!: string;
  type!: string;
  status!: string;
  space_id!: string | null;
  progress!: JobProgressDto | null;
  created_by!: string | null;
  payload_json!: unknown;
  result_json!: unknown;
  error_json!: unknown;
  cancel_requested_at!: Date | null;
  attempt_count!: number;
  max_attempts!: number;
  created_at!: Date;
  started_at!: Date | null;
  completed_at!: Date | null;
}

export class JobEventDto {
  event!: string;
  timestamp!: Date;
  detail!: unknown;
}

export class CancelJobResponseDto {
  job_id!: string;
  status!: string;
  cancel_requested_at!: Date | null;
}
