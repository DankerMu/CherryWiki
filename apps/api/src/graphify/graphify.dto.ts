import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';

export const GRAPHIFY_RUN_MODES = ['full', 'update', 'incremental'] as const;
export const GRAPHIFY_TRIGGER_TYPES = ['manual', 'scheduled', 'auto'] as const;
export const GRAPHIFY_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;

export type GraphifyRunModeDto = (typeof GRAPHIFY_RUN_MODES)[number];
export type GraphifyTriggerTypeDto = (typeof GRAPHIFY_TRIGGER_TYPES)[number];
export type GraphifyRunStatusDto = (typeof GRAPHIFY_RUN_STATUSES)[number];

class GraphifyInputScopeDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  page_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  source_document_ids?: string[];
}

class GraphifyOptionsDto {
  @IsOptional()
  @IsBoolean()
  wiki?: boolean;

  @IsOptional()
  @IsBoolean()
  no_viz?: boolean;

  @IsOptional()
  @IsBoolean()
  directed?: boolean;
}

export class CreateGraphifyRunDto {
  @IsString()
  @IsIn(GRAPHIFY_RUN_MODES)
  mode!: GraphifyRunModeDto;

  @IsString()
  @IsIn(GRAPHIFY_TRIGGER_TYPES)
  trigger_type!: GraphifyTriggerTypeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GraphifyInputScopeDto)
  input_scope?: GraphifyInputScopeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GraphifyOptionsDto)
  options?: GraphifyOptionsDto;
}

export class GraphifyRunsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  space_id?: string;

  @IsOptional()
  @IsString()
  @IsIn(GRAPHIFY_RUN_STATUSES)
  status?: GraphifyRunStatusDto;

  @IsOptional()
  @IsString()
  @IsIn(GRAPHIFY_TRIGGER_TYPES)
  trigger_type?: GraphifyTriggerTypeDto;
}
