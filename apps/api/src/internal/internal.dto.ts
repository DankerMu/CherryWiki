import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { type JobDto } from '../jobs/jobs.dto.js';
import { JOB_TYPES, type JobType } from '../jobs/jobs.dto.js';

export class PendingJobsQueryDto {
  @IsIn(JOB_TYPES)
  type!: JobType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit = 1;
}

export class JobProgressUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  worker_id!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  stage?: string;
}

export class JobCompletionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  worker_id!: string;

  @IsOptional()
  @IsObject()
  result_json?: Record<string, unknown>;
}

export class JobFailureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  worker_id!: string;

  @IsObject()
  error_json!: Record<string, unknown>;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  retryable = true;
}

export class WorkerHeartbeatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  worker_id!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  active_jobs?: string[];

  @IsOptional()
  @IsObject()
  system_info?: Record<string, unknown>;
}

export class JobFailureResponseDto {
  job!: JobDto;
  will_retry!: boolean;
}

export class WorkerHeartbeatResponseDto {
  ack!: boolean;
  cancel_requested!: string[];
}
