import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ChatCompletionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  space_id?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  space_ids?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  session_id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsBoolean()
  enable_deep_analysis?: boolean;

  @IsOptional()
  @IsBoolean()
  enable_database?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  retrieval_mode?: string;
}

export class ChatSessionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
