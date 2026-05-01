import { IsOptional, IsString } from 'class-validator';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';

export class WikiListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class PublishDto {
  @IsString()
  version_id!: string;

  @IsOptional()
  @IsString()
  publish_note?: string;
}

export class RollbackDto {
  @IsString()
  target_version_id!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
