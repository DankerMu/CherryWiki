import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  type ValidationOptions,
  ValidateBy,
} from 'class-validator';

import { type JobDto } from '../jobs/jobs.dto.js';
import { JOB_TYPES, type JobType } from '../jobs/jobs.dto.js';

const MAX_HEARTBEAT_ACTIVE_JOBS = 50;
const MAX_SYSTEM_INFO_DEPTH = 3;
const MAX_SYSTEM_INFO_JSON_LENGTH = 4_096;
const MAX_SYSTEM_INFO_KEYS_PER_LEVEL = 25;
const MAX_SYSTEM_INFO_KEY_LENGTH = 100;
const MAX_SYSTEM_INFO_STRING_LENGTH = 500;

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
  @ArrayMaxSize(MAX_HEARTBEAT_ACTIVE_JOBS)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  active_jobs?: string[];

  @IsOptional()
  @IsObject()
  @IsBoundedSystemInfo()
  system_info?: Record<string, unknown>;
}

export class JobFailureResponseDto {
  job!: JobDto;
  will_retry!: boolean;
}

export class WorkerHeartbeatResponseDto {
  ack!: boolean;
  cancel_requested!: string[];
  lost_locks!: string[];
}

function IsBoundedSystemInfo(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isBoundedSystemInfo',
      validator: {
        validate: (value: unknown): boolean => isBoundedSystemInfo(value),
        defaultMessage: (): string =>
          `system_info must be JSON-serializable, at most ${MAX_SYSTEM_INFO_JSON_LENGTH} characters, and no deeper than ${MAX_SYSTEM_INFO_DEPTH} objects`,
      },
    },
    validationOptions,
  );
}

function isBoundedSystemInfo(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }

  try {
    if (JSON.stringify(value).length > MAX_SYSTEM_INFO_JSON_LENGTH) {
      return false;
    }
  } catch {
    return false;
  }

  return validateSystemInfoNode(value, 0);
}

function validateSystemInfoNode(value: unknown, depth: number): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.length <= MAX_SYSTEM_INFO_STRING_LENGTH;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'boolean') {
    return true;
  }

  if (!isPlainRecord(value) || depth > MAX_SYSTEM_INFO_DEPTH) {
    return false;
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_SYSTEM_INFO_KEYS_PER_LEVEL) {
    return false;
  }

  return entries.every(
    ([key, nestedValue]) => key.length <= MAX_SYSTEM_INFO_KEY_LENGTH && validateSystemInfoNode(nestedValue, depth + 1),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
